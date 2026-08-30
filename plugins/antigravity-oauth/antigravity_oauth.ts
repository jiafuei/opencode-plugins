import type { Config, Hooks, Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin";
import {
  ANTIGRAVITY_DAILY_ENDPOINT,
  ANTIGRAVITY_SANDBOX_ENDPOINT,
  CLAUDE_THINKING_BETA_HEADER,
  MODEL_SPECS,
  TRANSIENT_STATUSES,
  createCcaSseUnwrap,
  createSessionState,
  describeInBandError,
  ensureAntigravityVersion,
  errorStream,
  firstEventTimeoutMs,
  getAntigravityUserAgent,
  isInBandErrorTransient,
  isClaudeModel,
  providerModels,
  readFirstSseEvent,
  readInBandError,
  rewriteBodyForAntigravity,
  sanitizeOutgoingHeaders,
  unwrapCcaJson,
  unwrappedResponseHeaders,
  type AntigravitySessionState,
} from "./wire.ts";
import {
  CALLBACK_PATH,
  CALLBACK_PORT,
  REDIRECT_URI,
  buildAuthUrl,
  exchangeToken,
  extractPastedCode,
  newOAuthState,
  refreshToken as refreshAccessToken,
} from "./oauth_flow.ts";

// Configure in `opencode.json` like:
//
// {
//   "plugin": [["@jiafuei/opencode-antigravity-oauth", { "endpointMode": "auto" }]]
// }
//
// Then run `opencode auth login`, pick Google Antigravity, and sign in with
// your Google account. Requests are dispatched through Google's Cloud Code
// Assist endpoints with the native `antigravity/hub` fingerprint, so Gemini,
// Claude, and GPT-OSS models are used with your free Antigravity tier.

const PROVIDER_ID = "google-antigravity";
/** Dummy key so @ai-sdk/google accepts its settings; never sent anywhere. */
const OAUTH_DUMMY_KEY = "opencode-antigravity-oauth-dummy-key";
/** Non-secret marker set by chat.headers; stripped before dispatch. */
const SESSION_MARKER_HEADER = "x-antigravity-opencode-session";
/** Per-invocation UUID; identical values mark SDK retries of the same logical request. */
const INVOCATION_HEADER = "x-antigravity-opencode-invocation";
const WEB_SEARCH_SYMBOL = Symbol.for("@jiafuei/opencode-antigravity-oauth/web-search");
const WEB_SEARCH_USER_AGENT = "antigravity/ide/2.5.5 (aidev_client; os_type=windows; arch=amd64)";
/** Login/browser-callback wait window. */
export const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

type EndpointMode = "auto" | "production" | "sandbox";

export interface AntigravityOAuthOptions extends PluginOptions {
  /**
   * Cloud Code Assist endpoint routing: "auto" (daily first, sandbox
   * failover before the first stream event, remembers the last-good
   * endpoint), or pinned "production" / "sandbox". Defaults to "auto",
   * matching OMP.
   */
  endpointMode?: EndpointMode;
  /**
   * Override the pre-first-event watchdog ceiling (OMP: 60s for Flash,
   * 300s otherwise). Only meaningful in "auto" mode where another endpoint
   * can be tried.
   */
  firstEventTimeoutMs?: number;
}

function officialEndpoint(origin: string): string | undefined {
  if (origin === ANTIGRAVITY_DAILY_ENDPOINT || origin === ANTIGRAVITY_SANDBOX_ENDPOINT) return origin;
  return undefined;
}

/**
 * Endpoint attempt order for a request. Auto consults the session's
 * last-good endpoint first, then daily, then sandbox; pinned modes return a
 * single endpoint.
 */
export function resolveEndpointChain(mode: EndpointMode, lastGood?: string): string[] {
  if (mode === "production") return [ANTIGRAVITY_DAILY_ENDPOINT];
  if (mode === "sandbox") return [ANTIGRAVITY_SANDBOX_ENDPOINT];
  const chain =
    lastGood === ANTIGRAVITY_SANDBOX_ENDPOINT
      ? [ANTIGRAVITY_SANDBOX_ENDPOINT, ANTIGRAVITY_DAILY_ENDPOINT]
      : [ANTIGRAVITY_DAILY_ENDPOINT, ANTIGRAVITY_SANDBOX_ENDPOINT];
  return chain;
}

interface AuthSnapshot {
  kind: "missing" | "api" | "unsupported";
  authType?: string;
}

interface OAuthSnapshot {
  kind: "oauth";
  access: string;
  expires: number;
  refresh: string;
  projectId?: string;
}

interface ActiveOAuthSnapshot extends OAuthSnapshot {
  projectId: string;
}

interface WebSearchBridge {
  search(query: string, signal: AbortSignal): Promise<{
    sources: Array<{ title?: string; url: string }>;
    text: string;
  }>;
}

type AuthClassification = AuthSnapshot | OAuthSnapshot;

async function classify(getAuth: () => Promise<any>): Promise<AuthClassification> {
  const raw = (await getAuth()) as
    | undefined
    | null
    | { type?: string; access?: string; expires?: number; refresh?: string; accountId?: string };
  if (raw === undefined || raw === null) return { kind: "missing" };
  if (raw.type === "api") return { kind: "api" };
  if (raw.type !== "oauth") return { kind: "unsupported", authType: String(raw.type) };
  return {
    kind: "oauth",
    access: raw.access ?? "",
    expires: raw.expires ?? 0,
    refresh: raw.refresh ?? "",
    projectId: raw.accountId,
  };
}

function requireLoginError(snapshot: AuthSnapshot): Error {
  return new Error(
    snapshot.kind === "api"
      ? "The google-antigravity provider only supports Antigravity OAuth transport - run `opencode auth login`, pick Google Antigravity, and sign in with your Google account."
      : "Google Antigravity credentials are missing (logged out?) - run `opencode auth login`, pick Google Antigravity, then choose a sign-in method.",
  );
}

interface StreamTarget {
  kind: "stream" | "nonstream";
  logicalModelId: string;
}

function parseGenerateContentPath(pathname: string): StreamTarget | undefined {
  const match = /^\/models\/([^:]+):(streamGenerateContent|generateContent)$/.exec(pathname);
  if (!match) return undefined;
  return { kind: match[2] === "streamGenerateContent" ? "stream" : "nonstream", logicalModelId: match[1]! };
}

/** Login result persisted by OpenCode core: the CCA project rides `accountId`. */
function toAuthResult(credentials: { refresh: string; access: string; expires: number; projectId: string }) {
  return {
    type: "success" as const,
    refresh: credentials.refresh,
    access: credentials.access,
    expires: credentials.expires,
    accountId: credentials.projectId,
  };
}

// ---------------------------------------------------------------------------
// Browser-callback waiter (race-safe: deliveries may arrive before the hook
// callback is invoked, and every terminal path clears the timer).
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
  // The browser can arrive before OpenCode invokes callback(); keep an early
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

export const AntigravityOAuthPlugin: Plugin = async (
  input: PluginInput,
  options?: PluginOptions | AntigravityOAuthOptions,
) => {
  const pluginOptions = options as AntigravityOAuthOptions | undefined;
  if (
    pluginOptions?.endpointMode !== undefined &&
    pluginOptions.endpointMode !== "auto" &&
    pluginOptions.endpointMode !== "production" &&
    pluginOptions.endpointMode !== "sandbox"
  ) {
    throw new Error(`Unsupported Antigravity endpointMode "${String(pluginOptions.endpointMode)}"`);
  }
  if (
    pluginOptions?.firstEventTimeoutMs !== undefined &&
    (!Number.isFinite(pluginOptions.firstEventTimeoutMs) || pluginOptions.firstEventTimeoutMs <= 0)
  ) {
    throw new Error("Antigravity firstEventTimeoutMs must be a finite positive number");
  }
  const endpointMode: EndpointMode =
    pluginOptions?.endpointMode === "production" || pluginOptions?.endpointMode === "sandbox"
      ? pluginOptions.endpointMode
      : "auto";

  // Warm the manifest-discovered client version once per process; failures
  // silently keep the pinned fallback.
  ensureAntigravityVersion().catch(() => {});

  /** Per-OpenCode-session envelope identity; cleaned up on session deletion. */
  const sessionStates = new Map<string, AntigravitySessionState>();
  /** Active credential identity; transitions clear per-session state. */
  let activeProjectId: string | undefined;
  let registeredSearch: WebSearchBridge | undefined;

  const persistCredentials = async (credentials: { refresh: string; access: string; expires: number; projectId: string }) => {
    // `accountId` is an opaque passthrough field in OpenCode's OAuth schema;
    // this plugin stores the Cloud Code Assist project id there so no second
    // credential store is needed.
    const result = await input.client.auth.set({
      path: { id: PROVIDER_ID },
      body: {
        type: "oauth",
        refresh: credentials.refresh,
        access: credentials.access,
        expires: credentials.expires,
        accountId: credentials.projectId,
      } as { type: "oauth"; refresh: string; access: string; expires: number; accountId?: string },
      throwOnError: true,
    });
    if (result && typeof result === "object" && "error" in result && result.error !== undefined) {
      throw new Error(`Failed to persist refreshed Antigravity credentials: ${JSON.stringify(result.error)}`);
    }
  };

  const authFailure = (method: string, error: unknown): never => {
    const detail = error instanceof Error ? error.message : String(error);
    try {
      input.client.app
        .log({
          body: {
            service: "antigravity-oauth",
            level: "error",
            message: `Antigravity ${method} login failed: ${detail}`,
          },
        })
        .catch(() => {});
    } catch {}
    throw new Error(`Antigravity ${method} login failed: ${detail}`);
  };

  const hooks: Hooks = {
    config: async (config: Config) => {
      config.provider ??= {};
      const defaults = {
        npm: "@ai-sdk/google",
        name: "Google Antigravity",
        options: { baseURL: ANTIGRAVITY_DAILY_ENDPOINT },
        models: providerModels(),
      };
      const existing = config.provider[PROVIDER_ID] as Record<string, any> | undefined;
      if (!existing) {
        (config.provider as Record<string, unknown>)[PROVIDER_ID] = defaults;
        return;
      }
      // User-supplied settings win; fill only what is absent.
      existing.name ??= defaults.name;
      existing.npm ??= defaults.npm;
      existing.options = { ...defaults.options, ...(existing.options ?? {}) };
      const models = { ...defaults.models };
      for (const [modelID, userModel] of Object.entries(existing.models ?? {})) {
        models[modelID] = {
          ...models[modelID],
          ...(userModel as Record<string, unknown>),
          variants: {
            ...(models[modelID]?.variants as Record<string, unknown> | undefined),
            ...((userModel as Record<string, any>).variants as Record<string, unknown> | undefined),
          },
        };
      }
      existing.models = models;
    },

    auth: {
      provider: PROVIDER_ID,

      async loader(getAuth) {
        let sharedRefresh: Promise<AuthClassification> | undefined;

        const refreshAndPersist = async (current: OAuthSnapshot): Promise<AuthClassification> => {
          const credentials = await refreshAccessToken(current.refresh, current.projectId ?? "");
          // Fence against concurrent logout / re-login: re-read stored auth
          // before persisting and never overwrite a newer credential.
          const latest = await classify(getAuth);
          if (latest.kind !== "oauth" || latest.refresh !== current.refresh) return latest;
          await persistCredentials(credentials);
          return classify(getAuth);
        };

        const performSharedRefresh = (current: OAuthSnapshot): Promise<AuthClassification> => {
          if (!sharedRefresh) {
            sharedRefresh = refreshAndPersist(current).finally(() => {
              sharedRefresh = undefined;
            });
          }
          return sharedRefresh;
        };

        const requireOAuth = (auth: AuthClassification): ActiveOAuthSnapshot => {
          if (auth.kind !== "oauth" || !auth.projectId || !auth.refresh) {
            sessionStates.clear();
            activeProjectId = undefined;
          }
          if (auth.kind !== "oauth") throw requireLoginError(auth);
          if (!auth.projectId || !auth.refresh) {
            throw new Error(
              "Stored Google Antigravity credentials are incomplete - run `opencode auth login`, pick Google Antigravity, and sign in again.",
            );
          }
          return auth as ActiveOAuthSnapshot;
        };

        const resolveAuth = async (): Promise<ActiveOAuthSnapshot> => {
          // Re-classify on every request so logout and re-login never dispatch
          // stale credentials.
          let auth = requireOAuth(await classify(getAuth));
          if (!auth.access || auth.expires < Date.now()) {
            auth = requireOAuth(await performSharedRefresh(auth));
          }

          if (auth.projectId !== activeProjectId) {
            sessionStates.clear();
            activeProjectId = auth.projectId;
          }
          return auth as ActiveOAuthSnapshot;
        };

        const options = {
          apiKey: OAUTH_DUMMY_KEY,
          // Marker for chat.headers: identifies OAuth sessions without relying
          // on the dummy apiKey, which provider config merging can overwrite.
          antigravityOAuth: true,

          fetch: async (requestInput: string | URL | Request, init?: RequestInit) => {
            const auth = await resolveAuth();

            const url =
              requestInput instanceof URL
                ? requestInput
                : new URL(typeof requestInput === "string" ? requestInput : requestInput.url);
            if (url.username || url.password) {
              throw new Error(`Refusing to send Antigravity OAuth credentials to "${url.origin}"`);
            }

            const inputEndpoint = officialEndpoint(url.origin);
            if (!inputEndpoint) {
              throw new Error(
                `Refusing to send Antigravity OAuth credentials to "${url.origin}" - this transport only supports the official ${ANTIGRAVITY_DAILY_ENDPOINT} and ${ANTIGRAVITY_SANDBOX_ENDPOINT} endpoints.`,
              );
            }

            const headers = new Headers(init?.headers);
            const opencodeSessionId = headers.get(SESSION_MARKER_HEADER) ?? undefined;
            const invocationId = headers.get(INVOCATION_HEADER) ?? undefined;
            // Strip the SDK fingerprint, OpenCode session-routing headers,
            // and both plugin-private markers before anything is sent.
            sanitizeOutgoingHeaders(headers);
            headers.delete(SESSION_MARKER_HEADER);
            headers.delete(INVOCATION_HEADER);

            const target = parseGenerateContentPath(url.pathname);
            if (!target) {
              headers.set("Authorization", `Bearer ${auth.access}`);
              return fetch(requestInput, { ...init, headers });
            }

            const spec = MODEL_SPECS[target.logicalModelId];
            if (!spec) {
              throw new Error(`Unknown google-antigravity model "${target.logicalModelId}"`);
            }
            if (typeof init?.body !== "string" || !init.body.startsWith("{")) {
              throw new Error("Unsupported Antigravity request: expected a JSON string body");
            }
            const args = JSON.parse(init.body) as Record<string, any>;

            const stateKey = opencodeSessionId ?? "";
            let state = opencodeSessionId ? sessionStates.get(stateKey) : undefined;
            if (!state) {
              state = createSessionState();
              if (opencodeSessionId) sessionStates.set(stateKey, state);
            }

            const rewritten = rewriteBodyForAntigravity({
              args,
              logicalModelId: target.logicalModelId,
              projectId: auth.projectId,
              state,
              invocationId,
            });

            // Build the native inference fingerprint from scratch. OpenCode,
            // the AI SDK, and user-supplied tracing headers must not leak.
            for (const name of [...headers.keys()]) headers.delete(name);
            headers.set("Authorization", `Bearer ${auth.access}`);
            headers.set("Content-Type", "application/json");
            headers.set("User-Agent", getAntigravityUserAgent());
            if (target.kind === "stream") headers.set("Accept", "text/event-stream");
            if (target.kind === "stream" && isClaudeModel(rewritten.wireModelId) && spec.reasoning) {
              headers.set("anthropic-beta", CLAUDE_THINKING_BETA_HEADER);
            }

            const verb = target.kind === "stream" ? "streamGenerateContent" : "generateContent";
            const suffix = target.kind === "stream" ? "?alt=sse" : "";
            const probeBudget = pluginOptions?.firstEventTimeoutMs ?? firstEventTimeoutMs(target.logicalModelId);

            const commitCompletion = (endpoint: string, responseId: string | undefined) => {
              state!.lastExecutionId = responseId;
              if (endpointMode === "auto") state!.lastGoodEndpoint = endpoint;
            };

            const streamResponse = (endpoint: string, body: ReadableStream<Uint8Array>, response: Response) => {
              // Session state commits only when the stream completes
              // successfully; failed/cancelled streams poison nothing.
              let lastResponseId: string | undefined;
              return new Response(
                body.pipeThrough(
                  createCcaSseUnwrap({
                    onResponseId: (responseId) => {
                      lastResponseId = responseId;
                    },
                    onComplete: () => commitCompletion(endpoint, lastResponseId),
                  }),
                ),
                { status: response.status, statusText: response.statusText, headers: unwrappedResponseHeaders(response) },
              );
            };

            // Endpoint chain: auto mode fails over between the official
            // endpoints before anything streams, remembering the winner.
            const chain = resolveEndpointChain(endpointMode, state.lastGoodEndpoint);
            let lastError: unknown;
            for (let index = 0; index < chain.length; index++) {
              const endpoint = chain[index]!;
              const isLast = index === chain.length - 1;
              const canProbe = target.kind === "stream" && endpointMode === "auto" && !isLast;

              let response: Response;
              try {
                response = await fetch(`${endpoint}/v1internal:${verb}${suffix}`, {
                  ...init,
                  method: "POST",
                  headers,
                  body: rewritten.body,
                });
              } catch (error) {
                lastError = error;
                if (!isLast && !(init?.signal?.aborted as boolean | undefined)) continue;
                throw error;
              }

              if (!response.ok && !isLast && TRANSIENT_STATUSES.has(response.status)) {
                lastError = new Error(`Cloud Code Assist API error (${response.status}) from ${endpoint}`);
                continue;
              }
              if (!response.ok) return response;

              if (target.kind === "nonstream") {
                const text = await response.text();
                let payload: Record<string, any>;
                try {
                  payload = JSON.parse(text);
                } catch {
                  // Unparseable body: forward it without committing state.
                  return new Response(text, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: unwrappedResponseHeaders(response),
                  });
                }
                const inBand = readInBandError(payload);
                if (inBand) {
                  if (isInBandErrorTransient(inBand)) {
                    lastError = new Error(describeInBandError(inBand));
                    continue;
                  }
                  const status =
                    typeof inBand.code === "number" && inBand.code >= 400 && inBand.code <= 599
                      ? inBand.code
                      : 500;
                  return new Response(JSON.stringify({ error: inBand }), {
                    status,
                    headers: { "content-type": "application/json" },
                  });
                }
                const unwrapped = unwrapCcaJson(payload);
                commitCompletion(endpoint, typeof unwrapped.responseId === "string" ? unwrapped.responseId : undefined);
                return new Response(JSON.stringify(unwrapped), {
                  status: response.status,
                  statusText: response.statusText,
                  headers: unwrappedResponseHeaders(response),
                });
              }

              if (!response.body) return response;

              if (canProbe) {
                // Pre-first-event watchdog: buffer until the first complete
                // SSE event; abandon this endpoint while nothing user-visible
                // has streamed and the failure is failover-safe.
                let probe;
                try {
                  probe = await readFirstSseEvent(response.body, probeBudget, init?.signal ?? undefined);
                } catch (error) {
                  if (init?.signal?.aborted) throw error;
                  lastError = error;
                  continue;
                }
                const inBand = probe.event ? readInBandError(probe.event) : undefined;
                if (inBand) {
                  if (isInBandErrorTransient(inBand)) {
                    await probe.stream.cancel();
                    lastError = new Error(describeInBandError(inBand));
                    continue;
                  }
                  // Non-transient in-band error: surface it; never switch.
                  await probe.stream.cancel();
                  return new Response(errorStream(new Error(describeInBandError(inBand))), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: unwrappedResponseHeaders(response),
                  });
                }
                // Ordinary first event (or clean EOF): expose it and never
                // switch endpoints again.
                return streamResponse(endpoint, probe.stream, response);
              }

              return streamResponse(endpoint, response.body, response);
            }
            throw lastError instanceof Error ? lastError : new Error("All Antigravity endpoints failed");
          },
        };

        const search: WebSearchBridge = {
          async search(query, signal) {
            const auth = await resolveAuth();
            const endpoint = resolveEndpointChain(endpointMode)[0]!;
            const response = await fetch(`${endpoint}/v1internal:generateContent`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${auth.access}`,
                "Content-Type": "application/json",
                "User-Agent": WEB_SEARCH_USER_AGENT,
              },
              body: JSON.stringify({
                project: auth.projectId,
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
            const inBand = readInBandError(payload);
            if (inBand) throw new Error(describeInBandError(inBand));
            if (!response.ok) throw new Error(`Antigravity web search failed (HTTP ${response.status})`);

            const candidate = payload.response?.candidates?.[0];
            const text = candidate?.content?.parts?.flatMap((part: Record<string, any>) =>
              typeof part.text === "string" ? [part.text] : [],
            ).join("") ?? "";
            if (!text) throw new Error("Antigravity web search returned no answer");
            const sources = candidate.groundingMetadata?.groundingChunks?.flatMap((chunk: Record<string, any>) =>
              typeof chunk.web?.uri === "string" ? [{ title: chunk.web.title, url: chunk.web.uri }] : [],
            ) ?? [];
            return { sources, text };
          },
        };
        registeredSearch = search;
        (globalThis as Record<symbol, unknown>)[WEB_SEARCH_SYMBOL] = search;
        return options;
      },

      methods: [
        {
          type: "oauth",
          label: "Antigravity (browser)",
          authorize: async () => {
            const state = newOAuthState();
            // The waiter exists before the server so a callback racing ahead
            // of OpenCode's callback() invocation can never be lost.
            const waiter = createCallbackWaiter(state);

            let server: { stop(closeActive?: boolean): void | Promise<void> };
            try {
              server = Bun.serve({
                port: CALLBACK_PORT,
                hostname: "127.0.0.1",
                async fetch(request) {
                  const body = waiter.deliver(new URL(request.url).href);
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
                "Complete sign-in while this command remains open. A callback server is listening on 127.0.0.1:51121; if your browser cannot reach it, restart login with the paste-code method.",
              method: "auto" as const,
              callback: async () => {
                try {
                  const code = await waiter.promise;
                  return toAuthResult(await exchangeToken(code, REDIRECT_URI));
                } catch (error) {
                  return authFailure("browser", error);
                } finally {
                  waiter.dispose();
                  void server.stop();
                }
              },
            };
          },
        },
        {
          type: "oauth",
          label: "Antigravity (paste code)",
          authorize: async () => {
            const state = newOAuthState();
            return {
              url: buildAuthUrl(state, REDIRECT_URI),
              instructions:
                "Complete sign-in. Google will redirect to 127.0.0.1:51121 and the browser may show 'cannot connect' because paste mode intentionally runs no callback server. Copy the COMPLETE URL from the browser address bar and paste it here; use the URL generated by this login attempt.",
              method: "code" as const,
              callback: async (pasted: string) => {
                const code = extractPastedCode(pasted, state);
                if (!code) {
                  return authFailure(
                    "paste-code",
                    new Error("the pasted value is not a code or matching redirect URL from this login attempt"),
                  );
                }
                try {
                  return toAuthResult(await exchangeToken(code, REDIRECT_URI));
                } catch (error) {
                  return authFailure("paste-code", error);
                }
              },
            };
          },
        },
      ],
    },

    "chat.headers": async (input, output) => {
      if (input.model.providerID !== PROVIDER_ID) return;
      // Only fingerprint OAuth sessions; marker-based so provider config
      // apiKey merging cannot disable stable session propagation.
      if ((input.provider.options as Record<string, unknown>).antigravityOAuth !== true) return;
      output.headers[SESSION_MARKER_HEADER] = input.sessionID;
      // Fresh UUID per logical OpenCode LLM invocation. SDK retries reuse the
      // prepared headers — and therefore this id — so they do not advance the
      // request-chain step.
      output.headers[INVOCATION_HEADER] = crypto.randomUUID();
    },

    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        sessionStates.delete(event.properties.info.id);
      }
    },

    dispose: async () => {
      sessionStates.clear();
      const registry = globalThis as Record<symbol, unknown>;
      if (registry[WEB_SEARCH_SYMBOL] === registeredSearch) delete registry[WEB_SEARCH_SYMBOL];
    },
  };
  return hooks;
};

export default {
  id: "antigravity_oauth",
  server: AntigravityOAuthPlugin,
};
