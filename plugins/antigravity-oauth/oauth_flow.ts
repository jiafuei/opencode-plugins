/**
 * Antigravity OAuth: Google installed-app authorization-code flow plus Cloud
 * Code Assist project discovery/provisioning. Login and provisioning mirror
 * the IDE's Electron (Node) client; token refresh mirrors the language
 * server's Go client, which refreshes for inference. Both go through
 * `transport.ts` so the requests carry each client's header framing.
 *
 * All network functions take an injectable `fetcher` so tests stay fully
 * mocked. Errors carry status/message only — never credential material.
 */

import { go2Fetch, nodeFetch } from "./transport.ts";
import {
  ANTIGRAVITY_DAILY_ENDPOINT,
  getAntigravityNodeUserAgent,
  getAntigravityVersion,
} from "./wire.ts";

// Native Antigravity installed-app client (base64 exactly as upstream ships it).
const CLIENT_ID = atob(
  "MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
);
const CLIENT_SECRET = atob("R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=");

/** Native redirects go to `http://localhost:<ephemeral port>/oauth-callback`. */
export const CALLBACK_PATH = "/oauth-callback";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/** Per-request timeout for provisioning-phase HTTP calls (OMP OAUTH_REQUEST_TIMEOUT_MS). */
const OAUTH_REQUEST_TIMEOUT_MS = 30_000;
/** LRO polling cadence and overall deadline for onboardUser (OMP constants). */
const ONBOARD_POLL_INTERVAL_MS = 1_000;
const ONBOARD_TIMEOUT_MS = 30_000;
/** Access-token lifetimes are shortened by this skew so requests never send near-stale bearers. */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

const FREE_TIER_ID = "free-tier";

const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

/** google-api-nodejs-client identification sent by the IDE's Node side. */
const NODE_API_CLIENT = "gl-node/22.21.1";

/** Client metadata the IDE's Node side sends with loadCodeAssist and onboardUser. */
function nodeIdeMetadata(): Record<string, string> {
  return { ide_type: "ANTIGRAVITY", ide_version: getAntigravityVersion(), ide_name: "antigravity" };
}

export interface OAuthCredentials {
  refresh: string;
  access: string;
  expires: number;
  projectId: string;
  email?: string;
}

// ---------------------------------------------------------------------------
// Authorization URL & state
// ---------------------------------------------------------------------------

export function newOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build the Google authorization URL. The native flow uses offline access
 * with consent prompt; state is the CSRF token. No PKCE: the current native
 * Antigravity flow does not use a code challenge.
 */
export function buildAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * Extract and validate an authorization code from pasted user input. Accepts
 * a bare code, a full redirect URL, or `code#state`; when a state accompanies
 * the code it must match `expectedState`. Returns undefined on mismatch.
 */
export function extractPastedCode(input: string, expectedState?: string): string | undefined {
  let code = input.trim();
  let state = "";
  try {
    const parsed = new URL(code);
    const urlCode = parsed.searchParams.get("code");
    if (urlCode) {
      code = urlCode;
      state = parsed.searchParams.get("state") ?? "";
    }
  } catch {}
  const fragment = code.indexOf("#");
  if (fragment >= 0) {
    state = code.slice(fragment + 1);
    code = code.slice(0, fragment);
  }
  if (!code) return undefined;
  if (state && expectedState !== undefined && state !== expectedState) return undefined;
  return code;
}

// ---------------------------------------------------------------------------
// Token endpoints
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function postToken(
  body: Record<string, string>,
  headers: Record<string, string>,
  fetcher: typeof fetch,
): Promise<TokenResponse> {
  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers,
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    // Status only — the error body can echo credentials and is never surfaced.
    throw new Error(`Antigravity token request failed (HTTP ${response.status})`);
  }
  const data = (await response.json()) as TokenResponse;
  if (!nonEmpty(data.access_token) || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
    throw new Error("Antigravity token response is missing required fields");
  }
  return data;
}

/** Exchange an authorization code for credentials, resolving the CCA project. */
export async function exchangeToken(
  code: string,
  redirectUri: string,
  fetcher: typeof fetch = nodeFetch,
): Promise<OAuthCredentials> {
  // google-auth-library's getToken form order and headers.
  const data = await postToken(
    {
      client_id: CLIENT_ID,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      client_secret: CLIENT_SECRET,
    },
    {
      "Accept-Encoding": "gzip, deflate, br",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "google-api-nodejs-client/10.3.0",
      "x-goog-api-client": NODE_API_CLIENT,
    },
    fetcher,
  );
  if (!data.refresh_token) {
    throw new Error("No refresh token received from the Antigravity OAuth endpoint");
  }
  return finalizeCredentials(data.access_token, data.refresh_token, data.expires_in, fetcher);
}

/** Refresh an access token; preserves the (possibly rotated) refresh token. */
export async function refreshToken(
  storedRefreshToken: string,
  fetcher: typeof fetch = go2Fetch,
): Promise<Pick<OAuthCredentials, "refresh" | "access" | "expires">> {
  // golang.org/x/oauth2 over HTTP/2: sorted form keys, Go's default user agent.
  const data = await postToken(
    {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: storedRefreshToken,
    },
    {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept-Encoding": "gzip",
      "User-Agent": "Go-http-client/2.0",
    },
    fetcher,
  );
  return {
    refresh: data.refresh_token || storedRefreshToken,
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - EXPIRY_SKEW_MS,
  };
}

async function finalizeCredentials(
  accessToken: string,
  refreshTokenValue: string,
  expiresIn: number,
  fetcher: typeof fetch,
): Promise<OAuthCredentials> {
  const email = await fetchUserEmail(accessToken, fetcher);
  const projectId = await discoverProject(accessToken, fetcher);
  return {
    refresh: refreshTokenValue,
    access: accessToken,
    expires: Date.now() + expiresIn * 1000 - EXPIRY_SKEW_MS,
    projectId,
    ...(email ? { email } : {}),
  };
}

/** Best-effort user email; failures are ignored (it is optional metadata). */
export async function fetchUserEmail(accessToken: string, fetcher: typeof fetch = nodeFetch): Promise<string | undefined> {
  try {
    const { "Content-Type": _json, ...headers } = nodeHeaders(accessToken);
    const response = await fetcher(USERINFO_URL, {
      headers,
      signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
    });
    if (response.ok) {
      const email = nonEmpty(((await response.json()) as { email?: unknown }).email);
      if (email) return email;
    }
  } catch {}
  return undefined;
}

// ---------------------------------------------------------------------------
// Project discovery & provisioning
// ---------------------------------------------------------------------------

interface UserTier {
  id?: string;
}

interface LoadCodeAssistResponse {
  currentTier?: UserTier | null;
  allowedTiers?: UserTier[];
  ineligibleTiers?: Array<{ tierId?: string; reasonMessage?: string; validationUrl?: string }>;
  cloudaicompanionProject?: string;
}

interface OnboardOperation {
  name?: string;
  done?: boolean;
  error?: { code?: number; message?: string } | null;
  response?: { cloudaicompanionProject?: string } | null;
}

/** Header set of the IDE's Node client (google-api-nodejs-client via gaxios). */
function nodeHeaders(accessToken: string): Record<string, string> {
  return {
    "Accept-Encoding": "gzip, deflate, br",
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": getAntigravityNodeUserAgent(),
    "x-goog-api-client": NODE_API_CLIENT,
  };
}

interface CloudCodeRequest {
  label: string;
  url: string;
  method: "GET" | "POST";
  accessToken: string;
  body?: unknown;
  timeoutMs: number;
}

/** Google's structured account challenge can accompany any CCA HTTP error. */
export function accountVerificationMessage(payload: any, nextAction: string): string | undefined {
  const details = payload?.error?.details;
  if (!Array.isArray(details)) return undefined;
  const detail = details.find((entry) => entry?.reason === "VALIDATION_REQUIRED" && typeof entry.metadata?.validation_url === "string");
  if (!detail) return undefined;
  return `Account verification required. Visit ${detail.metadata.validation_url} to continue, then ${nextAction}.`;
}

async function cloudCodeAssistRequest(request: CloudCodeRequest, fetcher: typeof fetch): Promise<unknown> {
  const init: RequestInit = {
    method: request.method,
    headers: nodeHeaders(request.accessToken),
    signal: AbortSignal.timeout(request.timeoutMs),
  };
  if (request.method === "POST") init.body = JSON.stringify(request.body ?? {});
  const response = await fetcher(request.url, init);
  if (response.status !== 200) {
    const payload = await response.json().catch(() => undefined);
    const verification = accountVerificationMessage(payload, "sign in again");
    if (verification) throw new Error(verification);
    throw new Error(`${request.label} failed: HTTP ${response.status}`);
  }
  return response.json();
}

async function loadCodeAssist(accessToken: string, fetcher: typeof fetch): Promise<LoadCodeAssistResponse> {
  return (await cloudCodeAssistRequest(
    {
      label: "loadCodeAssist",
      url: `${ANTIGRAVITY_DAILY_ENDPOINT}/v1internal:loadCodeAssist`,
      method: "POST",
      accessToken,
      body: { metadata: nodeIdeMetadata() },
      timeoutMs: OAUTH_REQUEST_TIMEOUT_MS,
    },
    fetcher,
  )) as LoadCodeAssistResponse;
}

function assertFreeTierEligible(payload: LoadCodeAssistResponse): void {
  if (payload.allowedTiers?.some((tier) => tier.id === FREE_TIER_ID)) return;
  const tier = payload.ineligibleTiers?.find((candidate) => candidate.tierId === FREE_TIER_ID);
  if (!tier?.reasonMessage) return;
  const validation = tier.validationUrl ? `\n${tier.validationUrl}` : "";
  throw new Error(`${tier.reasonMessage}${validation}`);
}

async function onboardUser(
  accessToken: string,
  fetcher: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + ONBOARD_TIMEOUT_MS;
  // One deadline spans the initial POST, every sleep, and every poll —
  // exactly like OMP's remainingOnboardTime.
  const remaining = (): number => {
    const left = deadline - Date.now();
    if (left > 0) return left;
    throw new Error(`onboardUser timed out after ${ONBOARD_TIMEOUT_MS}ms`);
  };

  let operation = (await cloudCodeAssistRequest(
    {
      label: "onboardUser",
      url: `${ANTIGRAVITY_DAILY_ENDPOINT}/v1internal:onboardUser`,
      method: "POST",
      accessToken,
      // Captured native body (snake_case, with the IDE version and name).
      body: {
        tier_id: FREE_TIER_ID,
        metadata: nodeIdeMetadata(),
      },
      timeoutMs: remaining(),
    },
    fetcher,
  )) as OnboardOperation;

  while (operation.done !== true) {
    await sleep(Math.min(ONBOARD_POLL_INTERVAL_MS, remaining()));
    const operationName = operation.name ?? "";
    if (operationName.length === 0) {
      throw new Error("onboardUser returned an operation without a name");
    }
    operation = (await cloudCodeAssistRequest(
      {
        label: "onboardUser operation",
        url: `${ANTIGRAVITY_DAILY_ENDPOINT}/v1internal/${operationName}`,
        method: "GET",
        accessToken,
        timeoutMs: remaining(),
      },
      fetcher,
    )) as OnboardOperation;
  }

  if (operation.error) {
    const { code, message } = operation.error;
    const detail = message ? (typeof code === "number" ? `${code}: ${message}` : message) : JSON.stringify(operation.error);
    throw new Error(`OnboardUser operation failed: ${detail}`);
  }
  if (!operation.response) {
    throw new Error("failed to unmarshal OnboardUserResponse");
  }
}

/**
 * Authenticate against Cloud Code Assist: check tier state, provision the
 * free tier once for fresh accounts, and resolve the cloudaicompanionProject.
 */
export async function discoverProject(
  accessToken: string,
  fetcher: typeof fetch = nodeFetch,
  sleep = (ms: number) => Bun.sleep(ms),
): Promise<string> {
  let payload = await loadCodeAssist(accessToken, fetcher);

  assertFreeTierEligible(payload);
  if (payload.currentTier == null) {
    await onboardUser(accessToken, fetcher, sleep);
    payload = await loadCodeAssist(accessToken, fetcher);
  }

  const projectId = payload.cloudaicompanionProject;
  if (!projectId) {
    throw new Error("loadCodeAssist did not return a cloudaicompanionProject");
  }
  return projectId;
}
