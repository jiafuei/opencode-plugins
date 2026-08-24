/**
 * Antigravity OAuth: Google installed-app authorization-code flow plus Cloud
 * Code Assist project discovery/provisioning. Mirrors oh-my-pi's dedicated
 * Antigravity flow (`google-antigravity.ts` + `google-oauth-shared.ts`).
 *
 * All network functions take an injectable `fetcher` so tests stay fully
 * mocked. Errors carry status/message only — never credential material.
 */

import {
  ANTIGRAVITY_DAILY_ENDPOINT,
  getAntigravityUserAgent,
} from "./wire.ts";

// Native Antigravity installed-app client (base64 exactly as upstream ships it).
const CLIENT_ID = atob(
  "MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
);
const CLIENT_SECRET = atob("R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=");

export const CALLBACK_PORT = 51121;
export const CALLBACK_PATH = "/oauth-callback";
export const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";

/** Per-request timeout for provisioning-phase HTTP calls (OMP OAUTH_REQUEST_TIMEOUT_MS). */
export const OAUTH_REQUEST_TIMEOUT_MS = 30_000;
/** LRO polling cadence and overall deadline for onboardUser (OMP constants). */
export const ONBOARD_POLL_INTERVAL_MS = 1_000;
export const ONBOARD_TIMEOUT_MS = 30_000;
/** Access-token lifetimes are shortened by this skew so requests never send near-stale bearers. */
export const EXPIRY_SKEW_MS = 5 * 60 * 1000;

const FREE_TIER_ID = "free-tier";

export const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

/** Cloud Code Assist metadata sent by native Antigravity control-plane requests. */
export const ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA = Object.freeze({ ideType: "ANTIGRAVITY" });

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
export function buildAuthUrl(state: string, redirectUri = REDIRECT_URI): string {
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

async function postToken(body: Record<string, string>, fetcher: typeof fetch): Promise<TokenResponse> {
  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
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
  fetcher: typeof fetch = fetch,
): Promise<OAuthCredentials> {
  const data = await postToken(
    {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
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
  projectId: string,
  fetcher: typeof fetch = fetch,
): Promise<OAuthCredentials> {
  const data = await postToken(
    {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: storedRefreshToken,
      grant_type: "refresh_token",
    },
    fetcher,
  );
  return {
    refresh: data.refresh_token || storedRefreshToken,
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - EXPIRY_SKEW_MS,
    projectId,
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
export async function fetchUserEmail(accessToken: string, fetcher: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const response = await fetcher(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
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
  paidTier?: UserTier | null;
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

export interface ProvisionTiming {
  pollIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Shared Cloud Code Assist control-plane headers (native fingerprint). */
function ccaHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": getAntigravityUserAgent(),
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

async function cloudCodeAssistRequest(request: CloudCodeRequest, fetcher: typeof fetch): Promise<unknown> {
  const init: RequestInit = {
    method: request.method,
    headers: ccaHeaders(request.accessToken),
    signal: AbortSignal.timeout(request.timeoutMs),
  };
  if (request.method === "POST") init.body = JSON.stringify(request.body ?? {});
  const response = await fetcher(request.url, init);
  if (response.status !== 200) {
    throw new Error(`${request.label} failed: HTTP ${response.status}`);
  }
  return response.json();
}

async function loadCodeAssist(
  accessToken: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
  timeoutMs = OAUTH_REQUEST_TIMEOUT_MS,
): Promise<LoadCodeAssistResponse> {
  return (await cloudCodeAssistRequest(
    { label: "loadCodeAssist", url: `${ANTIGRAVITY_DAILY_ENDPOINT}/v1internal:loadCodeAssist`, method: "POST", accessToken, body, timeoutMs },
    fetcher,
  )) as LoadCodeAssistResponse;
}

async function loadAccountState(accessToken: string, fetcher: typeof fetch): Promise<LoadCodeAssistResponse> {
  let payload = await loadCodeAssist(
    accessToken,
    { metadata: ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA },
    fetcher,
  );
  const projectId = extractProjectId(payload);
  if (payload.paidTier == null && projectId) {
    payload = await loadCodeAssist(
      accessToken,
      { cloudaicompanionProject: projectId, metadata: ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA },
      fetcher,
    );
  }
  return payload;
}

function extractProjectId(payload: LoadCodeAssistResponse): string | undefined {
  const projectId = payload.cloudaicompanionProject;
  return projectId && projectId.length > 0 ? projectId : undefined;
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
  timing: ProvisionTiming,
): Promise<void> {
  const timeoutMs = timing.timeoutMs ?? ONBOARD_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  // One deadline spans the initial POST, every sleep, and every poll —
  // exactly like OMP's remainingOnboardTime.
  const remaining = (): number => {
    const left = deadline - Date.now();
    if (left > 0) return left;
    throw new Error(`onboardUser timed out after ${timeoutMs}ms`);
  };
  const sleep = timing.sleep ?? ((ms: number) => Bun.sleep(ms));

  let operation = (await cloudCodeAssistRequest(
    {
      label: "onboardUser",
      url: `${ANTIGRAVITY_DAILY_ENDPOINT}/v1internal:onboardUser`,
      method: "POST",
      accessToken,
      body: { tierId: FREE_TIER_ID, metadata: ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA },
      timeoutMs: remaining(),
    },
    fetcher,
  )) as OnboardOperation;

  while (operation.done !== true) {
    await sleep(Math.min(timing.pollIntervalMs ?? ONBOARD_POLL_INTERVAL_MS, remaining()));
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
  fetcher: typeof fetch = fetch,
  onProgress?: (message: string) => void,
  timing: ProvisionTiming = {},
): Promise<string> {
  onProgress?.("Checking Cloud Code Assist account status...");
  const payload = await loadAccountState(accessToken, fetcher);

  assertFreeTierEligible(payload);
  if (payload.currentTier == null) {
    onProgress?.("Provisioning the Antigravity free tier...");
    await onboardUser(accessToken, fetcher, timing);
  }

  onProgress?.("Refreshing Cloud Code Assist project...");
  const refreshed = await loadAccountState(accessToken, fetcher);
  const projectId = extractProjectId(refreshed);
  if (!projectId) {
    throw new Error("loadCodeAssist did not return a cloudaicompanionProject");
  }
  return projectId;
}
