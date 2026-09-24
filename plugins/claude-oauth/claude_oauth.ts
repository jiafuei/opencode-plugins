import { Integration, Plugin, type Credential } from "@opencode/plugin";
import { randomBytes, randomUUID } from "node:crypto";
import {
  buildBetas,
  buildEnforcedHeaders,
  createSseToolNameTransform,
  resolveSpoofingProfile,
  rewriteBody,
  uncloakedResponseHeaders,
} from "./wire_format.ts";
import type { SpoofingProfile } from "./wire_format.ts";
import { deriveCoworkSessionId } from "./local_storage.ts";
import { buildExMachinaHeaders, rewriteExMachinaBody, unprefixExMachinaName } from "./ex_machina_wire.ts";

// Configure in `opencode.json` like:
//
// {
//   "plugins": ["@jiafuei/opencode-claude-oauth"]
// }
//
// Then connect Anthropic and choose Claude Pro/Max. Requests to the Anthropic
// provider are then fingerprinted to look like Claude Code subscription
// traffic, so your Pro/Max subscription is used instead of API credits.

function rot13(value: string): string {
  return value.replace(/[a-z]/gi, (char) => String.fromCharCode(char.charCodeAt(0) + (char.toLowerCase() < "n" ? 13 : -13)));
}

const CLIENT_ID = rot13("9q1p250n-r61o-44q9-88rq-5944q1962s5r"); // Claude Code's public OAuth client ID
const AUTHORIZE_URL = rot13("uggcf://pynhqr.pbz/pnv/bnhgu/nhgubevmr");
const TOKEN_URL = rot13("uggcf://cyngsbez.pynhqr.pbz/i1/bnhgu/gbxra");
const PROFILE_URL = rot13("uggcf://ncv.naguebcvp.pbz/ncv/bnhgu/cebsvyr");
const ROLES_URL = rot13("uggcf://ncv.naguebcvp.pbz/ncv/bnhgu/pynhqr_pyv/ebyrf");
const BOOTSTRAP_URL = rot13("uggcf://ncv.naguebcvp.pbz/ncv/pynhqr_pyv/obbgfgenc");
const REDIRECT_URI = rot13("uggcf://cyngsbez.pynhqr.pbz/bnhgu/pbqr/pnyyonpx");
const SCOPES =
  rot13("bet:perngr_ncv_xrl hfre:cebsvyr hfre:vasrerapr hfre:frffvbaf:pynhqr_pbqr hfre:zpc_freiref hfre:svyr_hcybnq");
const REFRESH_SCOPES = rot13("hfre:cebsvyr hfre:vasrerapr hfre:frffvbaf:pynhqr_pbqr hfre:zpc_freiref hfre:svyr_hcybnq");

const AXIOS_USER_AGENT = "axios/1.15.2";
const AXIOS_ACCEPT = "application/json, text/plain, */*";
const SESSION_ID_HEADER = "X-Claude-Code-Session-Id";
const REQUEST_ID_HEADER = "x-client-request-id";
const METHOD_ID = Integration.MethodID.make("claude-pro-max");
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// PKCE + token plumbing
// ---------------------------------------------------------------------------

function base64UrlEncode(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64url");
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = base64UrlEncode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  account?: { uuid?: string; email_address?: string };
  organization?: { uuid?: string; name?: string };
}

/**
 * Account + organization identity resolved from the token response and/or
 * the OAuth profile, Claude CLI roles, or Cowork bootstrap endpoints. Stored
 * as the credential's metadata.
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

/**
 * POST to the official token endpoint. Thrown errors carry only the status
 * plus the parsed `error`/`error_description` fields — never the raw body or
 * any credential material.
 */
async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Accept: AXIOS_ACCEPT, "User-Agent": AXIOS_USER_AGENT, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.ok) return (await response.json()) as TokenResponse;
  const parsed = (await response.json().catch(() => undefined)) as
    | { error?: string | { type?: string }; error_description?: string }
    | undefined;
  const oauthError = typeof parsed?.error === "string" ? parsed.error : parsed?.error?.type;
  const description = parsed?.error_description?.slice(0, 300);
  throw new Error(
    `Anthropic OAuth token request failed (HTTP ${response.status}${oauthError ? `, ${oauthError}` : ""})` +
      (description ? `: ${description}` : "") +
      (oauthError === "invalid_grant" ? " — reconnect Anthropic with Claude Pro/Max." : ""),
  );
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

async function fetchCoworkBootstrapIdentity(
  accessToken: string,
  profile: SpoofingProfile,
): Promise<OAuthIdentity> {
  const response = await fetch(`${BOOTSTRAP_URL}?entrypoint=cli&model=claude-opus-4-8`, {
    method: "GET",
    headers: {
      Accept: AXIOS_ACCEPT,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": `claude-code/${profile.version}`,
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
 * Resolve the login identity, merging the token response over profile
 * recovery. Identity is captured once at login and kept across refreshes.
 * Recovery failures are swallowed so they never invalidate an otherwise
 * successful token exchange.
 */
export async function resolveIdentity(data: TokenResponse, profile?: SpoofingProfile): Promise<OAuthIdentity> {
  const identity = extractIdentity(data);
  if (identity.accountId && identity.email && identity.orgId) return identity;
  try {
    const recovered = profile?.id === "cowork"
      ? await fetchCoworkBootstrapIdentity(data.access_token, profile)
      : await fetchOAuthIdentity(data.access_token);
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

function buildAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    // Non-standard: required by Claude's authorization page to return the raw code.
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface ClaudeOAuthOptions {
  attributionHeader?: boolean;
  /**
   * Client identity spoofed on the Anthropic wire: "sdk-cli" (default),
   * "cowork", or the source-derived "ex-machina" profile.
   */
  spoofingProfile?: SpoofingProfile["id"];
}

export default Plugin.define({
  id: "claude_oauth",
  setup: async (ctx) => {
    const options = ctx.options as ClaudeOAuthOptions;
    // Validated once at the option boundary; unsupported values throw here.
    const profile = resolveSpoofingProfile(options.spoofingProfile);
    const attributionHeader = options.attributionHeader !== false;
    // Non-Cowork profiles map raw OpenCode session ids to process-local UUIDv4s.
    // Cowork derives a restart-stable UUID-shaped id from the install and session.
    const wireSessionIds = new Map<string, string>();
    // The active Anthropic credential when it is this plugin's OAuth grant;
    // every wire rewrite below is gated on it.
    let oauth: Credential.OAuth | undefined;

    const load = async () => {
      const connection = await ctx.integration.connection.active("anthropic");
      const credential = connection
        ? await ctx.integration.connection.resolve(connection).catch(() => undefined)
        : undefined;
      oauth = credential?.type === "oauth" && credential.methodID === METHOD_ID ? credential : undefined;
    };

    await ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID: "anthropic",
        method: { id: METHOD_ID, type: "oauth", label: "Claude Pro/Max" },
        label: (credential) => credential.metadata?.email as string | undefined,
        authorize: async () => {
          const pkce = await generatePKCE();
          const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer);
          return {
            url: buildAuthorizeUrl(pkce.challenge, state),
            instructions:
              "Complete login in your browser, then paste the authorization code shown by Claude within 5 minutes. It may look like `<code>#<state>`.",
            expiresAt: Date.now() + FLOW_TIMEOUT_MS,
            mode: "code",
            callback: async (pasted) => {
              // Accept a bare code (`code#state`) or the full redirect URL,
              // and validate any accompanying state locally BEFORE the
              // token exchange.
              let code = pasted.trim();
              let pastedState = "";
              if (URL.canParse(code)) {
                const parsed = new URL(code);
                const urlCode = parsed.searchParams.get("code");
                if (urlCode) {
                  code = urlCode;
                  pastedState = parsed.searchParams.get("state") ?? "";
                }
              }
              const fragment = code.indexOf("#");
              if (fragment >= 0) {
                pastedState = code.slice(fragment + 1);
                code = code.slice(0, fragment);
              }
              if (pastedState.length > 0 && pastedState !== state) {
                throw new Error("The pasted state does not match this login session. Restart the Claude Pro/Max login.");
              }
              const tokens = await postToken({
                grant_type: "authorization_code",
                client_id: CLIENT_ID,
                code,
                state,
                redirect_uri: REDIRECT_URI,
                code_verifier: pkce.verifier,
              });
              return {
                type: "oauth",
                methodID: METHOD_ID,
                access: tokens.access_token,
                refresh: tokens.refresh_token!,
                expires: Date.now() + tokens.expires_in * 1000,
                metadata: { ...(await resolveIdentity(tokens, profile)) },
              };
            },
          };
        },
        refresh: async (credential) => {
          const tokens = await postToken({
            grant_type: "refresh_token",
            client_id: CLIENT_ID,
            refresh_token: credential.refresh,
            scope: REFRESH_SCOPES,
          });
          // Rotation is optional; identity stays as captured at login.
          return {
            ...credential,
            access: tokens.access_token,
            refresh: tokens.refresh_token ?? credential.refresh,
            expires: Date.now() + tokens.expires_in * 1000,
          };
        },
      });
    });

    await load();

    // Subscription-billed: zero out costs so usage tracking doesn't report
    // API spend for Pro/Max requests.
    await ctx.model.transform((editor) => {
      if (!oauth) return;
      for (const model of editor.list("anthropic")) {
        editor.update(model.providerID, model.id, (draft) => {
          draft.cost = [];
        });
      }
    });

    await ctx.session.hook(
      "model.request",
      (event) => {
        if (!oauth || profile.wireFormat === "ex-machina") return;
        let wireSessionId =
          profile.id === "cowork" ? deriveCoworkSessionId(event.sessionID) : wireSessionIds.get(event.sessionID);
        if (!wireSessionId) {
          wireSessionId = randomUUID().toLowerCase();
          wireSessionIds.set(event.sessionID, wireSessionId);
        }
        event.headers[SESSION_ID_HEADER] = wireSessionId;
        // Fresh UUID per logical invocation; HTTP retries of the prepared
        // request reuse it.
        event.headers[REQUEST_ID_HEADER] = randomUUID();
      },
      { providerID: "anthropic" },
    );

    await ctx.session.hook(
      "http.request",
      async (event) => {
        const request = event.request;
        const url = new URL(request.url);
        if (!oauth || url.pathname !== "/v1/messages") return;
        const body = await request.text();
        if (profile.wireFormat === "ex-machina") {
          event.request = new Request(url, {
            method: request.method,
            headers: buildExMachinaHeaders(request.headers),
            body: rewriteExMachinaBody(body, attributionHeader),
          });
          return;
        }
        const rewritten = rewriteBody(body, {
          sessionId: request.headers.get(SESSION_ID_HEADER) ?? undefined,
          accountId: oauth.metadata?.accountId as string | undefined,
          attributionHeader,
          profile,
        });
        event.request = new Request(url, {
          method: request.method,
          // The session header always matches the body's metadata user_id
          // session, which rewriteBody may have preserved from the body.
          headers: buildEnforcedHeaders(profile, {
            sessionId: rewritten.sessionId,
            betas: buildBetas(rewritten.thinking, rewritten.hasTools, request.headers.get("anthropic-beta"), profile),
            authorization: request.headers.get("authorization")!,
            clientRequestId: request.headers.get(REQUEST_ID_HEADER) ?? randomUUID(),
          }),
          body: rewritten.json,
        });
      },
      { providerID: "anthropic" },
    );

    // Uncloak custom tool names on the way back, incrementally (no full
    // buffering). Rewritten responses get cloned headers with stale entity
    // headers stripped.
    await ctx.session.hook(
      "http.response",
      (event) => {
        const response = event.response;
        if (!oauth || new URL(event.request.url).pathname !== "/v1/messages" || !response.body) return;
        if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) return;
        const transform =
          profile.wireFormat === "ex-machina"
            ? createSseToolNameTransform("mcp_", unprefixExMachinaName)
            : createSseToolNameTransform(profile.toolPrefix);
        event.response = new Response(response.body.pipeThrough(transform), {
          status: response.status,
          statusText: response.statusText,
          headers: uncloakedResponseHeaders(response),
        });
      },
      { providerID: "anthropic" },
    );

    // Subscriptions close with the plugin scope.
    void (async () => {
      for await (const event of ctx.event.subscribe()) {
        if (event.type === "session.deleted") wireSessionIds.delete(event.data.sessionID);
        if (
          event.type === "credential.updated" ||
          (event.type === "credential.switched" && event.data.integrationID === "anthropic")
        ) {
          await load();
          await ctx.model.reload();
        }
      }
    })();

    return () => wireSessionIds.clear();
  },
});
