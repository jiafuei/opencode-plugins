import { Integration, Plugin, type Credential } from "@opencode/plugin";
import { randomBytes, randomUUID } from "node:crypto";
import { createSseToolNameTransform, resolveSpoofingProfile, uncloakedResponseHeaders } from "./wire_format.ts";
import { cliHeaders, rewriteCliBody, type CliAttribution, type CliProfile } from "./cli_wire.ts";
import { createCliRelay } from "./cli_transport.ts";

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
const REDIRECT_URI = rot13("uggcf://cyngsbez.pynhqr.pbz/bnhgu/pbqr/pnyyonpx");
const SCOPES =
  rot13("bet:perngr_ncv_xrl hfre:cebsvyr hfre:vasrerapr hfre:frffvbaf:pynhqr_pbqr hfre:zpc_freiref hfre:svyr_hcybnq");
const REFRESH_SCOPES = rot13("hfre:cebsvyr hfre:vasrerapr hfre:frffvbaf:pynhqr_pbqr hfre:zpc_freiref hfre:svyr_hcybnq");

const AXIOS_USER_AGENT = "axios/1.15.2";
const AXIOS_ACCEPT = "application/json, text/plain, */*";
const REQUEST_ID_HEADER = "x-client-request-id";
// Session metadata key holding the main thread's turn attribution, so it survives plugin reloads.
const TURN_METADATA_KEY = "claude-oauth.turn";
const METHOD_ID = Integration.MethodID.make("claude-pro-max");
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  account?: { uuid?: string; email_address?: string };
  organization?: { uuid?: string; name?: string };
}

/**
 * Account + organization identity resolved from the token response and/or
 * the OAuth profile and Claude CLI roles endpoints. Stored
 * as the credential's metadata.
 */
interface OAuthIdentity {
  accountId?: string;
  email?: string;
  orgId?: string;
  orgName?: string;
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
  const parsed = (await response.json().catch(() => ({}))) as { error?: string | { type?: string }; error_description?: string };
  const oauthError = typeof parsed.error === "string" ? parsed.error : parsed.error?.type;
  throw new Error(
    `Anthropic OAuth token request failed (HTTP ${response.status}${oauthError ? `, ${oauthError}` : ""})` +
      (parsed.error_description ? `: ${parsed.error_description}` : "") +
      (oauthError === "invalid_grant" ? " — reconnect Anthropic with Claude Pro/Max." : ""),
  );
}

/**
 * Identity recovery from Claude Code's profile and roles endpoints. Profile
 * failures are surfaced to callers; roles are optional and only enrich the
 * organization.
 */
async function fetchOAuthIdentity(accessToken: string): Promise<OAuthIdentity> {
  const [profileResponse, roles] = await Promise.all([
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
    })
      .then((response) => response.json() as Promise<{ organization_uuid?: string; organization_name?: string }>)
      .catch(() => ({ organization_uuid: undefined, organization_name: undefined })),
  ]);
  if (!profileResponse.ok) throw new Error(`Anthropic profile request failed: ${profileResponse.status}`);
  const data = (await profileResponse.json()) as {
    account?: { uuid?: string; email?: string };
    organization?: { uuid?: string; name?: string };
  };
  return {
    accountId: data.account?.uuid,
    email: data.account?.email,
    orgId: data.organization?.uuid ?? roles.organization_uuid,
    orgName: data.organization?.name ?? roles.organization_name,
  };
}

/**
 * Resolve the login identity, merging the token response over profile
 * recovery. Identity is captured once at login and kept across refreshes.
 * Recovery failures are swallowed so they never invalidate an otherwise
 * successful token exchange.
 */
export async function resolveIdentity(data: TokenResponse): Promise<OAuthIdentity> {
  const identity: OAuthIdentity = {
    accountId: data.account?.uuid,
    email: data.account?.email_address,
    orgId: data.organization?.uuid,
    orgName: data.organization?.name,
  };
  if (identity.accountId && identity.email && identity.orgId) return identity;
  const recovered: OAuthIdentity = await fetchOAuthIdentity(data.access_token).catch(() => ({}));
  return {
    accountId: identity.accountId ?? recovered.accountId,
    email: identity.email ?? recovered.email,
    orgId: identity.orgId ?? recovered.orgId,
    orgName: identity.orgName ?? recovered.orgName,
  };
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

interface ClaudeOAuthOptions {
  attributionHeader?: boolean;
  /**
   * Client identity spoofed on the Anthropic wire: "sdk-cli" (default),
   * or "cli" (interactive).
   */
  spoofingProfile?: CliProfile["id"];
}

export default Plugin.define({
  id: "claude_oauth",
  setup: async (ctx) => {
    const options = ctx.options as ClaudeOAuthOptions;
    // Validated once at the option boundary; unsupported values throw here.
    const profile = resolveSpoofingProfile(options.spoofingProfile);
    const attributionHeader = options.attributionHeader !== false;
    // The active Anthropic credential when it is this plugin's OAuth grant;
    // every wire rewrite below is gated on it.
    let oauth: Credential.OAuth | undefined;
    let credentialIdentity: string | undefined;
    let cliGeneration = 0;
    let relay: ReturnType<typeof createCliRelay> | undefined;
    type CliState = {
      parentId?: string;
      wireId: string;
      agentId?: string;
      turn?: string;
      promptId?: string;
      turnOrigin?: CliAttribution["turnOrigin"];
      promptIndex?: number;
      turnIndex?: number;
      previousRequestId?: string;
      previousMessageId?: string;
      sequence: number;
      committed: number;
    };
    type CliCall = {
      id: string;
      rawSessionId: string;
      state: CliState;
      sequence: number;
      attribution: CliAttribution;
      kind: string;
      attempts: number;
      timer: ReturnType<typeof setTimeout>;
    };
    type SavedTurn = Pick<CliState, "turn" | "promptId" | "promptIndex" | "turnIndex">;
    const cliStates = new Map<string, CliState>();
    const cliCalls = new Map<string, CliCall>();
    const cliResponses = new WeakMap<Request, CliCall>();
    const cliState = async (sessionID: Parameters<typeof ctx.session.get>[0]["sessionID"]): Promise<CliState> => {
      const current = cliStates.get(sessionID);
      if (current) return current;
      const generation = cliGeneration;
      const session = await ctx.session.get({ sessionID });
      const parent = session.parentID ? await cliState(session.parentID) : undefined;
      if (generation !== cliGeneration) throw new Error("Claude CLI session changed while preparing the request");
      const created: CliState = {
        parentId: session.parentID,
        wireId: parent?.wireId ?? randomUUID(),
        // Children inherit the parent's metadata but not its turn attribution.
        ...(parent
          ? { agentId: `a${randomBytes(8).toString("hex")}`, promptId: parent.promptId }
          : session.metadata?.[TURN_METADATA_KEY] as SavedTurn | undefined),
        sequence: 0, committed: 0,
      };
      const winner = cliStates.get(sessionID) ?? created;
      cliStates.set(sessionID, winner);
      return winner;
    };

    const load = async () => {
      const connection = await ctx.integration.connection.active("anthropic");
      const credential = connection
        ? await ctx.integration.connection.resolve(connection).catch(() => undefined)
        : undefined;
      oauth = credential?.type === "oauth" && credential.methodID === METHOD_ID ? credential : undefined;
      const identity = oauth ? `${JSON.stringify(connection)}:${oauth.metadata?.accountId ?? ""}` : undefined;
      if (credentialIdentity !== identity) {
        cliGeneration++;
        cliStates.clear();
      }
      credentialIdentity = identity;
    };

    await ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID: "anthropic",
        method: { id: METHOD_ID, type: "oauth", label: "Claude Pro/Max" },
        label: (credential) => credential.metadata?.email as string | undefined,
        authorize: async () => {
          const verifier = randomBytes(32).toString("base64url");
          const challenge = new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");
          const state = randomBytes(32).toString("base64url");
          return {
            url: buildAuthorizeUrl(challenge, state),
            instructions:
              "Complete login in your browser, then paste the authorization code shown by Claude within 5 minutes. It may look like `<code>#<state>`.",
            expiresAt: Date.now() + FLOW_TIMEOUT_MS,
            mode: "code",
            callback: async (pasted) => {
              // Accept a bare code (`code#state`) or the full redirect URL,
              // and validate any accompanying state locally BEFORE the
              // token exchange.
              let [code, pastedState] = pasted.trim().split("#");
              if (URL.canParse(code!)) {
                const params = new URL(code!).searchParams;
                code = params.get("code")!;
                pastedState = params.get("state") ?? undefined;
              }
              if (pastedState && pastedState !== state) {
                throw new Error("The pasted state does not match this login session. Restart the Claude Pro/Max login.");
              }
              const tokens = await postToken({
                grant_type: "authorization_code",
                client_id: CLIENT_ID,
                code: code!,
                state,
                redirect_uri: REDIRECT_URI,
                code_verifier: verifier,
              });
              return {
                type: "oauth",
                methodID: METHOD_ID,
                access: tokens.access_token,
                refresh: tokens.refresh_token!,
                expires: Date.now() + tokens.expires_in * 1000,
                metadata: { ...(await resolveIdentity(tokens)) },
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

    await ctx.session.hook("context", async (event) => {
      if (!oauth) return;
      const state = await cliState(event.sessionID);
      const user = event.messages.findLast((message) => message.role === "user");
      if (!user || state.agentId) return;
      const turn = user.id ?? new Bun.CryptoHasher("sha256").update(JSON.stringify(user.content)).digest("hex");
      // Core retains metadata (even an empty object) on human messages;
      // synthetic task notifications are lowered without it.
      state.turnOrigin = profile.id === "sdk-cli" ? "sdk" : user.metadata !== undefined ? "human" : "task_notification";
      if (turn !== state.turn) {
        state.turn = turn;
        state.promptId = randomUUID();
        // Every turn advances the turn index; task notifications are not prompts.
        state.turnIndex = (state.turnIndex ?? 0) + 1;
        state.promptIndex = (state.promptIndex ?? 0) + (state.turnOrigin === "task_notification" ? 0 : 1);
        const saved: SavedTurn = { turn, promptId: state.promptId, promptIndex: state.promptIndex, turnIndex: state.turnIndex };
        const { metadata } = await ctx.session.get({ sessionID: event.sessionID });
        await ctx.session.update({ sessionID: event.sessionID, metadata: { ...metadata, [TURN_METADATA_KEY]: saved } });
      }
    }, { providerID: "anthropic" });

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
      async (event) => {
        if (!oauth) return;
        const state = await cliState(event.sessionID);
        const id = randomUUID();
        const timer = setTimeout(() => cliCalls.delete(id), 60 * 60 * 1000);
        timer.unref();
        cliCalls.set(id, {
          id, rawSessionId: event.sessionID, state, sequence: ++state.sequence, kind: event.kind, attempts: 0, timer,
          attribution: {
            sessionId: state.wireId,
            accountId: oauth.metadata?.accountId as string | undefined,
            agentId: state.agentId,
            agentType: state.agentId ? event.agent : undefined,
            requestClass: event.kind === "primary" ? state.agentId ? "subagent" : "main"
              : event.kind === "compaction" ? "compaction" : "auxiliary",
            // CC's compaction billing line carries only the previous request.
            ...(event.kind !== "title" && event.kind !== "compaction" ? { promptId: state.promptId, turnOrigin: state.turnOrigin } : {}),
            ...(event.kind === "primary" ? { promptIndex: state.promptIndex, turnIndex: state.turnIndex } : {}),
            ...(event.kind !== "title" ? {
              previousRequestId: state.previousRequestId, previousMessageId: state.previousMessageId,
            } : {}),
          },
        });
        event.headers[REQUEST_ID_HEADER] = id;
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
        const id = request.headers.get(REQUEST_ID_HEADER)!;
        const call = cliCalls.get(id);
        if (!call || cliStates.get(event.sessionID) !== call.state) throw new Error("Claude CLI request belongs to an inactive session");
        const rewritten = rewriteCliBody(body, call.attribution, attributionHeader, profile);
        const headers = cliHeaders(request.headers, call.attribution, rewritten, id, call.attempts++, profile);
        relay ??= createCliRelay();
        event.request = relay.forward(url, headers, rewritten.json, request.signal);
        cliResponses.set(event.request, call);
      },
      { providerID: "anthropic" },
    );

    // Uncloak custom tool names on the way back, incrementally (no full
    // buffering). Rewritten responses get cloned headers with stale entity
    // headers stripped.
    await ctx.session.hook(
      "http.response",
      async (event) => {
        const response = event.response;
        const contentType = response.headers.get("content-type") ?? "";
        const call = cliResponses.get(event.request);
        if (!call || !response.ok) return;
        const requestId = response.headers.get("request-id");
        const complete = (messageId: string) => {
          if (requestId && cliStates.get(call.rawSessionId) === call.state && call.sequence >= call.state.committed && call.kind === "primary") {
            call.state.previousRequestId = requestId;
            call.state.previousMessageId = messageId;
            call.state.committed = call.sequence;
          }
          clearTimeout(call.timer);
          cliCalls.delete(call.id);
        };
        if (contentType.includes("text/event-stream")) {
          let messageId = "";
          let stopped = false;
          let failed = false;
          const transform = createSseToolNameTransform(profile.toolPrefix, {
            event(value) {
              if (stopped || value.type === "error") failed = true;
              if (value.type === "message_start") messageId = value.message.id;
              if (value.type === "message_stop") stopped = true;
            },
            end() { if (stopped && !failed) complete(messageId); },
          });
          event.response = new Response(response.body!.pipeThrough(transform), {
            status: response.status, headers: uncloakedResponseHeaders(response),
          });
        } else if (contentType.includes("application/json")) {
          const message = await response.json() as Record<string, any>;
          complete(message.id);
          for (const block of message.content) {
            if (block.type === "tool_use" && block.name.startsWith(profile.toolPrefix)) block.name = block.name.slice(profile.toolPrefix.length);
          }
          event.response = Response.json(message, { status: response.status, headers: uncloakedResponseHeaders(response) });
        }
      },
      { providerID: "anthropic" },
    );

    // Subscriptions close with the plugin scope.
    void (async () => {
      for await (const event of ctx.event.subscribe()) {
        if (event.type === "session.deleted") {
          cliGeneration++;
          const removed = new Set<string>([event.data.sessionID]);
          // Parents enter this map before their children.
          for (const [id, state] of cliStates) {
            if (removed.has(id) || (state.parentId && removed.has(state.parentId))) {
              removed.add(id);
              cliStates.delete(id);
            }
          }
        }
        if (event.type === "session.compacted") {
          cliGeneration++;
          const state = cliStates.get(event.data.sessionID);
          if (state) {
            // A new chain owner fences old completions without changing the
            // session UUID shared by the root and its running child agents.
            cliStates.set(event.data.sessionID, {
              ...state, previousRequestId: undefined, previousMessageId: undefined, sequence: 0, committed: 0,
            });
          }
        }
        if (
          event.type === "credential.updated" ||
          (event.type === "credential.switched" && event.data.integrationID === "anthropic")
        ) {
          if (event.type === "credential.switched") {
            cliGeneration++;
            cliStates.clear();
          }
          await load();
          await ctx.model.reload();
        }
      }
    })();

    return () => {
      cliGeneration++;
      cliStates.clear();
      for (const call of cliCalls.values()) clearTimeout(call.timer);
      cliCalls.clear();
      relay?.close();
    };
  },
});
