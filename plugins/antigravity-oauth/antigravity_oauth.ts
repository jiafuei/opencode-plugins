import { Connection, Credential, Integration, Model, Plugin, Provider } from "@opencode/plugin";
import { discoverModels } from "./discovery.ts";
import {
  ANTIGRAVITY_DAILY_ENDPOINT,
  ANTIGRAVITY_SANDBOX_ENDPOINT,
  CLAUDE_THINKING_BETA_HEADER,
  MODEL_SPECS,
  PROVIDER_ID,
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
/** Non-secret marker set by the model.request hook; stripped before dispatch. */
const SESSION_MARKER_HEADER = "x-antigravity-opencode-session";
/** Per-invocation UUID; identical values mark SDK retries of the same logical request. */
const INVOCATION_HEADER = "x-antigravity-opencode-invocation";
const WEB_SEARCH_USER_AGENT = "antigravity/ide/2.5.5 (aidev_client; os_type=windows; arch=amd64)";
/** Login/browser-callback wait window. */
export const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

type EndpointMode = "auto" | "production" | "sandbox";

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

interface StreamTarget {
  kind: "stream" | "nonstream";
  logicalModelId: string;
}

function parseGenerateContentPath(pathname: string): StreamTarget | undefined {
  const match = /^\/models\/([^:]+):(streamGenerateContent|generateContent)$/.exec(pathname);
  if (!match) return undefined;
  return { kind: match[2] === "streamGenerateContent" ? "stream" : "nonstream", logicalModelId: match[1]! };
}

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
    const options = ctx.options as { endpointMode?: EndpointMode; firstEventTimeoutMs?: number };
    if (
      options.endpointMode !== undefined &&
      options.endpointMode !== "auto" &&
      options.endpointMode !== "production" &&
      options.endpointMode !== "sandbox"
    ) {
      throw new Error(`Unsupported Antigravity endpointMode "${String(options.endpointMode)}"`);
    }
    if (
      options.firstEventTimeoutMs !== undefined &&
      (!Number.isFinite(options.firstEventTimeoutMs) || options.firstEventTimeoutMs <= 0)
    ) {
      throw new Error("Antigravity firstEventTimeoutMs must be a finite positive number");
    }
    const endpointMode: EndpointMode = options.endpointMode ?? "auto";

    // Warm the manifest-discovered client version once per process; failures
    // silently keep the pinned fallback.
    ensureAntigravityVersion().catch(() => {});

    /** Per-OpenCode-session envelope identity; cleared on session deletion and credential switches. */
    const sessionStates = new Map<string, AntigravitySessionState>();
    /** Account-specific state loaded from the active connection. */
    let loaded: { connection?: Connection.Info; models?: Model.Info[] } = {};

    const load = async () => {
      const connection = await ctx.integration.connection.active(INTEGRATION_ID);
      const credential = connection ? await ctx.integration.connection.resolve(connection).catch(() => undefined) : undefined;
      if (credential?.type !== "oauth") {
        loaded = {};
        return;
      }
      const available = await discoverModels(credential.access, resolveEndpointChain(endpointMode));
      loaded = { connection, models: available && providerModels(available) };
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
          package: "aisdk:@ai-sdk/google",
          settings: { baseURL: ANTIGRAVITY_DAILY_ENDPOINT },
        },
        models: loaded.models ?? providerModels(),
        sourceConnection: loaded.models && loaded.connection,
      });
    });

    // Core passes the resolved OAuth access token as `apiKey` and the
    // credential metadata (`projectId`) into the SDK options. @ai-sdk/google
    // reads `options.fetch` lazily per language model, so this also applies
    // when another plugin constructed the SDK first.
    await ctx.aisdk.hook(
      "sdk",
      (evt) => {
        const access = evt.options.apiKey as string;
        const projectId = evt.options.projectId as string;
        const upstream = evt.options.fetch as typeof fetch;
        evt.options.fetch = async (requestInput: string | URL | Request, init?: RequestInit) => {
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
          headers.set("Authorization", `Bearer ${access}`);
          return upstream(requestInput, { ...init, headers });
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
          projectId,
          state,
          invocationId,
        });

        // Build the native inference fingerprint from scratch. OpenCode,
        // the AI SDK, and user-supplied tracing headers must not leak.
        for (const name of [...headers.keys()]) headers.delete(name);
        headers.set("Authorization", `Bearer ${access}`);
        headers.set("Content-Type", "application/json");
        headers.set("User-Agent", getAntigravityUserAgent());
        if (target.kind === "stream") headers.set("Accept", "text/event-stream");
        if (target.kind === "stream" && isClaudeModel(rewritten.wireModelId) && spec.reasoning) {
          headers.set("anthropic-beta", CLAUDE_THINKING_BETA_HEADER);
        }

        const verb = target.kind === "stream" ? "streamGenerateContent" : "generateContent";
        const suffix = target.kind === "stream" ? "?alt=sse" : "";
        const probeBudget = options.firstEventTimeoutMs ?? firstEventTimeoutMs(target.logicalModelId);

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
            response = await upstream(`${endpoint}/v1internal:${verb}${suffix}`, {
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
          if (!response.ok) {
            const payload = await response.clone().json().catch(() => undefined);
            const verification = accountVerificationMessage(payload, "retry your request");
            if (!verification) return response;
            return new Response(JSON.stringify({ error: { ...payload.error, message: verification } }), {
              status: response.status,
              statusText: response.statusText,
              headers: unwrappedResponseHeaders(response),
            });
          }

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
        };
      },
      { providerID: PROVIDER_ID },
    );

    await ctx.session.hook(
      "model.request",
      (evt) => {
        evt.headers[SESSION_MARKER_HEADER] = evt.sessionID;
        // Fresh UUID per logical OpenCode LLM invocation. SDK retries reuse
        // the prepared headers — and therefore this id — so they do not
        // advance the request-chain step.
        evt.headers[INVOCATION_HEADER] = crypto.randomUUID();
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
          const endpoint = resolveEndpointChain(endpointMode)[0]!;
          const response = await fetch(`${endpoint}/v1internal:generateContent`, {
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
