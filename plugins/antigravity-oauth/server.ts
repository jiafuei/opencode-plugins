import { Connection, Credential, Integration, Model, Plugin } from "@opencode/plugin";
import { discoverModels } from "./discovery.ts";
import {
  ANTIGRAVITY_DAILY_ENDPOINT,
  ANTIGRAVITY_ENDPOINTS,
  ANTIGRAVITY_SANDBOX_ENDPOINT,
  CLAUDE_THINKING_BETA_HEADER,
  PROVIDER_ID,
  createCcaSseUnwrap,
  createSessionState,
  describeInBandError,
  ensureAntigravityVersion,
  getAntigravityUserAgent,
  isClaudeModel,
  providerModels,
  readInBandError,
  rewriteBodyForAntigravity,
  unwrapCcaJson,
  unwrappedResponseHeaders,
  type AntigravitySessionState,
} from "./wire.ts";
import {
  CALLBACK_PATH,
  CALLBACK_PORT,
  REDIRECT_URI,
  accountVerificationMessage,
  buildAuthUrl,
  exchangeToken,
  extractPastedCode,
  newOAuthState,
  refreshToken,
  type OAuthCredentials,
} from "./oauth_flow.ts";

// Configure in `opencode.json` like:
//
// {
//   "plugins": [{ "package": "@jiafuei/opencode-antigravity-oauth", "options": { "endpointMode": "auto" } }]
// }
//
// Then connect Google Antigravity and sign in with your Google account.
// Requests are dispatched through Google's Cloud Code Assist endpoints with
// the native `antigravity/hub` fingerprint, so Gemini, Claude, and GPT-OSS
// models are used with your free Antigravity tier.

const INTEGRATION_ID = Integration.ID.make(PROVIDER_ID);
const BROWSER_METHOD_ID = Integration.MethodID.make("browser");
const PASTE_METHOD_ID = Integration.MethodID.make("paste");
/** Per-invocation UUID; identical values mark retries of the same logical request. */
const INVOCATION_HEADER = "x-antigravity-opencode-invocation";
const WEB_SEARCH_USER_AGENT = "antigravity/ide/2.5.5 (aidev_client; os_type=windows; arch=amd64)";
/** Login/browser-callback wait window. */
export const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

type EndpointMode = "auto" | "production" | "sandbox";

/** The Cloud Code Assist project and account email ride the credential metadata. */
function toCredential(methodID: Integration.MethodID, credentials: OAuthCredentials): Credential.OAuth {
  return {
    type: "oauth",
    methodID,
    refresh: credentials.refresh,
    access: credentials.access,
    expires: credentials.expires,
    metadata: { projectId: credentials.projectId, ...(credentials.email ? { email: credentials.email } : {}) },
  };
}

// ---------------------------------------------------------------------------
// Browser-callback waiter (race-safe: deliveries may arrive before the
// callback promise is awaited, and every terminal path clears the timer).
// ---------------------------------------------------------------------------

const CALLBACK_SUCCESS_HTML =
  "<html><body><h3>Sign-in complete.</h3><p>You can close this window and return to OpenCode.</p></body></html>";
const CALLBACK_FAILURE_HTML =
  "<html><body><h3>Sign-in failed.</h3><p>State mismatch - restart login from OpenCode.</p></body></html>";

export interface CallbackWaiter {
  /** Resolves with the authorization code, or rejects on timeout/mismatch. */
  promise: Promise<string>;
  /** Feed one redirect URL; returns the HTML shown to the browser. */
  deliver(url: string): string;
  /** Clear the timeout; safe to call repeatedly. */
  dispose(): void;
}

export function createCallbackWaiter(state: string, timeoutMs: number = FLOW_TIMEOUT_MS): CallbackWaiter {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  let settled = false;
  const promise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // The browser can arrive before OpenCode awaits the callback; keep an early
  // invalid request from becoming an unhandled rejection in that small gap.
  promise.catch(() => {});
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectCode(new Error(`authorization window expired after ${timeoutMs}ms`));
  }, timeoutMs);
  timer.unref?.();

  const resolve = (code: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveCode(code);
  };
  const reject = (error: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    rejectCode(error);
  };

  return {
    promise,
    deliver(rawUrl: string): string {
      try {
        const url = new URL(rawUrl);
        if (url.pathname !== CALLBACK_PATH) return "Not found";
        const code = url.searchParams.get("code") ?? "";
        const returnedState = url.searchParams.get("state") ?? "";
        if (returnedState === state && code.length > 0) {
          queueMicrotask(() => resolve(code));
          return CALLBACK_SUCCESS_HTML;
        }
        queueMicrotask(() => reject(new Error("callback state mismatch")));
        return CALLBACK_FAILURE_HTML;
      } catch {
        queueMicrotask(() => reject(new Error("malformed callback URL")));
        return CALLBACK_FAILURE_HTML;
      }
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}

export default Plugin.define({
  id: "antigravity_oauth",
  setup: async (ctx) => {
    const options = ctx.options as { endpointMode?: EndpointMode };
    if (
      options.endpointMode !== undefined &&
      options.endpointMode !== "auto" &&
      options.endpointMode !== "production" &&
      options.endpointMode !== "sandbox"
    ) {
      throw new Error(`Unsupported Antigravity endpointMode "${String(options.endpointMode)}"`);
    }
    const endpointMode: EndpointMode = options.endpointMode ?? "auto";
    // Pinned modes use one endpoint; auto starts at daily and falls back to sandbox.
    const endpoints: string[] =
      endpointMode === "production"
        ? [ANTIGRAVITY_DAILY_ENDPOINT]
        : endpointMode === "sandbox"
          ? [ANTIGRAVITY_SANDBOX_ENDPOINT]
          : [...ANTIGRAVITY_ENDPOINTS];

    // Warm the manifest-discovered client version once per process; failures
    // silently keep the pinned fallback.
    ensureAntigravityVersion().catch(() => {});

    /** Per-OpenCode-session envelope identity; cleared on session deletion and credential switches. */
    const sessionStates = new Map<string, AntigravitySessionState>();
    /** Account-specific state loaded from the active connection. */
    let loaded: { connection?: Connection.Info; projectId?: string; models?: Model.Info[] } = {};

    const load = async () => {
      const connection = await ctx.integration.connection.active(INTEGRATION_ID);
      const credential = connection ? await ctx.integration.connection.resolve(connection).catch(() => undefined) : undefined;
      if (credential?.type !== "oauth") {
        loaded = {};
        return;
      }
      const available = await discoverModels(credential.access, endpoints);
      loaded = {
        connection,
        projectId: credential.metadata?.projectId as string,
        models: available && providerModels(available),
      };
    };
    let loading = Promise.resolve();
    const refresh = () =>
      (loading = loading
        .then(load)
        .then(() => Promise.all([ctx.provider.reload(), ctx.websearch.reload()]))
        .then(() => {}));

    await ctx.integration.transform((editor) => {
      editor.update(INTEGRATION_ID, (integration) => (integration.name = "Google Antigravity"));
      editor.method.update({
        integrationID: INTEGRATION_ID,
        method: { id: BROWSER_METHOD_ID, type: "oauth", label: "Antigravity (browser)" },
        authorize: async () => {
          const state = newOAuthState();
          // The waiter exists before the server so a callback can never be lost.
          const waiter = createCallbackWaiter(state);

          let server: ReturnType<typeof Bun.serve>;
          try {
            server = Bun.serve({
              port: CALLBACK_PORT,
              hostname: "127.0.0.1",
              fetch(request) {
                const body = waiter.deliver(request.url);
                return new Response(body, {
                  status: body === "Not found" ? 404 : body === CALLBACK_FAILURE_HTML ? 400 : 200,
                  headers: { "Content-Type": "text/html", Connection: "close" },
                });
              },
            });
          } catch (error) {
            waiter.dispose();
            throw new Error(
              `Could not bind the Antigravity callback server on port ${CALLBACK_PORT}: ${(error as Error).message}. Use the "Antigravity (paste code)" login method instead.`,
            );
          }

          return {
            url: buildAuthUrl(state, REDIRECT_URI),
            instructions:
              "Complete sign-in in your browser. A callback server is listening on 127.0.0.1:51121; if your browser cannot reach it, restart login with the paste-code method.",
            expiresAt: Date.now() + FLOW_TIMEOUT_MS,
            mode: "auto" as const,
            callback: waiter.promise
              .then((code) => exchangeToken(code, REDIRECT_URI))
              .then((credentials) => toCredential(BROWSER_METHOD_ID, credentials))
              .finally(() => {
                waiter.dispose();
                void server.stop();
              }),
          };
        },
        refresh: async (credential) => ({ ...credential, ...(await refreshToken(credential.refresh)) }),
        label: (credential) => credential.metadata?.email as string | undefined,
      });
      editor.method.update({
        integrationID: INTEGRATION_ID,
        method: { id: PASTE_METHOD_ID, type: "oauth", label: "Antigravity (paste code)" },
        authorize: async () => {
          const state = newOAuthState();
          return {
            url: buildAuthUrl(state, REDIRECT_URI),
            instructions:
              "Complete sign-in. Google will redirect to 127.0.0.1:51121 and the browser may show 'cannot connect' because paste mode intentionally runs no callback server. Copy the COMPLETE URL from the browser address bar and paste it here; use the URL generated by this login attempt.",
            mode: "code" as const,
            callback: async (pasted: string) => {
              const code = extractPastedCode(pasted, state);
              if (!code) {
                throw new Error(
                  "Antigravity paste-code login failed: the pasted value is not a code or matching redirect URL from this login attempt",
                );
              }
              return toCredential(PASTE_METHOD_ID, await exchangeToken(code, REDIRECT_URI));
            },
          };
        },
        refresh: async (credential) => ({ ...credential, ...(await refreshToken(credential.refresh)) }),
        label: (credential) => credential.metadata?.email as string | undefined,
      });
    });

    // Static models until an account's live inventory is discovered; the
    // provider is only available while a connection exists.
    await ctx.provider.transform((editor) => {
      editor.add({
        info: {
          id: PROVIDER_ID,
          integrationID: INTEGRATION_ID,
          name: "Google Antigravity",
          activation: "auto",
          // OpenCode's native Gemini client; the session HTTP hooks below
          // rewrite its requests into Cloud Code Assist calls.
          package: "@opencode/ai/providers/google",
          settings: { baseURL: ANTIGRAVITY_DAILY_ENDPOINT },
        },
        models: loaded.models ?? providerModels(),
        sourceConnection: loaded.models && loaded.connection,
      });
    });

    await ctx.session.hook(
      "model.request",
      (evt) => {
        // Fresh UUID per logical OpenCode LLM invocation. Retries reuse the
        // prepared headers — and therefore this id — so they do not advance
        // the request-chain step.
        evt.headers[INVOCATION_HEADER] = crypto.randomUUID();
      },
      { providerID: PROVIDER_ID },
    );

    // The native Gemini client sends `{baseURL}/models/<id>:streamGenerateContent`
    // with the OAuth access token as `x-goog-api-key`. Rewrite it into the
    // Cloud Code Assist envelope with the native `antigravity/hub` fingerprint.
    await ctx.session.hook(
      "http.request",
      async (evt) => {
        const request = evt.request;
        const match = /\/models\/([^/:]+):(streamGenerateContent|generateContent)$/.exec(new URL(request.url).pathname);
        if (!match) return;
        const verb = match[2]!;
        const stream = verb === "streamGenerateContent";

        let state = sessionStates.get(evt.sessionID);
        if (!state) {
          state = createSessionState();
          sessionStates.set(evt.sessionID, state);
        }
        const rewritten = rewriteBodyForAntigravity({
          args: await request.json(),
          logicalModelId: match[1]!,
          projectId: loaded.projectId!,
          state,
          invocationId: request.headers.get(INVOCATION_HEADER) ?? undefined,
        });

        // Build the native inference fingerprint from scratch. OpenCode,
        // Gemini-client, and user-supplied tracing headers must not leak.
        const headers = new Headers({
          Authorization: `Bearer ${request.headers.get("x-goog-api-key")}`,
          "Content-Type": "application/json",
          "User-Agent": getAntigravityUserAgent(),
        });
        if (stream) headers.set("Accept", "text/event-stream");
        if (stream && isClaudeModel(rewritten.wireModelId)) headers.set("anthropic-beta", CLAUDE_THINKING_BETA_HEADER);

        const endpoint = (endpointMode === "auto" && state.endpoint) || endpoints[0];
        evt.request = new Request(`${endpoint}/v1internal:${verb}${stream ? "?alt=sse" : ""}`, {
          method: "POST",
          headers,
          body: rewritten.body,
        });
      },
      { providerID: PROVIDER_ID },
    );

    // Unwrap Cloud Code Assist responses back into plain Gemini for the
    // native parser. In auto mode a failure moves the session to the other
    // endpoint, so core's retry of the request lands there.
    await ctx.session.hook(
      "http.response",
      async (evt) => {
        const url = new URL(evt.request.url);
        const verb = /^\/v1internal:(streamGenerateContent|generateContent)$/.exec(url.pathname)?.[1];
        if (!verb) return;
        const state = sessionStates.get(evt.sessionID)!;
        const response = evt.response;
        const failover = () => {
          if (endpointMode === "auto") state.endpoint = endpoints.find((endpoint) => endpoint !== url.origin);
        };

        if (!response.ok) {
          failover();
          const payload = await response.clone().json().catch(() => undefined);
          const verification = accountVerificationMessage(payload, "retry your request");
          if (!verification) return;
          evt.response = new Response(JSON.stringify({ error: { ...payload.error, message: verification } }), {
            status: response.status,
            statusText: response.statusText,
            headers: unwrappedResponseHeaders(response),
          });
          return;
        }
        if (endpointMode === "auto") state.endpoint = url.origin;

        if (verb === "generateContent") {
          const payload = unwrapCcaJson(await response.json());
          if (typeof payload.responseId === "string") state.lastExecutionId = payload.responseId;
          evt.response = new Response(JSON.stringify(payload), {
            status: response.status,
            statusText: response.statusText,
            headers: unwrappedResponseHeaders(response),
          });
          return;
        }

        // The response id commits only when the stream completes; failed or
        // cancelled streams poison nothing.
        evt.response = new Response(
          response.body!.pipeThrough(
            createCcaSseUnwrap({
              onError: failover,
              onComplete: (responseId) => (state.lastExecutionId = responseId),
            }),
          ),
          { status: response.status, statusText: response.statusText, headers: unwrappedResponseHeaders(response) },
        );
      },
      { providerID: PROVIDER_ID },
    );

    await ctx.websearch.transform((editor) => {
      if (!loaded.connection) return;
      editor.add({
        id: "antigravity",
        name: "Google Antigravity",
        execute: async ({ query }, { signal }) => {
          const connection = await ctx.integration.connection.active(INTEGRATION_ID);
          const credential = connection && (await ctx.integration.connection.resolve(connection));
          if (credential?.type !== "oauth") throw new Error("Connect Google Antigravity before using web search");
          const response = await fetch(`${endpoints[0]}/v1internal:generateContent`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${credential.access}`,
              "Content-Type": "application/json",
              "User-Agent": WEB_SEARCH_USER_AGENT,
            },
            body: JSON.stringify({
              project: credential.metadata?.projectId,
              model: "gemini-3.1-flash-lite",
              userAgent: "antigravity",
              requestType: "web_search",
              request: {
                contents: [{ role: "user", parts: [{ text: query }] }],
                systemInstruction: {
                  role: "user",
                  parts: [
                    {
                      text: "You are a search engine bot. You will be given a query from a user. Your task is to search the web for relevant information that will help the user. You MUST perform a web search. Do not respond or interact with the user, please respond as if they typed the query into a search bar.",
                    },
                  ],
                },
                generationConfig: { candidateCount: 1 },
                tools: [{ googleSearch: { enhancedContent: { imageSearch: { maxResultCount: 5 } } } }],
              },
            }),
            signal,
          });

          const body = await response.text();
          let payload: Record<string, any>;
          try {
            payload = JSON.parse(body);
          } catch {
            throw new Error(`Antigravity web search failed (HTTP ${response.status})`);
          }
          const verification = accountVerificationMessage(payload, "retry your request");
          if (verification) throw new Error(verification);
          const inBand = readInBandError(payload);
          if (inBand) throw new Error(describeInBandError(inBand));
          if (!response.ok) throw new Error(`Antigravity web search failed (HTTP ${response.status})`);

          // Each grounding source carries the answer segments it supports.
          const grounding = payload.response?.candidates?.[0]?.groundingMetadata;
          const supports: Array<Record<string, any>> = grounding?.groundingSupports ?? [];
          return ((grounding?.groundingChunks ?? []) as Array<Record<string, any>>).flatMap((chunk, index) => {
            if (typeof chunk.web?.uri !== "string") return [];
            const content = supports
              .filter((support) => support.groundingChunkIndices?.includes(index))
              .map((support) => support.segment.text)
              .join(" ");
            return [{
              url: chunk.web.uri,
              ...(chunk.web.title ? { title: chunk.web.title } : {}),
              ...(content ? { content } : {}),
              time: {},
            }];
          });
        },
      });
    });

    void (async () => {
      for await (const event of ctx.event.subscribe()) {
        if (event.type === "session.deleted") sessionStates.delete(event.data.sessionID);
        if (event.type === "credential.switched" && event.data.integrationID === INTEGRATION_ID) {
          sessionStates.clear();
          void refresh();
        }
      }
    })();
    void refresh();
  },
});
