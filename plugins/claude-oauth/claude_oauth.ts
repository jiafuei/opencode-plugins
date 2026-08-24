import type { Hooks, Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildBetas,
  CLI_PROFILE,
  countTokensBetas,
  createSseToolNameTransform,
  extractUserIdSessionId,
  prefixRequestToolNames,
  readBoundedJsonText,
  REQUEST_ID_PATTERN,
  resolveSpoofingProfile,
  rewriteBody,
  stainlessHeaders,
  transformJsonToolUseNames,
  uncloakedResponseHeaders,
} from "./wire_format.ts";
import type { SpoofingProfile } from "./wire_format.ts";
import { RequestChainTracker, requestChainCredentialKey } from "./request_chain.ts";
import { deriveDeviceId, opencodeDataDir, readClaudeCodeDeviceId, readMekaDeviceId } from "./local_storage.ts";
import { buildEnforcedHeaders, coworkTransport } from "./cowork_fetch.ts";

// Preserve the historical public API: tests and package consumers import these
// from the plugin entry.
export {
  applyClaudeToolPrefix,
  buildBetas,
  createSseToolNameTransform,
  mapStainlessArch,
  rewriteBody,
  stripClaudeToolPrefix,
  transformJsonToolUseNames,
} from "./wire_format.ts";
export { resolveSpoofingProfile } from "./wire_format.ts";
export type { SpoofingProfile } from "./wire_format.ts";

// Configure in `opencode.json` like:
//
// {
//   "plugin": ["@jiafuei/opencode-claude-oauth"]
// }
//
// Then run `opencode auth login`, pick Anthropic, and choose Claude Pro/Max.
// Requests to the Anthropic provider are then
// fingerprinted to look exactly like Claude Code (claude-cli) subscription
// traffic, so your Pro/Max subscription is used instead of API credits.

function rot13(value: string): string {
  return value.replace(/[a-z]/gi, (char) => String.fromCharCode(char.charCodeAt(0) + (char.toLowerCase() < "n" ? 13 : -13)));
}

const CLIENT_ID = rot13("9q1p250n-r61o-44q9-88rq-5944q1962s5r"); // Claude Code's public OAuth client ID
const AUTHORIZE_URL = rot13("uggcf://pynhqr.pbz/pnv/bnhgu/nhgubevmr");
const TOKEN_URL = rot13("uggcf://cyngsbez.pynhqr.pbz/i1/bnhgu/gbxra");
const PROFILE_URL = rot13("uggcf://ncv.naguebcvp.pbz/ncv/bnhgu/cebsvyr");
const ROLES_URL = rot13("uggcf://ncv.naguebcvp.pbz/ncv/bnhgu/pynhqr_pyv/ebyrf");
const REDIRECT_URI = rot13("uggcf://cyngsbez.pynhqr.pbz/bnhgu/pbqr/pnyyonpx");
const SCOPES =
  rot13("bet:perngr_ncv_xrl hfre:cebsvyr hfre:vasrerapr hfre:frffvbaf:pynhqr_pbqr hfre:zpc_freiref hfre:svyr_hcybnq");
const REFRESH_SCOPES = rot13("hfre:cebsvyr hfre:vasrerapr hfre:frffvbaf:pynhqr_pbqr hfre:zpc_freiref hfre:svyr_hcybnq");

const AXIOS_USER_AGENT = "axios/1.15.2";
const AXIOS_ACCEPT = "application/json, text/plain, */*";
const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key";
const SESSION_ID_HEADER = "x-claude-code-session-id";
const OPENCODE_SESSION_ID_HEADER = "x-claude-oauth-session-id";
// Plugin-only transport header: carries the per-invocation request id from
// chat.headers into the auth fetch. Like the session marker, it is stripped
// before anything hits the wire.
const REQUEST_ID_HEADER = "x-claude-oauth-request-id";
const PROMPT_ID_HEADER = "x-claude-oauth-prompt-id";

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
  const verifier = randomBytes(32).toString("base64url");
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
 * and/or the OAuth profile and Claude CLI roles endpoints.
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
const OAUTH_ALLOWED_ORIGIN = rot13("uggcf://ncv.naguebcvp.pbz");

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
    headers: {
      Accept: AXIOS_ACCEPT,
      "User-Agent": AXIOS_USER_AGENT,
      ...extraHeaders,
      "Content-Type": "application/json",
    },
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
 * Identity recovery from Claude Code's profile and roles endpoints. Profile
 * failures are surfaced to callers; roles are optional and only enrich the
 * organization name.
 */
export async function fetchOAuthIdentity(accessToken: string): Promise<OAuthIdentity> {
  const [profileResult, rolesResult] = await Promise.allSettled([
    fetch(PROFILE_URL, {
      headers: {
        Accept: AXIOS_ACCEPT,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "User-Agent": AXIOS_USER_AGENT,
      },
      signal: AbortSignal.timeout(10_000),
    }),
    fetch(ROLES_URL, {
      headers: {
        Accept: AXIOS_ACCEPT,
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": AXIOS_USER_AGENT,
      },
      signal: AbortSignal.timeout(10_000),
    }),
  ]);
  if (profileResult.status === "rejected") throw profileResult.reason;
  const profileResponse = profileResult.value;
  if (!profileResponse.ok) throw new Error(`Anthropic profile request failed: ${profileResponse.status}`);
  const data = (await profileResponse.json()) as {
    account?: { uuid?: string; email?: string };
    organization?: { uuid?: string; name?: string };
  };
  let roles: { organization_uuid?: string; organization_name?: string } | undefined;
  if (rolesResult.status === "fulfilled" && rolesResult.value.ok) {
    try {
      roles = (await rolesResult.value.json()) as typeof roles;
    } catch {}
  }
  return {
    accountId: nonEmpty(data.account?.uuid),
    email: nonEmpty(data.account?.email),
    orgId: nonEmpty(data.organization?.uuid) ?? nonEmpty(roles?.organization_uuid),
    orgName: nonEmpty(data.organization?.name) ?? nonEmpty(roles?.organization_name),
  };
}

/**
 * Resolve account (and optionally organization) identity for a token
 * response, merging the token response over profile recovery. `includeOrg`
 * is login-only: the org a token is scoped to is captured once when the
 * credential is created and deliberately never refreshed afterwards —
 * rewriting org identity during background refreshes could silently re-key
 * stored credentials. Every profile recovery failure (network, non-OK, timeout,
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
    const recovered = await fetchOAuthIdentity(data.access_token);
    return {
      accountId: identity.accountId ?? recovered.accountId,
      email: identity.email ?? recovered.email,
      orgId: identity.orgId ?? recovered.orgId,
      orgName: identity.orgName ?? recovered.orgName,
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
  const data = await postToken({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    state,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });

  // Login captures the full identity once: profile recovery runs whenever account
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
      scope: REFRESH_SCOPES,
    },
    undefined,
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

function claudeOAuthDatabaseFile(): string {
  return process.env.NODE_ENV === "test" ? ":memory:" : path.join(opencodeDataDir(), "claude-oauth", "claude-oauth.db");
}

// A lease holder that crashed mid-refresh is stolen after this long. Must
// safely exceed the worst-case in-lease work: one token refresh (30s timeout)
// plus profile/roles recovery (10s timeout), with ample room so a slow-but-live
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
  const credentialIdentity = `${startAuth.accountId ?? ""}:${startAuth.refresh}`;
  const key = inFlightKey(startAuth.accountId, startAuth.refresh);
  const inFlight = inFlightRefreshes.get(key);
  if (inFlight) return inFlight;
  const promise = (async (): Promise<RefreshedCredential | null> => {
    // The on-disk lease stays keyed by the composite identity (hashed once
    // inside refreshLeaseDir); only the in-process map key is the extra hash.
    const dir = refreshLeaseDir(credentialIdentity);
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
  grantsLockDir,
  acquireGrantsLock,
  releaseGrantsLock,
  readGrantsLockOwner,
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
// updates. The critical section is synchronous and normally lasts only
// milliseconds; a live holder is never stolen, while a dead holder's exact
// lock directory is atomically quarantined before a replacement is installed.
const GRANT_LOCK_WAIT_MS = 10_000;

function grantsLockDir(): string {
  return path.join(opencodeDataDir(), "claude-oauth", "grants.lock");
}

interface GrantsLockOwner {
  owner: string;
  pid: number;
  at: number;
}

/** Read and validate the recorded lock owner; undefined when missing/malformed. */
function readGrantsLockOwner(dir: string): GrantsLockOwner | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path.join(dir, "owner"), "utf8")) as Partial<GrantsLockOwner>;
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

function processIsAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Atomically install a prepared owner directory; returns its owner token. */
function acquireGrantsLock(): string {
  const dir = grantsLockDir();
  mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
  const ownerId = randomBytes(16).toString("hex");
  const claim = `${dir}.claim-${ownerId}`;
  const deadline = Date.now() + GRANT_LOCK_WAIT_MS;
  mkdirSync(claim);
  try {
    writeFileSync(
      path.join(claim, "owner"),
      JSON.stringify({ owner: ownerId, pid: process.pid, at: Date.now() } satisfies GrantsLockOwner),
      { mode: 0o600 },
    );
    for (;;) {
      try {
        renameSync(claim, dir);
        return ownerId;
      } catch {
        const current = readGrantsLockOwner(dir);
        if (current && !processIsAlive(current.pid)) {
          // The destination includes the observed owner's random token and is
          // intentionally retained. Only one waiter can quarantine this exact
          // dead lock; lagging waiters cannot rename a replacement over it.
          try {
            renameSync(dir, `${dir}.stale-${current.owner}`);
          } catch {}
          continue;
        }
        if (Date.now() >= deadline) throw new Error("Timed out waiting for the grants lock");
        Bun.sleepSync(2);
      }
    }
  } catch (error) {
    rmSync(claim, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Release only the lock we still own — never a replacement installed by a
 * stale-takeover stealer or another process. Without a readable owner record
 * ownership cannot be proven, so the directory is left alone.
 */
function releaseGrantsLock(ownerId: string): void {
  const dir = grantsLockDir();
  if (readGrantsLockOwner(dir)?.owner !== ownerId) return;
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Record when a fresh grant was created. Called on login success only —
 * refresh rotation must never reset authorizedAt. Failures are swallowed so a
 * timestamp write can never fail the login itself.
 */
export function recordAuthorizedAt(refreshToken: string, accountId?: string): void {
  try {
    const ownerId = acquireGrantsLock();
    try {
      const grants = readGrants();
      grants[grantKey(refreshToken, accountId)] = grantTestSeam.clock.now();
      writeGrants(grants);
    } finally {
      releaseGrantsLock(ownerId);
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
    const ownerId = acquireGrantsLock();
    try {
      const grants = readGrants();
      if (grants[accountKey] !== undefined || grants[legacyKey] === undefined) return;
      grants[accountKey] = grants[legacyKey]!;
      delete grants[legacyKey];
      writeGrants(grants);
    } finally {
      releaseGrantsLock(ownerId);
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
 * absolute lifetime. Notification failures are swallowed so they never block auth.
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
  const ageDays = Math.floor(ageMs / DAY_MS);
  try {
    await client.app.log({
      body: {
        service: "claude-oauth",
        level: "warn",
        message:
          `Anthropic OAuth grant for ${accountId ? `account ${accountId}` : "this credential"} is ~${ageDays} days old. ` +
          "~30 days is an observed heuristic for the absolute grant lifetime — interactive re-login (`opencode auth login` → Anthropic → Claude Pro/Max) may soon be required.",
        extra: { ageDays },
      },
    });
  } catch {}
  try {
    await client.tui.showToast({
      body: {
        title: "Anthropic OAuth grant expiring soon",
        message: `Grant is ~${ageDays} days old. Run opencode auth login and select Anthropic → Claude Pro/Max soon.`,
        variant: "warning",
        duration: 10_000,
      },
    });
  } catch {}
}

const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    // Non-standard: required by Claude's authorization page to return the raw code.
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

export interface ClaudeOAuthOptions {
  attributionHeader?: boolean;
  /**
   * Client identity spoofed on the Anthropic wire: "cli" (default) mirrors
   * Claude Code 2.1.241; "cli-meka" mirrors meka's Claude subscription
   * provider; "cowork" mirrors oh-my-pi's Cowork desktop-agent; "sdk-cli"
   * mirrors pi-black's Agent SDK CLI identity. Every profile uses the ordered
   * HTTP/1.1 transport.
   */
  spoofingProfile?: SpoofingProfile["id"];
}

type ClaudeOAuthInternalOptions = ClaudeOAuthOptions & { databasePath?: string };

export const ClaudeOAuthPlugin: Plugin = async (input: PluginInput, options?: PluginOptions | ClaudeOAuthOptions) => {
  const pluginOptions = options as ClaudeOAuthInternalOptions | undefined;
  // Validated once at the option boundary; unsupported values throw here.
  const profile = resolveSpoofingProfile(pluginOptions?.spoofingProfile);
  const attributionHeader = pluginOptions?.attributionHeader !== false;
  const deviceId = profile.id === "cli"
    ? readClaudeCodeDeviceId()
    : profile.id === "cli-meka"
      ? readMekaDeviceId() ?? deriveDeviceId()
      : undefined;
  const profileSessionId = profile.id === "cli-meka" ? randomUUID() : undefined;
  const promptIds = new Map<string, Map<string, string>>();
  // Owns SQLite persistence, the process-local fallback, and every
  // generation/retry-sequencing, reset, delete, and close operation.
  const requestChains = new RequestChainTracker(
    pluginOptions?.databasePath ?? (profile.id === "cli-meka" ? ":memory:" : claudeOAuthDatabaseFile()),
  );
  let activeRequestCredential: string | undefined;
  let previousAccessFingerprint: string | undefined;
  let requestStateGeneration = 0;

  // Shared login-success tail for both authorize methods: exchange the code,
  // invalidate every previous-request chain (a fresh login must not inherit
  // prior attribution), and record the grant timestamp.
  const finishLogin = async (code: string, state: string, verifier: string, redirectUri: string) => {
    const tokens = await exchangeCode(code, state, verifier, redirectUri);
    requestChains.resetAll();
    recordAuthorizedAt(tokens.refresh, tokens.accountId);
    return { type: "success" as const, ...tokens };
  };

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
            let url: URL | undefined;

            if (auth.kind === "oauth") {
              url = requestInput instanceof URL ? requestInput : new URL(typeof requestInput === "string" ? requestInput : requestInput.url);

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
            // Every non-OAuth outcome first tears down the request chain of
            // the previously active credential — leaving OAuth (logout,
            // unsupported type, or an ordinary API key) must not leave stale
            // prev-request state behind.
            if (auth.kind !== "oauth") {
              if (activeRequestCredential) requestChains.resetCredential(activeRequestCredential);
              activeRequestCredential = undefined;
              previousAccessFingerprint = undefined;
              requestStateGeneration++;
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
                headers.delete(PROMPT_ID_HEADER);
                headers.set("x-api-key", auth.key);
                return fetch(requestInput, { ...init, headers });
              }
              throw new Error(
                auth.kind === "missing"
                  ? "Anthropic credentials are missing (logged out?) - run `opencode auth login`, pick Anthropic, then choose a Claude Pro/Max method."
                  : `Unsupported Anthropic auth type "${auth.authType}" - run \`opencode auth login\`, pick Anthropic, then choose a Claude Pro/Max method.`,
              );
            }

            if (!url) throw new Error("OAuth request URL was not initialized");
            const access = auth.access
            const accountId = auth.accountId
            const headers = new Headers(init?.headers)
            const isSubagent = headers.has("x-parent-session-id")
            headers.delete("x-session-affinity")
            headers.delete("x-session-id")
            headers.delete("x-parent-session-id")
            const requestCredential = requestChainCredentialKey(auth.refresh, accountId)
            const accessFingerprint = createHash("sha256").update(access).digest("hex")
            activeRequestCredential = requestCredential
            if (accessFingerprint !== previousAccessFingerprint) {
              previousAccessFingerprint = accessFingerprint
              requestStateGeneration++
            }
            const requestGeneration = requestStateGeneration

            // Per-invocation request id from chat.headers. Read once, then
            // removed: it is a plugin-only transport marker and must never
            // reach the wire. SDK retries re-run this fetch with the same
            // prepared headers, so they reuse the id; a new logical invocation
            // carries a freshly generated one. Absent (direct request), a
            // fresh UUID is minted at dispatch below.
            const hookRequestId = headers.get(REQUEST_ID_HEADER) ?? undefined
            headers.delete(REQUEST_ID_HEADER)
            const logicalRequestId = hookRequestId ?? randomUUID()
            const promptId = headers.get(PROMPT_ID_HEADER) ?? undefined
            headers.delete(PROMPT_ID_HEADER)

            // The session header must always match the body's metadata
            // user_id session. rewriteBody returns the effective session
            // (hook-provided, preserved from a valid incoming user_id, or
            // synthesized), so the header is set from it below — never the
            // other way around.
            const opencodeSessionId = headers.get(OPENCODE_SESSION_ID_HEADER) ?? undefined
            headers.delete(OPENCODE_SESSION_ID_HEADER)
            const hookSessionId = headers.get(SESSION_ID_HEADER) ?? profileSessionId
            // Reinsert at dispatch so Bun serializes Claude Code's title casing
            // instead of retaining the SDK-normalized lowercase field name.
            headers.delete(SESSION_ID_HEADER)
            let sessionId = hookSessionId
            let body: RequestInit["body"] = init?.body
            let requestChain:
              | { sessionId: string; requestId?: string; generation: number; sequence: number }
              | undefined
            const isMessages = url.pathname === "/v1/messages"
            const isCountTokens = url.pathname === "/v1/messages/count_tokens"
            const isMessagesApi = isMessages || isCountTokens
            let requestTarget: typeof requestInput = requestInput
            // Claude Code hits the official API with ?beta=true on /messages;
            // existing query params are preserved.
            if (isMessagesApi && url.hostname === "api.anthropic.com") {
              url.searchParams.set("beta", "true")
              requestTarget = url
            }
            if (isMessages && typeof body === "string" && body.startsWith("{")) {
              const incomingUserId = (JSON.parse(body) as Record<string, any>).metadata?.user_id
              const attributedSessionId = typeof incomingUserId === "string" ? extractUserIdSessionId(incomingUserId) : undefined
              const initialChainSessionId = opencodeSessionId ?? hookSessionId ?? attributedSessionId
              // CLI and Meka track request chains; the Agent SDK profiles do not.
              if (profile.billingChain && attributionHeader && initialChainSessionId) {
                requestChain = {
                  sessionId: initialChainSessionId,
                  ...requestChains.startRequest(requestCredential, initialChainSessionId, logicalRequestId),
                }
              }
              const { json, thinking, hasTools, hasLongCache, model, sessionId: rewrittenSessionId } = rewriteBody(body, {
                sessionId: hookSessionId,
                accountId,
                attributionHeader,
                previousRequestId: requestChain?.requestId,
                promptId,
                isSubagent,
                deviceId,
                profile,
              })
              sessionId = rewrittenSessionId
              if (!requestChain && profile.billingChain && attributionHeader && sessionId) {
                requestChain = {
                  sessionId,
                  ...requestChains.startRequest(requestCredential, sessionId, logicalRequestId),
                }
              }
              body = json
              // Headers.get is case-insensitive, so SDK betas arrive regardless
              // of the caller's key casing.
              headers.set("anthropic-beta", buildBetas(thinking, hasTools, hasLongCache, headers.get("anthropic-beta"), profile, model))
            } else if (isCountTokens && typeof body === "string" && body.startsWith("{")) {
              const params = JSON.parse(body) as Record<string, any>
              prefixRequestToolNames(params, profile)
              body = JSON.stringify(params)
              headers.set("anthropic-beta", countTokensBetas(profile))
            }

            headers.delete("x-api-key")
            let response: Response
            if (isMessagesApi) {
              // Every spoofing profile uses the ordered HTTP/1.1 transport.
              // It only engages for a plain header record, which this builder
              // supplies in the profile's captured order.
              const stainless = stainlessHeaders(profile)
              if (isCountTokens) delete stainless["X-Stainless-Timeout"]
              const wireHeaders = buildEnforcedHeaders(headers, {
                profile: profile.id,
                userAgent: profile.userAgent,
                sessionId,
                betas: headers.get("anthropic-beta") ?? undefined,
                authorization: `Bearer ${access}`,
                clientRequestId: profile.id === "cli-meka" ? randomUUID() : logicalRequestId,
                stainless,
              })
              response = await coworkTransport.impl(requestTarget, {
                ...init,
                method: init?.method ?? "POST",
                headers: wireHeaders,
                body,
                signal: init?.signal,
              })
            } else {
              headers.set("Authorization", `Bearer ${access}`)
              if (sessionId) headers.set("X-Claude-Code-Session-Id", sessionId)
              response = await fetch(requestTarget, { ...init, headers, body })
            }
            if (!isMessages) return response
            const responseRequestId = response.headers.get("request-id")
            const completedChain = requestChain
            const recordPreviousRequest =
              response.ok && completedChain && responseRequestId && REQUEST_ID_PATTERN.test(responseRequestId)
                ? async () => {
                    let latest: AuthSnapshot;
                    try {
                      latest = await readAuth()
                    } catch {
                      return
                    }
                    if (latest.kind !== "oauth") {
                      requestChains.resetCredential(requestCredential)
                      requestStateGeneration++
                      return
                    }
                    const latestCredential = requestChainCredentialKey(latest.refresh, latest.accountId)
                    if (latestCredential !== requestCredential) {
                      requestChains.resetCredential(requestCredential)
                      requestStateGeneration++
                      return
                    }
                    if (createHash("sha256").update(latest.access).digest("hex") !== accessFingerprint) return
                    if (requestStateGeneration !== requestGeneration) return
                    requestChains.completeRequest(
                      requestCredential,
                      completedChain.sessionId,
                      logicalRequestId,
                      completedChain.generation,
                      completedChain.sequence,
                      responseRequestId,
                    )
                  }
                : undefined
            // Uncloak custom tool names on the way back. Streaming responses are
            // rewritten incrementally (no full buffering); non-streaming JSON
            // bodies are transformed whole within a bounded read. Rewritten
            // responses get cloned headers with stale entity headers stripped.
            const contentType = response.headers.get("content-type") ?? ""
            if (contentType.includes("text/event-stream")) {
              if (!response.body) return response
              return new Response(response.body.pipeThrough(createSseToolNameTransform(recordPreviousRequest, profile.toolPrefix)), {
                status: response.status,
                statusText: response.statusText,
                headers: uncloakedResponseHeaders(response),
              })
            }
            if (contentType.includes("application/json")) {
              const text = await readBoundedJsonText(response)
              const transformed = transformJsonToolUseNames(text, profile.toolPrefix)
              try {
                if ((JSON.parse(text) as { type?: unknown }).type === "message") await recordPreviousRequest?.()
              } catch {}
              return new Response(transformed, {
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
          label: "Claude Pro/Max",
          authorize: async () => {
            const pkce = await generatePKCE()
            const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
            const startedAt = Date.now()
            return {
              url: buildAuthorizeUrl(REDIRECT_URI, pkce, state),
              instructions:
                "Complete login in your browser, then paste the authorization code shown by Claude within 5 minutes. It may look like `<code>#<state>`. Note: the OAuth grant typically stays valid for around 30 days (an observed lifetime, not a guaranteed protocol limit) — after that you may need to re-login.",
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
                  const tokens = await finishLogin(code, state, pkce.verifier, REDIRECT_URI)
                  return tokens
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
      output.headers["X-Claude-Code-Session-Id"] = profileSessionId ?? requestChains.claudeSessionId(input.sessionID)
      output.headers[OPENCODE_SESSION_ID_HEADER] = input.sessionID
      // Fresh UUID per logical OpenCode LLM invocation, transported in the
      // private plugin header and emitted as x-client-request-id by the auth
      // fetch. SDK retries reuse the prepared headers — and therefore this id;
      // a separate identical invocation runs this hook again and gets a new one.
      output.headers[REQUEST_ID_HEADER] = randomUUID()
      // CLI and Meka carry billing prompt attribution; the Agent SDK profiles
      // never allocate or transport a private prompt-id marker.
      if (attributionHeader && profile.billingChain) {
        let sessionPrompts = promptIds.get(input.sessionID)
        if (!sessionPrompts) {
          sessionPrompts = new Map()
          promptIds.set(input.sessionID, sessionPrompts)
        }
        let promptId = sessionPrompts.get(input.message.id)
        if (!promptId) {
          promptId = randomUUID()
          sessionPrompts.set(input.message.id, promptId)
        }
        output.headers[PROMPT_ID_HEADER] = promptId
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const sessionId = event.properties.info.id
        requestChains.deleteSession(sessionId)
        promptIds.delete(sessionId)
      }
      if (event.type === "session.compacted") {
        const sessionId = event.properties.sessionID
        requestChains.resetSession(sessionId)
        promptIds.delete(sessionId)
      }
    },

    dispose: async () => {
      promptIds.clear()
      requestChains.close()
    },
  }
  return hooks
}

export default {
  id: "claude_oauth",
  server: ClaudeOAuthPlugin,
}
