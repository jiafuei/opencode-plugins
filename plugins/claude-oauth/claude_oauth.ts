import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Configure in `opencode.json` like:
//
// {
//   "plugin": ["@jiafuei/opencode-claude-oauth"]
// }
//
// Then run `opencode auth login`, pick Anthropic, and choose one of the
// Claude Pro/Max OAuth methods. Requests to the Anthropic provider are then
// fingerprinted to look exactly like Claude Code (claude-cli) subscription
// traffic, so your Pro/Max subscription is used instead of API credits.

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"; // Claude Code's public OAuth client ID
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://api.anthropic.com/v1/oauth/token";
const BOOTSTRAP_URL = "https://api.anthropic.com/api/claude_cli/bootstrap";
const CALLBACK_PORT = 54545;
const CALLBACK_PATH = "/callback";
const SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

const CLAUDE_CODE_VERSION = "2.1.220";
const USER_AGENT = `claude-cli/${CLAUDE_CODE_VERSION} (external, claude-desktop)`;
const SDK_INSTRUCTION = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
const MAX_OUTPUT_TOKENS = 64000;
const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key";
const BILLING_SALT = "59cf53e54c78";
const BILLING_HEADER_PREFIX = "x-anthropic-billing-header:";
const SESSION_ID_HEADER = "x-claude-code-session-id";
// Plugin-only transport header: carries the per-invocation request id from
// chat.headers into the auth fetch. Like the session marker, it is stripped
// before anything hits the wire.
const REQUEST_ID_HEADER = "x-claude-oauth-request-id";

const UTILITY_PROFILE_BETAS = [
  "interleaved-thinking-2025-05-14",
  "thinking-token-count-2026-05-13",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "structured-outputs-2025-12-15",
];

const AGENT_PROFILE_BETAS = [
  "claude-code-20250219",
  "interleaved-thinking-2025-05-14",
  "thinking-token-count-2026-05-13",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "mid-conversation-system-2026-04-07",
  "advanced-tool-use-2025-11-20",
];

const EFFORT_BETA = "effort-2025-11-24";
const FALLBACK_CREDIT_BETA = "fallback-credit-2026-06-01";
// context-1m-2025-08-07 is intentionally never sent: OAuth subscription
// credentials get hard-429'd on beta-gated 1M requests regardless of prompt
// size, so it is stripped even from SDK/caller-supplied betas.
const CONTEXT_1M_BETA = "context-1m-2025-08-07";

function isActiveThinking(thinking: unknown): boolean {
  const type = (thinking as { type?: unknown } | undefined)?.type;
  return type === "enabled" || type === "adaptive";
}

/**
 * Build the final anthropic-beta header: the Claude profile first, then
 * deduplicated SDK/caller extras (compact, PDF, MCP, skills/files, fast mode,
 * task budgets, fallback, ...). `incoming` is the request's existing
 * anthropic-beta header value, if any.
 */
export function buildBetas(thinking: unknown, hasTools: boolean, incoming?: string | null): string {
  const agent = hasTools || isActiveThinking(thinking);
  const betas = [...(agent ? AGENT_PROFILE_BETAS : UTILITY_PROFILE_BETAS)];
  if (agent && isActiveThinking(thinking)) betas.push(EFFORT_BETA);
  if (agent) betas.push(FALLBACK_CREDIT_BETA);
  const seen = new Set(betas);
  if (incoming) {
    for (const raw of incoming.split(",")) {
      const beta = raw.trim();
      if (!beta || seen.has(beta) || beta === CONTEXT_1M_BETA) continue;
      seen.add(beta);
      betas.push(beta);
    }
  }
  return betas.join(",");
}

export function mapStainlessArch(arch: string): "x64" | "arm64" | "x86" | `other::${string}` {
  switch (arch.toLowerCase()) {
    case "amd64":
    case "x64":
      return "x64";
    case "arm64":
    case "aarch64":
      return "arm64";
    case "386":
    case "x86":
    case "ia32":
      return "x86";
    default:
      return `other::${arch.toLowerCase()}`;
  }
}

// Static Stainless headers emitted by the Claude runtime.
const STAINLESS_HEADERS: Record<string, string> = {
  "X-Stainless-Arch": mapStainlessArch(process.arch),
  "X-Stainless-Lang": "js",
  "X-Stainless-OS": "Linux",
  "X-Stainless-Package-Version": "0.94.0",
  "X-Stainless-Retry-Count": "0",
  "X-Stainless-Runtime": "node",
  "X-Stainless-Runtime-Version": "v26.3.0",
  "X-Stainless-Timeout": "600",
};

// ---------------------------------------------------------------------------
// PKCE + token plumbing
// ---------------------------------------------------------------------------

interface PkceCodes {
  verifier: string;
  challenge: string;
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generatePKCE(): Promise<PkceCodes> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(43)))
    .map((b) => chars[b % chars.length])
    .join("");
  const challenge = base64UrlEncode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  account?: { uuid?: string; email_address?: string };
  organization?: { uuid?: string; name?: string };
}

/**
 * Account + organization identity slice resolved from the token response
 * and/or `/api/claude_cli/bootstrap`.
 * OpenCode's auth schema persists only `accountId`; email/org are resolved
 * transiently and clearly typed here for future use — there is deliberately
 * no second credential store.
 */
export interface OAuthIdentity {
  accountId?: string;
  email?: string;
  orgId?: string;
  orgName?: string;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Normalize the token response's account/organization blocks; empty/non-string values become undefined. */
export function extractIdentity(data: TokenResponse): OAuthIdentity {
  return {
    accountId: nonEmpty(data.account?.uuid),
    email: nonEmpty(data.account?.email_address),
    orgId: nonEmpty(data.organization?.uuid),
    orgName: nonEmpty(data.organization?.name),
  };
}

// Only this origin may receive OAuth bearer traffic or token mutations.
const OAUTH_ALLOWED_ORIGIN = "https://api.anthropic.com";

// Error bodies are read only up to this bound before parsing; the raw body is
// never embedded into thrown errors (it can be huge and may echo credentials).
const TOKEN_ERROR_BODY_LIMIT = 16 * 1024;

async function readBoundedText(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  while (text.length < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return text.slice(0, limit);
}

/** Extract a string OAuth error code from the common error-body shapes. */
function extractOauthError(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const error = (parsed as Record<string, unknown>).error;
  if (typeof error === "string") return nonEmpty(error);
  // Nested variants: {error: {type: "invalid_grant"}} / {error: {error/code: "..."}}.
  if (error && typeof error === "object") {
    const nested = error as Record<string, unknown>;
    return nonEmpty(nested.type) ?? nonEmpty(nested.error) ?? nonEmpty(nested.code);
  }
  return undefined;
}

/**
 * POST to the official token endpoint and validate the envelope at the
 * network boundary: a 200 response without the required fields throws here,
 * long before identity resolution, persistence, or dispatch. Initial
 * exchanges require a nonempty refresh_token; refreshes may omit it (callers
 * keep the previous value). Thrown errors carry only the status plus the
 * parsed `error`/`error_description` fields — never the raw body or any
 * credential material.
 */
async function postToken(
  body: Record<string, string>,
  extraHeaders?: Record<string, string>,
  requireRefreshToken = true,
): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    // No Accept header: CC omits it on OAuth token requests.
    headers: { ...extraHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const text = await readBoundedText(response, TOKEN_ERROR_BODY_LIMIT);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {}
    const oauthError = extractOauthError(parsed);
    const description = nonEmpty((parsed as Record<string, unknown> | undefined)?.error_description)?.slice(0, 300);
    // Structured fields so callers can classify terminal refresh failures
    // (e.g. invalid_grant) without re-parsing the message.
    const error = new Error(
      `Anthropic OAuth token request failed (HTTP ${response.status}${oauthError ? `, ${oauthError}` : ""})` +
        (description ? `: ${description}` : ""),
    ) as Error & { status?: number; oauthError?: string };
    error.status = response.status;
    error.oauthError = oauthError;
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(await response.text());
  } catch {
    throw new Error("Anthropic OAuth token endpoint returned invalid JSON with a 200 status");
  }
  const record = (data ?? {}) as Record<string, unknown>;
  const accessToken = nonEmpty(record.access_token);
  const refreshToken = nonEmpty(record.refresh_token);
  const expiresIn = record.expires_in;
  if (
    !accessToken ||
    (requireRefreshToken && !refreshToken) ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new Error(
      `Anthropic OAuth token response is missing required fields (nonempty access_token${
        requireRefreshToken ? ", nonempty refresh_token" : ""
      }, finite positive expires_in)`,
    );
  }
  return data as TokenResponse;
}

/**
 * Identity recovery from `/api/claude_cli/bootstrap`. Throws on network
 * errors, non-OK responses, timeouts, and malformed JSON; callers treat every
 * failure as "keep whatever the token response provided" (best-effort only).
 */
export async function fetchBootstrapIdentity(accessToken: string): Promise<OAuthIdentity> {
  const response = await fetch(`${BOOTSTRAP_URL}?entrypoint=cli&model=claude-opus-4-8`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": `claude-code/${CLAUDE_CODE_VERSION}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Anthropic bootstrap request failed: ${response.status}`);
  const data = (await response.json()) as {
    oauth_account?: {
      account_uuid?: string;
      account_email?: string;
      organization_uuid?: string;
      organization_name?: string;
    };
  };
  return {
    accountId: nonEmpty(data.oauth_account?.account_uuid),
    email: nonEmpty(data.oauth_account?.account_email),
    orgId: nonEmpty(data.oauth_account?.organization_uuid),
    orgName: nonEmpty(data.oauth_account?.organization_name),
  };
}

/**
 * Resolve account (and optionally organization) identity for a token
 * response, merging the token response over bootstrap recovery. `includeOrg`
 * is login-only: the org a token is scoped to is captured once when the
 * credential is created and deliberately never refreshed afterwards —
 * rewriting org identity during background refreshes could silently re-key
 * stored credentials. Every bootstrap failure (network, non-OK, timeout,
 * invalid JSON) is swallowed so identity recovery never invalidates an
 * otherwise successful token exchange or refresh.
 */
export async function resolveIdentity(
  data: TokenResponse,
  options?: { includeOrg?: boolean },
): Promise<OAuthIdentity> {
  const identity = extractIdentity(data);
  const orgSatisfied = !options?.includeOrg || identity.orgId !== undefined;
  if (identity.accountId && identity.email && orgSatisfied) return identity;
  try {
    const bootstrap = await fetchBootstrapIdentity(data.access_token);
    return {
      accountId: identity.accountId ?? bootstrap.accountId,
      email: identity.email ?? bootstrap.email,
      orgId: identity.orgId ?? bootstrap.orgId,
      orgName: identity.orgName ?? bootstrap.orgName,
    };
  } catch {
    return identity;
  }
}

async function exchangeCode(
  code: string,
  state: string,
  verifier: string,
  redirectUri: string,
): Promise<{ access: string; refresh: string; expires: number; accountId?: string }> {
  // Pasted codes may carry the state as a `code#state` fragment.
  let exchangeCode = code;
  let exchangeState = state;
  const fragment = code.indexOf("#");
  if (fragment >= 0) {
    exchangeCode = code.slice(0, fragment);
    const fragmentState = code.slice(fragment + 1);
    if (fragmentState.length > 0) exchangeState = fragmentState;
  }

  const data = await postToken({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code: exchangeCode,
    state: exchangeState,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });

  // Login captures the full identity once: bootstrap runs whenever account
  // identity (uuid/email) or org identity is incomplete. Only accountId is
  // returned/persisted through OpenCode; email/org stay transient.
  const identity = await resolveIdentity(data, { includeOrg: true });

  return {
    access: data.access_token,
    refresh: data.refresh_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    accountId: identity.accountId,
  };
}

async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  // Refresh responses may omit refresh_token (rotation optional); the caller
  // keeps the previous value in that case.
  return postToken(
    {
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    },
    {
      // CC sends these on refresh but not on the initial code exchange.
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": "anthropic-sdk-typescript/0.94.0 userOAuthProvider",
    },
    false,
  );
}

// ---------------------------------------------------------------------------
// Cross-instance refresh coordination
// ---------------------------------------------------------------------------

/** Thrown when Anthropic rejects the refresh grant terminally (invalid_grant). */
export class AnthropicReauthRequiredError extends Error {
  constructor(cause?: unknown, grantAgeDays?: number) {
    super(
      "Anthropic OAuth grant is no longer valid (invalid_grant) — re-login required: run `opencode auth login`, pick Anthropic, and choose a Claude Pro/Max method." +
        (grantAgeDays === undefined
          ? ""
          : ` Observed grant age: ~${grantAgeDays} day(s) since authorization (~30 days is the typical observed lifetime, not a guaranteed contract).`),
      { cause },
    );
    this.name = "AnthropicReauthRequiredError";
  }
}

interface RefreshedCredential {
  refresh: string;
  access: string;
  expires: number;
  accountId?: string;
}

function opencodeDataDir(): string {
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "opencode");
}

// A lease holder that crashed mid-refresh is stolen after this long. Must
// safely exceed the worst-case in-lease work: one token refresh (30s timeout)
// plus bootstrap identity recovery (30s timeout) — doubled so a slow-but-live
// holder is never stolen mid-flight.
const REFRESH_LEASE_TTL_MS = 120_000;
const REFRESH_LEASE_POLL_MS = 100;

// Injectable clock/timers for the lease paths (tests simulate long waits).
const leaseClock = {
  now: () => Date.now(),
  sleep: (ms: number) => Bun.sleep(ms),
};

// In-process coordination: every plugin/loader instance in this process shares
// one refresh promise per credential identity (hashed accountId + refresh
// token), so concurrent expirations trigger a single network refresh.
const inFlightRefreshes = new Map<string, Promise<RefreshedCredential | null>>();

/**
 * Key for the in-process map: a SHA-256 of the credential identity. Never the
 * raw refresh token — the map must stay free of credential material.
 */
function inFlightKey(accountId: string | undefined, refresh: string): string {
  return createHash("sha256")
    .update(`${accountId ?? ""}:${refresh}`)
    .digest("hex");
}

// Cross-process coordination: an exclusive mkdir lease under OpenCode's data
// directory, keyed like the in-process map, so parallel opencode processes
// don't race the same refresh token (rotation invalidates the loser's token).
function refreshLeaseDir(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return path.join(opencodeDataDir(), "claude-oauth", "refresh-lease", hash);
}

interface LeaseOwner {
  owner: string;
  pid: number;
  at: number;
}

function newLeaseOwner(): LeaseOwner {
  return { owner: randomBytes(16).toString("hex"), pid: process.pid, at: leaseClock.now() };
}

/** Read and validate the recorded lease owner; undefined when missing/malformed. */
function readLeaseOwner(dir: string): LeaseOwner | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path.join(dir, "owner"), "utf8")) as Partial<LeaseOwner>;
    if (typeof parsed.owner === "string" && parsed.owner.length > 0 && typeof parsed.at === "number") {
      return {
        owner: parsed.owner,
        pid: typeof parsed.pid === "number" ? parsed.pid : -1,
        at: parsed.at,
      };
    }
  } catch {}
  return undefined;
}

/**
 * Atomic exclusive acquire via mkdir. Returns this holder's cryptographically
 * random owner token, or null when a live holder owns the lease. Only a lease
 * older than the TTL (a stale owner timestamp, or an ownerless directory aged
 * past the TTL — the holder crashed mid-refresh or mid-installation) is taken
 * over, and the takeover re-runs the atomic mkdir so concurrent stealers race
 * instead of both winning.
 */
function tryAcquireLease(dir: string): string | null {
  mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
  const claim = newLeaseOwner();
  try {
    mkdirSync(dir);
  } catch {
    const current = readLeaseOwner(dir);
    if (current && leaseClock.now() - current.at < REFRESH_LEASE_TTL_MS) return null;
    if (!current) {
      // No owner record yet (the holder is still installing it, microseconds
      // after its mkdir won) or a malformed one: judge by the directory's own
      // age. Stealing a mid-installation lease would let the dispossessed
      // holder overwrite our owner record afterwards and leave TWO live
      // holders refreshing the same grant. Only an aged ownerless directory
      // (crash between mkdir and write) is taken over.
      let aged = false;
      try {
        aged = leaseClock.now() - statSync(dir).mtimeMs >= REFRESH_LEASE_TTL_MS;
      } catch {
        return null; // vanished: the next poll retries the plain mkdir
      }
      if (!aged) return null;
    }
    // Stale owner record (or aged ownerless directory): the holder crashed —
    // take over. The mkdir below decides the race if several waiters steal
    // simultaneously.
    rmSync(dir, { recursive: true, force: true });
    try {
      mkdirSync(dir);
    } catch {
      return null;
    }
  }
  writeFileSync(path.join(dir, "owner"), JSON.stringify(claim), { mode: 0o600 });
  // Verify ownership: a concurrent stealer may have replaced our record.
  const verified = readLeaseOwner(dir);
  return verified?.owner === claim.owner ? claim.owner : null;
}

/** Release only the lease we still own — never another holder's replacement. */
function releaseLease(dir: string, ownerId: string): void {
  const current = readLeaseOwner(dir);
  if (!current || current.owner !== ownerId) return;
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Acquire the refresh lease, polling while a live holder works. Returns the
 * owner token on confirmed acquisition, or null when the holder's refresh
 * landed while we waited (or auth was removed/changed underneath us) — the
 * caller should adopt the latest persisted credentials instead of refreshing
 * again. A live lease is never stolen no matter how long it is held: takeover
 * happens only through the TTL path in tryAcquireLease once the holder's
 * timestamp goes stale.
 */
async function waitForLease(
  dir: string,
  startAuth: { access?: string },
  getAuth: () => Promise<any>,
): Promise<string | null> {
  for (;;) {
    const owner = tryAcquireLease(dir);
    if (owner) return owner;
    const latest = await getAuth();
    if (latest?.type !== "oauth" || latest.access !== startAuth.access || latest.expires >= leaseClock.now()) {
      return null;
    }
    await leaseClock.sleep(REFRESH_LEASE_POLL_MS);
  }
}

/**
 * Refresh the Anthropic OAuth credential so exactly one refresh happens per
 * identity: process-wide via the shared promise map, machine-wide via the fs
 * lease. Returns the persisted rotated credential, or null when a peer's
 * refresh already landed and the caller should re-read getAuth instead.
 */
async function performSharedRefresh(
  startAuth: { access?: string; refresh: string; accountId?: string },
  getAuth: () => Promise<any>,
  persist: (tokens: RefreshedCredential) => Promise<void>,
): Promise<RefreshedCredential | null> {
  const identity = `${startAuth.accountId ?? ""}:${startAuth.refresh}`;
  const key = inFlightKey(startAuth.accountId, startAuth.refresh);
  const inFlight = inFlightRefreshes.get(key);
  if (inFlight) return inFlight;
  const promise = (async (): Promise<RefreshedCredential | null> => {
    // The on-disk lease stays keyed by the composite identity (hashed once
    // inside refreshLeaseDir); only the in-process map key is the extra hash.
    const dir = refreshLeaseDir(identity);
    const ownerId = await waitForLease(dir, startAuth, getAuth);
    if (ownerId === null) return null;
    try {
      // Under the lease: a peer process may have persisted rotated credentials
      // after we observed the expiry.
      const latest = await getAuth();
      if (latest?.type !== "oauth") return null;
      if (latest.access !== startAuth.access || latest.expires >= leaseClock.now()) return null;

      let tokens: TokenResponse;
      try {
        tokens = await refreshTokens(latest.refresh);
      } catch (error) {
        const e = error as Error & { status?: number; oauthError?: string };
        // Terminal grant rejection: Anthropic answers 400, some gateway/error
        // shapes answer 401 with the same OAuth error code.
        if ((e.status === 400 || e.status === 401) && e.oauthError === "invalid_grant") {
          // Mention the observed grant age when we tracked it; never delete auth.
          const ageMs = observedGrantAgeMs(latest.refresh, latest.accountId);
          throw new AnthropicReauthRequiredError(error, ageMs === undefined ? undefined : Math.floor(ageMs / DAY_MS));
        }
        throw error;
      }
      // No includeOrg: never re-key organization on refresh. The stored
      // accountId survives whenever the response identity is missing/empty.
      const identity = await resolveIdentity(tokens);
      const refreshed: RefreshedCredential = {
        refresh: tokens.refresh_token || latest.refresh,
        access: tokens.access_token,
        expires: Date.now() + tokens.expires_in * 1000 - 5 * 60 * 1000,
        accountId: identity.accountId ?? latest.accountId,
      };
      // Immediately before persisting: re-read the stored credential and
      // persist only if it is still the same OAuth grant we refreshed. A
      // logout, API-key switch, new login, or peer rotation that happened
      // during the network work must never be overwritten by our stale result.
      const prePersist = await getAuth();
      if (
        prePersist?.type !== "oauth" ||
        prePersist.refresh !== latest.refresh ||
        prePersist.access !== latest.access ||
        (prePersist.accountId ?? undefined) !== (latest.accountId ?? undefined)
      ) {
        return null;
      }
      // Persist before returning: only durable credentials are handed to
      // callers, so every reader in every process observes the same token.
      await persist(refreshed);
      return refreshed;
    } finally {
      releaseLease(dir, ownerId);
    }
  })();
  const tracked = promise.finally(() => inFlightRefreshes.delete(key));
  inFlightRefreshes.set(key, tracked);
  return tracked;
}

export const refreshTestSeam = {
  leaseDirFor: refreshLeaseDir,
  tryAcquireLease,
  releaseLease,
  readLeaseOwner,
  leaseClock,
  inFlightKey,
  /** Hashed keys of currently tracked in-flight refreshes (safe to inspect). */
  inFlightKeys: (): string[] => [...inFlightRefreshes.keys()],
  /** Safe reset replacing direct access to the internal map. */
  resetInFlightRefreshes: (): void => inFlightRefreshes.clear(),
};

// ---------------------------------------------------------------------------
// Grant-age tracking (plugin-side sidecar; OpenCode's OAuth auth schema has no
// authorizedAt field)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
// Warn once a grant nears its observed ~30-day absolute lifetime.
const GRANT_WARN_AGE_MS = 28 * DAY_MS;

export const grantTestSeam = {
  clock: { now: () => Date.now() },
  warnedGrantKeys: new Set<string>(),
};

function grantsFile(): string {
  return path.join(opencodeDataDir(), "claude-oauth", "grants.json");
}

/**
 * Minimal sidecar key: accountId when known, otherwise a short SHA-256 of the
 * refresh token (non-secret, stable until rotation). Only authorization
 * timestamps live here — never a second credential store.
 */
function grantKey(refreshToken: string, accountId?: string): string {
  return accountId ?? createHash("sha256").update(refreshToken).digest("hex").slice(0, 16);
}

/** Best-effort read: malformed/missing/unreadable sidecar reads as empty. */
function readGrants(): Record<string, number> {
  try {
    const parsed = JSON.parse(readFileSync(grantsFile(), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const grants: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value)) grants[key] = value;
    }
    return grants;
  } catch {
    return {};
  }
}

/** Corruption-resistant write: temp file (0600) in the same directory, then atomic rename. */
function writeGrants(grants: Record<string, number>): void {
  const file = grantsFile();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(grants), { mode: 0o600 });
  try {
    renameSync(tmp, file);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

// Cross-process mutual exclusion for grants.json read-modify-write cycles, so
// concurrent logins in parallel opencode processes cannot lose each other's
// updates. A holder that crashed mid-update is taken over after this TTL; the
// critical section is a single synchronous read-modify-write, so live holders
// are only ever waited on for milliseconds.
const GRANT_LOCK_TTL_MS = 10_000;

function grantsLockDir(): string {
  return path.join(opencodeDataDir(), "claude-oauth", "grants.lock");
}

function acquireGrantsLock(): void {
  const dir = grantsLockDir();
  mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      mkdirSync(dir);
      return;
    } catch {
      let stale = true;
      try {
        stale = Date.now() - statSync(dir).mtimeMs >= GRANT_LOCK_TTL_MS;
      } catch {}
      if (!stale) {
        Bun.sleepSync(2);
        continue;
      }
      // Holder crashed mid-update: take over. Concurrent stealers re-race on
      // the mkdir below.
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function releaseGrantsLock(): void {
  rmSync(grantsLockDir(), { recursive: true, force: true });
}

/**
 * Record when a fresh grant was created. Called on login success only —
 * refresh rotation must never reset authorizedAt. Failures are swallowed so a
 * timestamp write can never fail the login itself.
 */
export function recordAuthorizedAt(refreshToken: string, accountId?: string): void {
  try {
    acquireGrantsLock();
    try {
      const grants = readGrants();
      grants[grantKey(refreshToken, accountId)] = grantTestSeam.clock.now();
      writeGrants(grants);
    } finally {
      releaseGrantsLock();
    }
  } catch {}
}

/**
 * A grant first recorded before the accountId was known lives under the
 * refresh-hash key. Once the accountId becomes known, move that history onto
 * the stable account key so later refresh rotation — which changes the hash —
 * cannot lose the authorization age. Best-effort; runs under the sidecar lock.
 */
function migrateGrantAuthorizedAt(refreshToken: string, accountId?: string): void {
  if (!accountId) return;
  const accountKey = grantKey(refreshToken, accountId);
  const legacyKey = grantKey(refreshToken);
  if (accountKey === legacyKey) return;
  try {
    acquireGrantsLock();
    try {
      const grants = readGrants();
      if (grants[accountKey] !== undefined || grants[legacyKey] === undefined) return;
      grants[accountKey] = grants[legacyKey]!;
      delete grants[legacyKey];
      writeGrants(grants);
    } finally {
      releaseGrantsLock();
    }
  } catch {}
}

/** Age of the grant, falling back to its pre-accountId refresh-hash entry. */
function observedGrantAgeMs(refreshToken: string, accountId?: string): number | undefined {
  migrateGrantAuthorizedAt(refreshToken, accountId);
  const grants = readGrants();
  const authorizedAt = grants[grantKey(refreshToken, accountId)] ?? grants[grantKey(refreshToken)];
  if (authorizedAt === undefined) return undefined;
  return Math.max(0, grantTestSeam.clock.now() - authorizedAt);
}

/**
 * One warning per process/account once the grant nears its observed ~30-day
 * absolute lifetime. Log failures are swallowed so they never block auth.
 */
async function warnOnStaleGrant(
  client: PluginInput["client"],
  refreshToken: string,
  accountId?: string,
): Promise<void> {
  const key = grantKey(refreshToken, accountId);
  const ageMs = observedGrantAgeMs(refreshToken, accountId);
  if (ageMs === undefined || ageMs < GRANT_WARN_AGE_MS || grantTestSeam.warnedGrantKeys.has(key)) return;
  grantTestSeam.warnedGrantKeys.add(key);
  try {
    await client.app.log({
      body: {
        service: "claude-oauth",
        level: "warn",
        message:
          `Anthropic OAuth grant for ${accountId ? `account ${accountId}` : "this credential"} is ~${Math.floor(ageMs / DAY_MS)} days old. ` +
          "~30 days is an observed heuristic for the absolute grant lifetime — interactive re-login (`opencode auth login` → Anthropic → Claude Pro/Max) may soon be required.",
        extra: { ageDays: Math.floor(ageMs / DAY_MS) },
      },
    });
  } catch {
    // Logging is advisory; never block auth on it.
  }
}

// ---------------------------------------------------------------------------
// Callback server for the browser flow
// ---------------------------------------------------------------------------

// Loopback only: the callback server never binds a routable interface.
const CALLBACK_HOST = "127.0.0.1";
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

// Browser-hardening headers on every callback response: never cached, never
// reinterpreted via MIME sniffing, and no referrer leakage.
const CALLBACK_RESPONSE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

interface PendingFlow {
  state: string;
  resolve: (code: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
}

// Per-flow state keyed by the OAuth `state` parameter, so concurrent logins
// never overwrite each other and stale/mismatched callbacks can't cancel an
// active flow they don't belong to.
const pendingFlows = new Map<string, PendingFlow>();
let oauthServer: Server | undefined;
let serverStart: Promise<Server> | undefined;

function settleFlow(flow: PendingFlow, outcome: { code: string } | { error: Error }): void {
  if (flow.settled) return;
  flow.settled = true;
  clearTimeout(flow.timer);
  pendingFlows.delete(flow.state);
  if ("error" in outcome) flow.reject(outcome.error);
  else flow.resolve(outcome.code);
  if (pendingFlows.size === 0) stopCallbackServer();
}

function handleCallbackRequest(url: URL): { ok: boolean; message: string } {
  const state = url.searchParams.get("state");
  // Only the flow owning this exact state is touched; unknown, expired, or
  // malformed requests must not cancel another active flow.
  const flow = state ? pendingFlows.get(state) : undefined;
  if (!flow) {
    return { ok: false, message: "This login request is unknown or has expired. Restart login in OpenCode." };
  }
  const error = url.searchParams.get("error");
  if (error) {
    settleFlow(flow, { error: new Error(url.searchParams.get("error_description") || error) });
    return { ok: false, message: "Login failed. You can close this window and retry from OpenCode." };
  }
  const code = url.searchParams.get("code");
  if (!code) {
    settleFlow(flow, { error: new Error("Missing authorization code") });
    return { ok: false, message: "Missing authorization code." };
  }
  settleFlow(flow, { code });
  return { ok: true, message: "You can close this window and return to OpenCode." };
}

function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      // The OAuth redirect is a browser navigation: accept GET only. Anything
      // else is rejected without touching flow state.
      if (req.method !== "GET") {
        res.writeHead(405, { Allow: "GET", ...CALLBACK_RESPONSE_HEADERS });
        res.end("Method not allowed");
        return;
      }
      const url = new URL(req.url || "/", `http://${CALLBACK_HOST}`);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404, CALLBACK_RESPONSE_HEADERS);
        res.end("Not found");
        return;
      }
      const { ok, message } = handleCallbackRequest(url);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...CALLBACK_RESPONSE_HEADERS });
      res.end(`<html><body><h2>${ok ? "Login successful" : "Login failed"}</h2><p>${message}</p></body></html>`);
    });
    server.once("error", reject);
    server.listen(port, CALLBACK_HOST, () => resolve(server));
  });
}

// Bind step used by startCallbackServer; overridable only from tests (failure
// injection). Production code never touches this.
let listenImpl: (port: number) => Promise<Server> = listenOn;

// Concurrency-safe: simultaneous authorize() calls share one startup attempt.
async function startCallbackServer(): Promise<Server> {
  if (oauthServer) return oauthServer;
  serverStart ??= (async () => {
    let server: Server;
    try {
      server = await listenImpl(CALLBACK_PORT);
    } catch {
      // Preferred port busy (e.g. another session): fall back to an ephemeral
      // loopback port so the login still works.
      server = await listenImpl(0);
    }
    oauthServer = server;
    return server;
  })();
  try {
    return await serverStart;
  } catch (error) {
    serverStart = undefined;
    throw error;
  }
}

function stopCallbackServer(): void {
  if (!oauthServer) return;
  const server = oauthServer;
  oauthServer = undefined;
  // Allow a fresh startup attempt (and a fresh port pick) after this.
  serverStart = undefined;
  server.close(() => {});
}

// Creates and registers the callback promise before authorize() returns, so a
// browser redirect arriving before OpenCode invokes callback() is retained.
function registerFlow(state: string, timeoutMs: number = FLOW_TIMEOUT_MS): Promise<string> {
  let resolve!: (code: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // The promise may be rejected with no one awaiting it (dispose before
  // callback(), timeout after abandonment); keep that from surfacing as an
  // unhandled rejection.
  promise.catch(() => {});
  const flow: PendingFlow = {} as PendingFlow;
  flow.state = state;
  flow.resolve = resolve;
  flow.reject = reject;
  flow.settled = false;
  flow.timer = setTimeout(() => {
    settleFlow(flow, { error: new Error("OAuth callback timeout - authorization took too long") });
  }, timeoutMs);
  pendingFlows.set(state, flow);
  return promise;
}

// Rejects every pending flow and closes the server.
function disposeOAuth(): void {
  for (const flow of [...pendingFlows.values()]) {
    settleFlow(flow, { error: new Error("OAuth login cancelled: plugin disposed") });
  }
  stopCallbackServer();
}

export const callbackTestSeam = {
  startCallbackServer,
  registerFlow,
  disposeOAuth,
  pendingFlows,
  server: () => oauthServer,
  /** Swap the bind step for failure injection; pass undefined to restore. */
  setListenImpl: (impl?: (port: number) => Promise<Server>) => {
    listenImpl = impl ?? listenOn;
  },
};

function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    // Non-standard: required by claude.ai to return the raw code.
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Device ID (stable attribution across restarts)
// ---------------------------------------------------------------------------

function getInstallId(): string {
  const dir = opencodeDataDir();
  // 0700 where practical: with recursive mkdir the mode applies to leaves it
  // creates; pre-existing directories keep their mode.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "claude-oauth-install-id");
  let existing = "";
  try {
    existing = readFileSync(file, "utf8").trim();
  } catch {}
  if (existing) {
    ensureOwnerOnly(file);
    return existing;
  }
  const id = randomBytes(16).toString("hex");
  try {
    // Exclusive creation so concurrent processes converge on exactly one
    // winner identity.
    writeFileSync(file, id, { mode: 0o600, flag: "wx" });
    return id;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Another process won the race: adopt its identity unchanged. The file
    // may exist for a few microseconds before the winner's content lands,
    // so poll briefly for a nonempty value.
    for (let attempt = 0; attempt < 50; attempt++) {
      Bun.sleepSync(5);
      const winner = readFileSync(file, "utf8").trim();
      if (winner) {
        chmodSync(file, 0o600);
        return winner;
      }
    }
    throw new Error("claude-oauth install id file was created but never populated");
  }
}

/** Tighten a legacy install-id file to owner-only permissions if needed. */
function ensureOwnerOnly(file: string): void {
  if ((statSync(file).mode & 0o777) !== 0o600) chmodSync(file, 0o600);
}

function deriveDeviceId(accountId?: string): string {
  const hash = createHash("sha256");
  if (accountId) {
    return hash.update("claude-oauth-device-id-v2\0").update(getInstallId()).update("\0").update(accountId).digest("hex");
  }
  return hash.update("claude-oauth-device-id-v1:").update(getInstallId()).digest("hex");
}

// Valid legacy cloaking id: user_<64 hex>_account_<uuid>_session_<uuid>.
const CLOAKING_USER_ID_REGEX =
  /^user_[0-9a-fA-F]{64}_account_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isClaudeJsonUserId(userId: string): boolean {
  if (userId.length === 0 || userId[0] !== "{") return false;
  try {
    const parsed = JSON.parse(userId) as Record<string, unknown>;
    return typeof parsed.session_id === "string" && parsed.session_id.length > 0;
  } catch {
    return false;
  }
}

function extractUserIdSessionId(userId: string): string | undefined {
  if (CLOAKING_USER_ID_REGEX.test(userId)) return userId.slice(userId.lastIndexOf("_session_") + "_session_".length);
  if (userId.startsWith("{")) {
    try {
      const sessionId = (JSON.parse(userId) as Record<string, unknown>).session_id;
      if (typeof sessionId === "string" && sessionId.length > 0) return sessionId;
    } catch {}
  }
  return undefined;
}

// Generated user ids prefer an account already present in metadata over the
// auth-derived one.
function readMetadataAccountId(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  for (const key of ["account_uuid", "accountId", "account_id"]) {
    const value = (metadata as Record<string, unknown>)[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Request spoofing: billing header + cch attestation
// ---------------------------------------------------------------------------

function createBillingHeader(firstUserMessageText: string): string {
  // Fingerprint: SHA256(salt + msg[4] + msg[7] + msg[20] + version)[:3],
  // chars taken from the first user message (not the system prompt).
  const k = [4, 7, 20]
    .map((i) => firstUserMessageText[i] ?? "0")
    .join("");
  const versionSuffix = createHash("sha256")
    .update(`${BILLING_SALT}${k}${CLAUDE_CODE_VERSION}`)
    .digest("hex")
    .slice(0, 3);
  // cch=00000 is a placeholder replaced with the real attestation hash before
  // the request hits the wire (see patchCch).
  return `${BILLING_HEADER_PREFIX} cc_version=${CLAUDE_CODE_VERSION}.${versionSuffix}; cc_entrypoint=claude-desktop; cch=00000;`;
}

// cch attestation: XXHash64(body_with_placeholder, seed) low-20-bits as 5 hex chars.
const CCH_SEED = 0x4d659218e32a3268n;
const CCH_PLACEHOLDER_STR = "cch=00000";
const cchEncoder = new TextEncoder();
const CCH_PLACEHOLDER = cchEncoder.encode(CCH_PLACEHOLDER_STR);
// Anchor for the billing-header placeholder inside system[0]:
// `"system":[{"type":"text","text":"x-anthropic-billing-header:` — matches the
// exact JSON prefix of the first system block. `messages` serializes before
// `system` in Anthropic SDK payloads, so user content can never collide with it.
const BILLING_SYSTEM_MARKER = cchEncoder.encode(`"system":[{"type":"text","text":"${BILLING_HEADER_PREFIX}`);
const CCH_BILLING_SEARCH_WINDOW = 150;

export type CchPatchResult = "patched" | "no-billing-header" | "unanchored";

/**
 * Replace the cch=00000 placeholder with the real attestation, in place.
 * - "patched": placeholder found anchored to the billing system block and replaced.
 * - "no-billing-header": body carries no billing system block; nothing to do.
 * - "unanchored": billing block present but the placeholder is missing or
 *   outside the anchor window — the body (placeholder included) goes out
 *   unchanged rather than corrupting an unverified position.
 */
export function patchCch(body: Uint8Array): CchPatchResult {
  const view = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  const markerIdx = view.indexOf(BILLING_SYSTEM_MARKER);
  if (markerIdx === -1) return "no-billing-header";
  const searchFrom = markerIdx + BILLING_SYSTEM_MARKER.length;
  const idx = view.indexOf(CCH_PLACEHOLDER, searchFrom);
  if (idx === -1 || idx - searchFrom > CCH_BILLING_SEARCH_WINDOW) return "unanchored";
  const h = Bun.hash.xxHash64(body, CCH_SEED);
  const cch = (h & 0xfffffn).toString(16).padStart(5, "0");
  for (let i = 0; i < 5; i++) body[idx + 4 + i] = cch.charCodeAt(i);
  return "patched";
}

// ---------------------------------------------------------------------------
// Custom tool name cloaking
// ---------------------------------------------------------------------------

const TOOL_PREFIX = "_";

// Anthropic built-in tool names are never prefixed or stripped. Server tools
// from the pinned @ai-sdk/anthropic additionally carry versioned `type` fields
// (web_search_20250305, text_editor_20250429, computer_20250124,
// code_execution_20250522, ...) on their definitions; any tool definition with
// a string `type` is a provider tool and is left untouched.
const BUILTIN_TOOL_NAMES = new Set(["web_search", "code_execution", "text_editor", "computer"]);

function isBuiltinToolName(name: string): boolean {
  return BUILTIN_TOOL_NAMES.has(name.toLowerCase());
}

export function applyClaudeToolPrefix(name: string): string {
  if (isBuiltinToolName(name)) return name;
  // Always prepend — even when the logical name already starts with "_" — so
  // stripping exactly one prefix on the way back round-trips (`_foo` →
  // `__foo` → `_foo`, never `_foo` → wire `_foo` → strip → `foo`).
  return `${TOOL_PREFIX}${name}`;
}

export function stripClaudeToolPrefix(name: string): string {
  if (!name.startsWith(TOOL_PREFIX)) return name;
  return name.slice(TOOL_PREFIX.length);
}

/**
 * Prefix every custom tool name carried by an Anthropic request body, in place:
 * custom tool definitions (no versioned `type`), `tool_choice.name`, and
 * historical assistant `tool_use` blocks. IDs and `tool_result` blocks are
 * preserved verbatim.
 */
function prefixRequestToolNames(params: Record<string, any>): void {
  if (Array.isArray(params.tools)) {
    for (const tool of params.tools) {
      // Provider/server tools are identified by a versioned `type`
      // (web_search_20250305, computer_20250124, ...); custom function tools
      // have no `type` at all.
      if (!tool || typeof tool !== "object" || typeof tool.type === "string") continue;
      if (typeof tool.name === "string") tool.name = applyClaudeToolPrefix(tool.name);
    }
  }
  const toolChoice = params.tool_choice;
  if (
    toolChoice &&
    typeof toolChoice === "object" &&
    toolChoice.type === "tool" &&
    typeof toolChoice.name === "string"
  ) {
    toolChoice.name = applyClaudeToolPrefix(toolChoice.name);
  }
  if (Array.isArray(params.messages)) {
    for (const message of params.messages) {
      if (!message || typeof message !== "object" || !Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (block?.type === "tool_use" && typeof block.name === "string") {
          block.name = applyClaudeToolPrefix(block.name);
        }
      }
    }
  }
}

/** Strip the cloaking prefix from `content[].type === "tool_use"` names in a non-streaming JSON response body. */
export function transformJsonToolUseNames(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, any>).content)) return body;
  for (const block of (parsed as Record<string, any>).content) {
    if (block?.type === "tool_use" && typeof block.name === "string") {
      block.name = stripClaudeToolPrefix(block.name);
    }
  }
  return JSON.stringify(parsed);
}

// One complete SSE event may be buffered while it is assembled across chunks.
// Anthropic messages events sit far below this; exceeding it means the stream
// is not well-formed SSE and buffering further would be unbounded.
const SSE_EVENT_BUFFER_LIMIT = 1024 * 1024;

/**
 * Incremental SSE transformer that strips exactly one cloaking prefix from
 * tool_use names inside content_block_start events and in any
 * message_start.message.content tool_use blocks. Complete SSE event records
 * are parsed across arbitrary chunk boundaries (CRLF/LF), joining multiple
 * `data:` lines per the SSE rules before JSON parsing. Events that need no
 * rewrite pass through byte-for-byte, and only the current partial event is
 * ever buffered — never the full stream. A partial event that exceeds the
 * assembly cap fails the stream with a clear error.
 */
export function createSseToolNameTransform(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  // Lines of the event being assembled: text without its terminator, plus the
  // exact terminator bytes that followed it ("\n" or "\r\n"). The terminating
  // blank line is included, so re-emitting the list reproduces the raw bytes.
  let eventLines: Array<{ text: string; eol: string }> = [];
  let eventBytes = 0;

  function uncloak(event: any): any | undefined {
    if (event?.type === "content_block_start") {
      const block = event.content_block;
      if (block?.type === "tool_use" && typeof block.name === "string") {
        return { ...event, content_block: { ...block, name: stripClaudeToolPrefix(block.name) } };
      }
      return undefined;
    }
    if (event?.type === "message_start" && Array.isArray(event.message?.content)) {
      let changed = false;
      const content = event.message.content.map((block: any) => {
        if (block?.type !== "tool_use" || typeof block.name !== "string") return block;
        changed = true;
        return { ...block, name: stripClaudeToolPrefix(block.name) };
      });
      return changed ? { ...event, message: { ...event.message, content } } : undefined;
    }
    return undefined;
  }

  /** Emit one completed event: rewritten only when its data payload carried a cloaked name. */
  function dispatch(controller: TransformStreamDefaultController<Uint8Array>): void {
    if (eventLines.length === 0) return;
    let rebuilt: string[] | undefined;
    const dataValues = eventLines
      .filter((line) => line.text.startsWith("data:"))
      .map((line) => (line.text.slice(5).startsWith(" ") ? line.text.slice(6) : line.text.slice(5)));
    if (dataValues.length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(dataValues.join("\n"));
      } catch {}
      const next = uncloak(parsed);
      if (next !== undefined) {
        // Re-emit the event verbatim except for its data lines: the first
        // carries the rewritten JSON, any additional ones are folded into it.
        const newData = `data: ${JSON.stringify(next)}`;
        rebuilt = [];
        let replaced = false;
        for (const line of eventLines) {
          if (line.text.startsWith("data:")) {
            if (!replaced) {
              rebuilt.push(`${newData}${line.eol}`);
              replaced = true;
            }
          } else {
            rebuilt.push(`${line.text}${line.eol}`);
          }
        }
      }
    }
    controller.enqueue(
      encoder.encode(rebuilt ? rebuilt.join("") : eventLines.map((line) => `${line.text}${line.eol}`).join("")),
    );
    eventLines = [];
    eventBytes = 0;
  }

  return new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      for (;;) {
        const newlineIdx = pending.indexOf("\n");
        if (newlineIdx === -1) break;
        let text = pending.slice(0, newlineIdx);
        pending = pending.slice(newlineIdx + 1);
        let eol = "\n";
        if (text.endsWith("\r")) {
          text = text.slice(0, -1);
          eol = "\r\n";
        }
        eventBytes += text.length + eol.length;
        if (eventBytes > SSE_EVENT_BUFFER_LIMIT) {
          throw new Error(
            `claude-oauth: buffered SSE event exceeded ${SSE_EVENT_BUFFER_LIMIT} bytes without a record boundary; aborting the response stream`,
          );
        }
        eventLines.push({ text, eol });
        // A blank line terminates the SSE event record.
        if (text === "") dispatch(controller);
      }
      if (eventBytes + pending.length > SSE_EVENT_BUFFER_LIMIT) {
        throw new Error(
          `claude-oauth: buffered SSE event exceeded ${SSE_EVENT_BUFFER_LIMIT} bytes without a record boundary; aborting the response stream`,
        );
      }
    },
    flush(controller) {
      pending += decoder.decode();
      if (pending.length > 0) {
        // A final line without a terminator completes the last event.
        eventLines.push({ text: pending, eol: "" });
        pending = "";
      }
      dispatch(controller);
    },
  });
}

// Non-streaming JSON bodies are read whole but bounded: a legitimate message
// response stays far below this; anything larger is a protocol error, not
// something to buffer indefinitely.
const MAX_JSON_RESPONSE_CHARS = 64 * 1024 * 1024;

async function readBoundedJsonText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length > MAX_JSON_RESPONSE_CHARS) {
      reader.cancel().catch(() => {});
      throw new Error(
        `claude-oauth: non-streaming JSON response exceeds the ${MAX_JSON_RESPONSE_CHARS}-character uncloaking bound`,
      );
    }
  }
  return text;
}

/**
 * Headers for a rewritten Response: cloned from the upstream response with
 * stale entity headers removed — they describe bytes we replaced, not the
 * transformed body. Status/statusText/content-type are preserved by the caller.
 */
function uncloakedResponseHeaders(response: Response): Headers {
  const headers = new Headers(response.headers);
  for (const key of [...headers.keys()]) {
    const lower = key.toLowerCase();
    if (
      lower === "content-length" ||
      lower === "content-encoding" ||
      lower === "etag" ||
      lower === "content-md5" ||
      lower.includes("checksum")
    ) {
      headers.delete(key);
    }
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Body rewrite
// ---------------------------------------------------------------------------

type ContentBlock = { type?: string; text?: string };

function extractFirstUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const m = message as { role?: string; content?: unknown };
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      const first = m.content.find(
        (b): b is ContentBlock => !!b && typeof b === "object" && (b as ContentBlock).type === "text",
      );
      return first?.text ?? "";
    }
    return "";
  }
  return "";
}

const CANONICAL_BODY_KEYS = [
  "model",
  "messages",
  "system",
  "tools",
  "metadata",
  "max_tokens",
  "thinking",
  "context_management",
  "output_config",
  "fallbacks",
  "stream",
];

/**
 * Rewrite a /v1/messages body into Claude Code shape:
 * - system[0] billing header (+ system[1] Agent SDK instruction)
 * - metadata.user_id in the CC attribution envelope
 * - max_tokens clamped to <= 64000
 * - context_management merged: incoming edits are preserved; active thinking
 *   additionally guarantees exactly one clear_thinking_20251015 keep-all edit
 * - known keys rebuilt in canonical order (incl. output_config / fallbacks),
 *   remaining keys appended in their original relative order;
 *   incoming `stream` is preserved as-is
 */
export function rewriteBody(
  body: string,
  ctx: { sessionId?: string; accountId?: string },
): { json: string; thinking: unknown; hasTools: boolean; sessionId?: string } {
  const params = JSON.parse(body) as Record<string, any>;
  // Cloak custom tool names before anything else, so cch hashes the
  // already-prefixed final body (patchCch runs on the encoded output below).
  prefixRequestToolNames(params);
  const hasTools = Array.isArray(params.tools) && params.tools.length > 0;

  const modelId: string = params.model ?? "";
  // Like CC: neither the billing header nor the SDK instruction goes to haiku.
  const injectFingerprint = !modelId.startsWith("claude-3-5-haiku");

  // Normalize incoming system content (string → text block, array kept as-is,
  // including caller fields like cache_control). Skip injection entirely when a
  // billing block already exists so rewrites never stack duplicate fingerprints.
  const incomingSystem = params.system;
  const systemBlocks: ContentBlock[] =
    typeof incomingSystem === "string"
      ? [{ type: "text", text: incomingSystem }]
      : Array.isArray(incomingSystem)
        ? incomingSystem
        : [];
  const hasBillingBlock =
    (typeof incomingSystem === "string" && incomingSystem.startsWith(BILLING_HEADER_PREFIX)) ||
    systemBlocks.some((block) => typeof block?.text === "string" && block.text.startsWith(BILLING_HEADER_PREFIX));

  const fingerprintBlocks: ContentBlock[] =
    injectFingerprint && !hasBillingBlock
      ? [
          { type: "text", text: createBillingHeader(extractFirstUserText(params.messages)) },
          { type: "text", text: SDK_INSTRUCTION },
        ]
      : [];
  const system = [...fingerprintBlocks, ...systemBlocks];

  // metadata.user_id: preserve valid CC attribution verbatim — the legacy
  // cloaking id or the `{device_id, session_id, ...}` JSON envelope with a
  // nonempty session_id. Anything else gets a freshly generated envelope whose
  // session matches the header-provided sessionId so Step 5 can keep header and
  // body attribution consistent.
  const incomingUserId = params.metadata?.user_id;
  let userId: string;
  if (
    typeof incomingUserId === "string" &&
    (CLOAKING_USER_ID_REGEX.test(incomingUserId) || isClaudeJsonUserId(incomingUserId))
  ) {
    userId = incomingUserId;
  } else {
    const accountId = readMetadataAccountId(params.metadata) ?? ctx.accountId;
    const envelope: Record<string, string> = {
      device_id: deriveDeviceId(accountId),
      session_id: ctx.sessionId ?? randomUUID().toLowerCase(),
    };
    if (accountId) envelope.account_uuid = accountId;
    userId = JSON.stringify(envelope);
  }
  const sessionId = extractUserIdSessionId(userId);
  const metadata = { ...params.metadata, user_id: userId };

  const thinking = params.thinking;
  // Merge, don't replace: keep any incoming context_management intact
  // (compact_20260112, clear_tool_uses_20250919, unknown future edits) and
  // only guarantee the clear-thinking edit when thinking is active. Incoming
  // objects are copied, never mutated.
  const incomingContextManagement = params.context_management;
  let contextManagement: Record<string, any> | undefined;
  if (isActiveThinking(thinking)) {
    contextManagement = {
      ...incomingContextManagement,
      edits: [
        { type: "clear_thinking_20251015", keep: "all" },
        ...((incomingContextManagement?.edits ?? []).filter(
          (edit: { type?: unknown }) => edit?.type !== "clear_thinking_20251015",
        )),
      ],
    };
  } else if (incomingContextManagement) {
    contextManagement = incomingContextManagement;
  }

  const overrides: Record<string, any> = {
    model: params.model,
    messages: params.messages,
    ...(system.length > 0 && { system }),
    // OAuth requests always carry a tools array, even an empty one (CC does).
    tools: Array.isArray(params.tools) ? params.tools : [],
    metadata,
    max_tokens: Math.min(MAX_OUTPUT_TOKENS, params.max_tokens ?? MAX_OUTPUT_TOKENS),
    ...(thinking && { thinking }),
    ...(contextManagement && { context_management: contextManagement }),
  };
  const merged = { ...params, ...overrides };

  // Rebuild known keys in canonical order, then append every remaining key in
  // its original relative order. Incoming `stream` is preserved as-is (the
  // normal SDK path sends true); undefined values drop out on stringify.
  const rewritten: Record<string, any> = {};
  for (const key of CANONICAL_BODY_KEYS) {
    if (merged[key] !== undefined) rewritten[key] = merged[key];
  }
  for (const [key, value] of Object.entries(params)) {
    if (!(key in rewritten) && value !== undefined) rewritten[key] = value;
  }

  return { json: JSON.stringify(rewritten), thinking, hasTools, sessionId };
}

export const ClaudeOAuthPlugin: Plugin = async (input: PluginInput) => {
  // Persist rotated tokens during background refreshes. Login results are
  // persisted by core directly.
  const persist = async (tokens: RefreshedCredential) => {
    // The generated client takes ONE options object; `throwOnError` lives in
    // it because the SDK otherwise resolves to a { data, error } result tuple
    // and does NOT throw on HTTP errors. The returned error is still
    // validated explicitly below, in case the option stops being honored.
    // `accountId` is a documented extension of the generated OAuth body type.
    const result = await input.client.auth.set({
      path: { id: "anthropic" },
      body: {
        type: "oauth",
        refresh: tokens.refresh,
        access: tokens.access,
        expires: tokens.expires,
        ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
      } as RefreshedCredential & { type: "oauth" },
      throwOnError: true,
    });
    if (result && typeof result === "object" && "error" in result && result.error !== undefined) {
      throw new Error(`Failed to persist refreshed Anthropic credentials: ${JSON.stringify(result.error)}`);
    }
  };

  const hooks: Hooks = {
    provider: {
      id: "anthropic",
      async models(provider, ctx) {
        if (ctx.auth?.type !== "oauth") return provider.models;
        // Subscription-billed: zero out costs so usage tracking doesn't
        // report API spend for Pro/Max requests.
        return Object.fromEntries(
          Object.entries(provider.models).map(([modelID, model]) => [
            modelID,
            {
              ...model,
              cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            },
          ]),
        );
      },
    },

    auth: {
      provider: "anthropic",
      async loader(getAuth) {
        const stored = await getAuth();
        // Auth may be absent (logged out) by the time the loader runs.
        if (stored?.type !== "oauth") return {};
        // Best-effort staleness advisory; never blocks auth.
        await warnOnStaleGrant(input.client, stored.refresh, stored.accountId);

        // Classification of whatever getAuth currently returns. The cached
        // fetch closure re-runs this on every request and again after any
        // shared refresh, so logout / API-key / re-login transitions that
        // happen mid-flight are routed correctly instead of dispatching a
        // stale bearer.
        type AuthSnapshot =
          | { kind: "missing" }
          | { kind: "api"; key: string }
          | { kind: "unsupported"; authType: string }
          | { kind: "oauth"; access: string; expires: number; refresh: string; accountId?: string };

        async function readAuth(): Promise<AuthSnapshot> {
          const raw = (await getAuth()) as
            | undefined
            | null
            | { type?: string; access?: string; expires?: number; refresh?: string; key?: string; accountId?: string };
          if (raw === undefined || raw === null) return { kind: "missing" };
          if (raw.type === "api") return { kind: "api", key: raw.key ?? "" };
          if (raw.type !== "oauth") return { kind: "unsupported", authType: String(raw.type) };
          return {
            kind: "oauth",
            access: raw.access ?? "",
            expires: raw.expires ?? 0,
            refresh: raw.refresh ?? "",
            accountId: raw.accountId,
          };
        }

        return {
          apiKey: OAUTH_DUMMY_KEY,
          // Non-secret marker for chat.headers: identifies this as an OAuth
          // session without depending on the dummy apiKey, which provider
          // config merging can overwrite.
          claudeOAuth: true,
          async fetch(requestInput: string | URL | Request, init?: RequestInit) {
            // Auth can disappear (logout) or change type (API key login, new
            // OAuth login) while this closure stays cached inside the Anthropic
            // SDK client. The CURRENT stored auth is classified exactly once,
            // here at the boundary.
            let auth = await readAuth();

            if (auth.kind === "oauth") {
              const url = requestInput instanceof URL ? requestInput : new URL(typeof requestInput === "string" ? requestInput : requestInput.url);

              // Origin allowlist: the OAuth bearer token is attached only to
              // official Anthropic API traffic. HTTP, localhost, alternate
              // hosts, credentials-in-URL, and custom baseURL destinations are
              // rejected before refresh, mutation, or dispatch — never send
              // subscription credentials to a non-official endpoint.
              if (url.origin !== OAUTH_ALLOWED_ORIGIN || url.username || url.password) {
                throw new Error(
                  `Refusing to send Claude Pro/Max OAuth credentials to "${url.origin}" - this transport only supports the official ${OAUTH_ALLOWED_ORIGIN} endpoint. Configure an Anthropic API key instead of a custom baseURL/gateway/proxy to use it there.`,
                );
              }

              // Requests carrying their own body cannot be re-targeted/re-signed
              // (the body would be dispatched without the plugin's rewrite), so
              // they are rejected here — still before any network activity.
              if (typeof requestInput !== "string" && !(requestInput instanceof URL)) {
                if (requestInput.body !== null && init?.body === undefined) {
                  throw new Error(
                    "Unsupported Anthropic request: a pre-constructed Request with a body was handed to the claude-oauth transport; expected (string | URL, RequestInit).",
                  );
                }
              }

              if (!auth.access || auth.expires < Date.now()) {
                // Shared across loader instances (in-process promise map) and
                // processes (fs lease): at most one refresh per credential.
                const refreshed = await performSharedRefresh(auth, getAuth, persist);
                if (refreshed) {
                  // Adopt the full rotated credential we just persisted — all
                  // fields, not only the access token.
                  auth = { kind: "oauth", ...refreshed };
                } else {
                  // A peer refreshed while we waited on the promise or the
                  // lease, or auth was logged out / transitioned / re-keyed
                  // underneath us: re-route on the latest persisted state,
                  // never the pre-refresh snapshot.
                  auth = await readAuth();
                }
              }
            }

            // Single dispatch boundary: route on the latest classified state.
            if (auth.kind === "missing") {
              throw new Error(
                "Anthropic credentials are missing (logged out?) - run `opencode auth login`, pick Anthropic, then choose a Claude Pro/Max method.",
              );
            }
            if (auth.kind === "unsupported") {
              throw new Error(
                `Unsupported Anthropic auth type "${auth.authType}" - run \`opencode auth login\`, pick Anthropic, then choose a Claude Pro/Max method.`,
              );
            }

            if (auth.kind === "api") {
              // Ordinary Anthropic API-key request: replace the dummy
              // x-api-key with the real one and drop OAuth-only mutations.
              // No fingerprinting, body rewrite, cch, tool cloaking, or
              // response uncloaking on this path — and no x-client-request-id:
              // that id is an OAuth-fingerprint field. This is not OAuth wire
              // traffic, so plugin-only transport markers (session id header,
              // private request id, stale bearer) are stripped too —
              // chat.headers can still emit the markers while the cached
              // claudeOAuth flag lingers.
              const headers = new Headers(init?.headers);
              headers.delete("Authorization");
              headers.delete(SESSION_ID_HEADER);
              headers.delete(REQUEST_ID_HEADER);
              headers.set("x-api-key", auth.key);
              return fetch(requestInput, { ...init, headers });
            }

            const url = requestInput instanceof URL ? requestInput : new URL(typeof requestInput === "string" ? requestInput : requestInput.url);
            const access = auth.access
            const accountId = auth.accountId
            const headers = new Headers(init?.headers)

            // Per-invocation request id from chat.headers. Read once, then
            // removed: it is a plugin-only transport marker and must never
            // reach the wire. SDK retries re-run this fetch with the same
            // prepared headers, so they reuse the id; a new logical invocation
            // carries a freshly generated one. Absent (direct request), a
            // fresh UUID is minted at dispatch below.
            const hookRequestId = headers.get(REQUEST_ID_HEADER) ?? undefined
            headers.delete(REQUEST_ID_HEADER)

            // The session header must always match the body's metadata
            // user_id session. rewriteBody returns the effective session
            // (hook-provided, preserved from a valid incoming user_id, or
            // synthesized), so the header is set from it below — never the
            // other way around.
            const hookSessionId = headers.get(SESSION_ID_HEADER) ?? undefined
            let sessionId = hookSessionId
            let body: RequestInit["body"] = init?.body
            const isMessages = url.pathname.endsWith("/messages")
            let requestTarget: typeof requestInput = requestInput
            // Claude Code hits the official API with ?beta=true on /messages;
            // existing query params are preserved.
            if (isMessages && url.hostname === "api.anthropic.com") {
              url.searchParams.set("beta", "true")
              requestTarget = url
            }
            if (isMessages && typeof body === "string" && body.startsWith("{")) {
              const { json, thinking, hasTools, sessionId: bodySessionId } = rewriteBody(body, {
                sessionId: hookSessionId,
                accountId,
              })
              sessionId = bodySessionId
              const encoded = cchEncoder.encode(json)
              if (patchCch(encoded) === "unanchored") {
                // Advisory only: the billing block is present but the
                // placeholder could not be safely anchored, so the body goes
                // out with the placeholder intact. Never fails the request and
                // never adds wire headers.
                input.client.app
                  .log({
                    body: {
                      service: "claude-oauth",
                      level: "warn",
                      message:
                        "Anthropic request carried a billing attestation placeholder that could not be anchored to the billing system block; it was sent unreplaced.",
                    },
                  })
                  .catch(() => {})
              }
              body = encoded
              // Headers.get is case-insensitive, so SDK betas arrive regardless
              // of the caller's key casing.
              headers.set("anthropic-beta", buildBetas(thinking, hasTools, headers.get("anthropic-beta")))
            }

            headers.delete("x-api-key")
            headers.set("Authorization", `Bearer ${access}`)
            if (isMessages) {
              // Preserve genuine claude-cli callers; everything else gets the
              // fixed cowork UA (case-insensitive prefix check).
              const incomingUserAgent = headers.get("User-Agent")
              headers.set(
                "User-Agent",
                incomingUserAgent?.toLowerCase().startsWith("claude-cli") ? incomingUserAgent : USER_AGENT,
              )
              headers.set("Accept", "application/json")
              headers.set("Content-Type", "application/json")
              headers.set("anthropic-version", "2023-06-01")
              headers.set("anthropic-dangerous-direct-browser-access", "true")
              headers.set("x-app", "cli")
              headers.set("Connection", "keep-alive")
              headers.set("Accept-Encoding", "gzip, deflate, br, zstd")
              // Retry-stable across SDK retries of this invocation (they reuse
              // the prepared headers), fresh per logical invocation.
              headers.set("x-client-request-id", hookRequestId ?? randomUUID())
              for (const [key, value] of Object.entries(STAINLESS_HEADERS)) headers.set(key, value)
            }
            if (sessionId) headers.set("X-Claude-Code-Session-Id", sessionId)

            const response = await fetch(requestTarget, { ...init, headers, body })
            if (!isMessages) return response
            // Uncloak custom tool names on the way back. Streaming responses are
            // rewritten incrementally (no full buffering); non-streaming JSON
            // bodies are transformed whole within a bounded read. Rewritten
            // responses get cloned headers with stale entity headers stripped.
            const contentType = response.headers.get("content-type") ?? ""
            if (contentType.includes("text/event-stream")) {
              if (!response.body) return response
              return new Response(response.body.pipeThrough(createSseToolNameTransform()), {
                status: response.status,
                statusText: response.statusText,
                headers: uncloakedResponseHeaders(response),
              })
            }
            if (contentType.includes("application/json")) {
              const text = await readBoundedJsonText(response)
              return new Response(transformJsonToolUseNames(text), {
                status: response.status,
                statusText: response.statusText,
                headers: uncloakedResponseHeaders(response),
              })
            }
            return response
          },
        }
      },

      methods: [
        {
          type: "oauth",
          label: "Claude Pro/Max (browser)",
          authorize: async () => {
            const pkce = await generatePKCE()
            const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
            // Register/reserve the flow BEFORE starting the server: while any
            // flow is in setup, pendingFlows is nonempty, so another flow
            // settling can never auto-close the server beneath this authorize()
            // call. Registration before returning also retains a redirect that
            // lands before OpenCode invokes callback().
            const codePromise = registerFlow(state)
            try {
              const server = await startCallbackServer()
              const port = (server.address() as AddressInfo).port
              const redirectUri = `http://${CALLBACK_HOST}:${port}${CALLBACK_PATH}`
              return {
                url: buildAuthorizeUrl(redirectUri, pkce, state),
                instructions:
                  "Complete login in your browser. Note: the OAuth grant typically stays valid for around 30 days (an observed lifetime, not a guaranteed protocol limit) — after that you may need to re-login.",
                method: "auto" as const,
                callback: async () => {
                  // The flow settles (and cleans itself up) via the callback
                  // server, its timeout, or disposal; success/failure/timeout all
                  // remove it from the pending map and stop the server when no
                  // flows remain.
                  const code = await codePromise
                  const tokens = await exchangeCode(code, state, pkce.verifier, redirectUri)
                  recordAuthorizedAt(tokens.refresh, tokens.accountId)
                  return { type: "success" as const, ...tokens }
                },
              }
            } catch (error) {
              // Startup/build failed: settle exactly this flow so it does not
              // linger until its timeout. Other flows are untouched.
              const flow = pendingFlows.get(state)
              if (flow) settleFlow(flow, { error: error instanceof Error ? error : new Error(String(error)) })
              throw error
            }
          },
        },
        {
          type: "oauth",
          label: "Claude Pro/Max (paste code)",
          authorize: async () => {
            // Serverless: no callback server is started; the redirect URI is
            // only echoed back in the token exchange.
            const redirectUri = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`
            const pkce = await generatePKCE()
            const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
            // Five-minute authorization window, mirroring FLOW_TIMEOUT_MS.
            const startedAt = Date.now()
            return {
              url: buildAuthorizeUrl(redirectUri, pkce, state),
              instructions:
                "Open the URL, complete login, then paste the redirected URL or just the authorization code (it may look like `<code>#<state>`) within 5 minutes. Note: the OAuth grant typically stays valid for around 30 days (an observed lifetime, not a guaranteed protocol limit) — after that you may need to re-login.",
              method: "code" as const,
              callback: async (pasted: string) => {
                const failed = (reason: string): { type: "failed" } => {
                  // Actionable detail goes to logs only; it must never echo
                  // the pasted code or state. Logging is best-effort.
                  try {
                    input.client.app
                      .log({
                        body: {
                          service: "claude-oauth",
                          level: "warn",
                          message: `Claude Pro/Max paste-code login failed (${reason}). Restart login with \`opencode auth login\`.`,
                        },
                      })
                      .catch(() => {})
                  } catch {}
                  return { type: "failed" }
                }
                if (Date.now() - startedAt > FLOW_TIMEOUT_MS) {
                  return failed("the 5-minute authorization window expired")
                }
                try {
                  // Accept a bare code (`code#state`) or the full redirect URL,
                  // and validate any accompanying state locally BEFORE the
                  // token exchange.
                  let code = pasted.trim()
                  let pastedState = ""
                  try {
                    const parsed = new URL(code)
                    const urlCode = parsed.searchParams.get("code")
                    if (urlCode) {
                      code = urlCode
                      pastedState = parsed.searchParams.get("state") ?? ""
                    }
                  } catch {}
                  const fragment = code.indexOf("#")
                  if (fragment >= 0) {
                    pastedState = code.slice(fragment + 1)
                    code = code.slice(0, fragment)
                  }
                  if (pastedState.length > 0 && pastedState !== state) {
                    return failed("the pasted state does not match this login session")
                  }
                  const tokens = await exchangeCode(code, state, pkce.verifier, redirectUri)
                  recordAuthorizedAt(tokens.refresh, tokens.accountId)
                  return { type: "success" as const, ...tokens }
                } catch {
                  // Never surface the pasted code/state or raw endpoint errors.
                  return failed("the authorization code was rejected")
                }
              },
            }
          },
        },
        {
          type: "api",
          label: "Anthropic API key",
        },
      ],
    },

    "chat.headers": async (input, output) => {
      if (input.model.providerID !== "anthropic") return
      // Only fingerprint OAuth sessions; API-key traffic never carries the
      // markers. Marker-based so provider config apiKey merging (which replaces
      // the dummy key) cannot disable stable session propagation.
      if ((input.provider.options as Record<string, unknown>).claudeOAuth !== true) return
      output.headers["X-Claude-Code-Session-Id"] = input.sessionID
      // Fresh UUID per logical OpenCode LLM invocation, transported in the
      // private plugin header and emitted as x-client-request-id by the auth
      // fetch. SDK retries reuse the prepared headers — and therefore this id;
      // a separate identical invocation runs this hook again and gets a new one.
      output.headers[REQUEST_ID_HEADER] = randomUUID()
    },

    dispose: async () => {
      disposeOAuth()
    },
  }
  return hooks
}

export default {
  id: "claude_oauth",
  server: ClaudeOAuthPlugin,
}
