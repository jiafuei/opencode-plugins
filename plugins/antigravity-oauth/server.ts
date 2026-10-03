import { Connection, Credential, Integration, Plugin } from "@opencode/plugin";
import { discoverModels } from "./discovery.ts";
import { goFetch } from "./transport.ts";
import {
  ANTIGRAVITY_DAILY_ENDPOINT,
  ANTIGRAVITY_ENDPOINTS,
  ANTIGRAVITY_SANDBOX_ENDPOINT,
  COMPACTION_PROMPT,
  COMPACTION_RESUME_HEADER,
  PROVIDER_ID,
  SNAPSHOT_CATALOG,
  WIRE_MODEL_HEADER,
  antigravityHeaders,
  createCcaSseUnwrap,
  createSessionState,
  describeInBandError,
  getAntigravityPlatform,
  getAntigravityVersion,
  providerModels,
  readInBandError,
  rewriteBodyForAntigravity,
  unwrapCcaJson,
  unwrappedResponseHeaders,
  type AntigravitySessionState,
  type StreamCompletion,
  type WireCatalog,
} from "./wire.ts";
import {
  CALLBACK_PATH,
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
//   "plugins": [{ "package": "@jiafuei/opencode-antigravity-oauth", "options": { "endpointMode": "auto", "trajectoryAcls": false, "metrics": false } }]
// }
//
// Then connect Google Antigravity and sign in with your Google account.
// Requests are dispatched through Google's Cloud Code Assist endpoints with
// the native Antigravity IDE fingerprint, so Gemini, Claude, and GPT-OSS
// models are used with your free Antigravity tier.

const INTEGRATION_ID = Integration.ID.make(PROVIDER_ID);
const BROWSER_METHOD_ID = Integration.MethodID.make("browser");
const PASTE_METHOD_ID = Integration.MethodID.make("paste");
/** Login/browser-callback wait window. */
export const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

type EndpointMode = "auto" | "production" | "sandbox";

type TextMessage = { role: string; content: ReadonlyArray<{ type: string; text?: string }> };
// The published plugin types predate this hook, so it is typed here.
type NativeCompaction = {
  sessionID: string;
  messages: ReadonlyArray<TextMessage>;
  retained: ReadonlyArray<unknown>;
  send: (input: { options: Record<string, unknown> }) => Promise<{ content: TextMessage["content"] }>;
  result?: { replacement: ReadonlyArray<unknown> };
};

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
    const options = ctx.options as { endpointMode?: EndpointMode; trajectoryAcls?: boolean; metrics?: boolean };
    if (
      options.endpointMode !== undefined &&
      options.endpointMode !== "auto" &&
      options.endpointMode !== "production" &&
      options.endpointMode !== "sandbox"
    ) {
      throw new Error(`Unsupported Antigravity endpointMode "${String(options.endpointMode)}"`);
    }
    const endpointMode: EndpointMode = options.endpointMode ?? "auto";
    /** Opt-in native side calls around generation requests. */
    const trajectoryAcls = options.trajectoryAcls ?? false;
    const metrics = options.metrics ?? false;
    // Pinned modes use one endpoint; auto starts at daily and falls back to sandbox.
    const endpoints: string[] =
      endpointMode === "production"
        ? [ANTIGRAVITY_DAILY_ENDPOINT]
        : endpointMode === "sandbox"
          ? [ANTIGRAVITY_SANDBOX_ENDPOINT]
          : [...ANTIGRAVITY_ENDPOINTS];

    /** Per-OpenCode-session envelope identity; cleared on session deletion and credential switches. */
    const sessionStates = new Map<string, Map<string, AntigravitySessionState>>();
    /** Sessions with a native compaction in flight; its request carries the native summary prompt. */
    const nativeCompactions = new Set<string>();
    /** Dispatched generation calls, for the metrics the native client records after each stream. */
    const pendingCalls = new WeakMap<
      Request,
      { sentAt: number; access: string; projectId: string; wireModelId: string; trajectoryId?: string }
    >();
    /** Account-specific state loaded from the active connection. */
    let loaded: { connection?: Connection.Info; projectId?: string; catalog?: WireCatalog } = {};

    const load = async () => {
      const connection = await ctx.integration.connection.active(INTEGRATION_ID);
      const credential = connection ? await ctx.integration.connection.resolve(connection).catch(() => undefined) : undefined;
      if (credential?.type !== "oauth") {
        loaded = {};
        return;
      }
      const projectId = credential.metadata?.projectId as string;
      loaded = { connection, projectId, catalog: await discoverModels(credential.access, projectId, endpoints) };
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
              port: 0,
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
              `Could not bind the Antigravity callback server: ${(error as Error).message}. Use the "Antigravity (paste code)" login method instead.`,
            );
          }
          const redirectUri = `http://localhost:${server.port}${CALLBACK_PATH}`;

          return {
            url: buildAuthUrl(state, redirectUri),
            instructions: `Complete sign-in in your browser. A callback server is listening on localhost:${server.port}; if your browser cannot reach it, restart login with the paste-code method.`,
            expiresAt: Date.now() + FLOW_TIMEOUT_MS,
            mode: "auto" as const,
            callback: waiter.promise
              .then((code) => exchangeToken(code, redirectUri))
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
          // Any ephemeral loopback port, like the native flow; nothing listens on it.
          const redirectUri = `http://localhost:${49152 + Math.floor(Math.random() * 16384)}${CALLBACK_PATH}`;
          return {
            url: buildAuthUrl(state, redirectUri),
            instructions:
              "Complete sign-in. Google will redirect to localhost and the browser may show 'cannot connect' because paste mode intentionally runs no callback server. Copy the COMPLETE URL from the browser address bar and paste it here; use the URL generated by this login attempt.",
            mode: "code" as const,
            callback: async (pasted: string) => {
              const code = extractPastedCode(pasted, state);
              if (!code) {
                throw new Error(
                  "Antigravity paste-code login failed: the pasted value is not a code or matching redirect URL from this login attempt",
                );
              }
              return toCredential(PASTE_METHOD_ID, await exchangeToken(code, redirectUri));
            },
          };
        },
        refresh: async (credential) => ({ ...credential, ...(await refreshToken(credential.refresh)) }),
        label: (credential) => credential.metadata?.email as string | undefined,
      });
    });

    // Snapshot models until an account's live agent catalog is discovered;
    // the provider is only available while a connection exists.
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
        models: providerModels(loaded.catalog),
        sourceConnection: loaded.catalog && loaded.connection,
      });
    });

    // The native Gemini client sends `{baseURL}/models/<id>:streamGenerateContent`
    // with the OAuth access token as `x-goog-api-key` and the selected wire
    // model in WIRE_MODEL_HEADER. Rewrite it into the Cloud Code Assist
    // envelope with the native IDE fingerprint.
    await ctx.session.hook(
      "http.request",
      async (evt) => {
        const request = evt.request;
        const match = /\/models\/([^/:]+):(streamGenerateContent|generateContent)$/.exec(new URL(request.url).pathname);
        if (!match) return;
        const verb = match[2]!;
        const stream = verb === "streamGenerateContent";

        const states = sessionStates.get(evt.sessionID) ?? new Map<string, AntigravitySessionState>();
        sessionStates.set(evt.sessionID, states);
        const stateFor = (kind: string) => {
          if (!states.has(kind)) states.set(kind, createSessionState());
          return states.get(kind)!;
        };
        // Auxiliary calls keep their own trajectory and retry endpoint; title
        // and compaction share the conversation's session id and annotations.
        const state = stateFor(evt.kind);
        const kind = evt.kind === "title" || evt.kind === "compaction" ? evt.kind : "agent";
        const wireModelId = request.headers.get(WIRE_MODEL_HEADER)!;
        const model = (loaded.catalog ?? SNAPSHOT_CATALOG)[wireModelId];
        if (!model) throw new Error(`Antigravity model "${wireModelId}" is not in the current model catalog`);
        const args = await request.json();
        if (kind === "compaction" && nativeCompactions.has(evt.sessionID)) {
          args.contents.push({ role: "user", parts: [{ text: COMPACTION_PROMPT }] });
        }
        const envelope = rewriteBodyForAntigravity({
          args,
          logicalModelId: match[1]!,
          wireModelId,
          model,
          projectId: loaded.projectId!,
          state,
          history: kind === "agent" ? state : stateFor("primary"),
          kind,
        });
        const agent = envelope.requestType === "agent";
        // OpenCode sends the OAuth access token as the Gemini API key. The
        // native header set is rebuilt from scratch so OpenCode, Gemini-client,
        // and user-supplied tracing headers never leak.
        const access = request.headers.get("x-goog-api-key")!;
        const headers = antigravityHeaders(access);
        const endpoint = (endpointMode === "auto" && state.endpoint) || endpoints[0];

        // The native client grants the trajectory's ACL before its first agent
        // request. A failed grant never blocks generation and is retried next time.
        if (trajectoryAcls && agent && !state.aclWritten) {
          state.aclWritten = await goFetch(`${endpoint}/v1internal:writeTrajectoryAcls`, {
            method: "POST",
            headers,
            body: JSON.stringify({ trajectoryId: state.trajectoryId }),
            signal: AbortSignal.timeout(5_000),
          }).then((response) => response.ok, () => false);
        }

        evt.request = new Request(`${endpoint}/v1internal:${verb}${stream ? "?alt=sse" : ""}`, {
          method: "POST",
          headers,
          body: JSON.stringify(envelope),
        });
        pendingCalls.set(evt.request, {
          sentAt: performance.now(),
          access,
          projectId: envelope.project,
          wireModelId,
          ...(agent ? { trajectoryId: state.trajectoryId } : {}),
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
        const state = sessionStates.get(evt.sessionID)!.get(evt.kind)!;
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
          evt.response = new Response(JSON.stringify(unwrapCcaJson(await response.json())), {
            status: response.status,
            statusText: response.statusText,
            headers: unwrappedResponseHeaders(response),
          });
          return;
        }

        // Like the native client, report each completed stream's latency.
        const call = pendingCalls.get(evt.request)!;
        // Protojson seconds at the native clock's 100ns resolution, trimmed to 0/3/6/9 digits.
        const seconds = (ms: number) => {
          const ticks = Math.round(ms * 1e4);
          const nanos = String((ticks % 1e7) * 100).padStart(9, "0").replace(/(000)+$/, "");
          return `${Math.floor(ticks / 1e7)}${nanos && `.${nanos}`}`;
        };
        const duration = (ms: number) => `${seconds(ms)}s`;
        const recordMetrics = ({ traceId, firstMessageAt }: StreamCompletion) => {
          const now = performance.now();
          const epoch = performance.timeOrigin + now;
          void goFetch(`${url.origin}/v1internal:recordCodeAssistMetrics`, {
            method: "POST",
            headers: antigravityHeaders(call.access),
            body: JSON.stringify({
              project: call.projectId,
              requestId: crypto.randomUUID(),
              metadata: { ideType: "ANTIGRAVITY", ideVersion: getAntigravityVersion(), platform: getAntigravityPlatform() },
              metrics: [{
                timestamp: `${new Date(epoch).toISOString().slice(0, 19)}${seconds(epoch % 1000).slice(1)}Z`,
                conversationOffered: {
                  status: "ACTION_STATUS_NO_ERROR",
                  traceId,
                  streamingLatency: {
                    ...(firstMessageAt ? { firstMessageLatency: duration(firstMessageAt - call.sentAt) } : {}),
                    totalLatency: duration(now - call.sentAt),
                  },
                  ...(call.trajectoryId
                    ? { isAgentic: true, initiationMethod: "AGENT", trajectoryId: call.trajectoryId }
                    : {}),
                  language: "unspecified",
                },
              }],
            }),
          }).catch(() => {}); // Telemetry never affects the conversation.
        };
        // Remember which model signed each response and when each tool call
        // arrived, for model-switch replay and native tool-result timestamps.
        const recordChunk = (chunk: Record<string, any>) => {
          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (part.thoughtSignature) state.signatureModels.set(part.thoughtSignature, call.wireModelId);
            if (part.functionCall?.id && !state.callTimes.has(part.functionCall.id)) {
              state.callTimes.set(part.functionCall.id, { created: Date.now() });
            }
          }
        };
        evt.response = new Response(
          response.body!.pipeThrough(createCcaSseUnwrap(failover, metrics ? recordMetrics : undefined, recordChunk)),
          { status: response.status, statusText: response.statusText, headers: unwrappedResponseHeaders(response) },
        );
      },
      { providerID: PROVIDER_ID },
    );

    // Native compaction (opt in with the provider's `compaction.type: "native"`;
    // the hook needs an OpenCode build that has it): the native summary prompt
    // over the full history, and the native resume message as the new window.
    await (ctx.session.hook as any)(
      "experimental.compaction.native",
      async (event: NativeCompaction) => {
        nativeCompactions.add(event.sessionID);
        const { content } = await event.send({ options: {} }).finally(() => nativeCompactions.delete(event.sessionID));
        const summary = content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")
          .trim();
        if (!summary) throw new Error("Antigravity compaction returned no summary");
        // The native message lists the latest ten user requests.
        const requests = event.messages
          .filter((message) => message.role === "user")
          .map((message) =>
            message.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n"),
          )
          .filter((text) => text.trim())
          .slice(-10);
        const resume = [
          COMPACTION_RESUME_HEADER,
          "",
          "You are continuing work on the task described above, but you have lost access to the full conversation history, and need to resume work efficiently using the progress summary below:",
          "",
          "# User Requests",
          "The following were user requests from the truncated conversation in chronological order:",
          ...requests.map((text, index) => `${index + 1}. ${text}`),
          "",
          summary,
        ].join("\n");
        event.result = {
          replacement: [...event.retained.slice(-1), { role: "user", content: [{ type: "text", text: resume }] }],
        };
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
          const response = await goFetch(`${endpoints[0]}/v1internal:generateContent`, {
            method: "POST",
            headers: antigravityHeaders(credential.access),
            body: JSON.stringify({
              project: credential.metadata?.projectId,
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
                tools: [{ googleSearch: { enhancedContent: { imageSearch: { maxResultCount: 5 } } } }],
                generationConfig: { candidateCount: 1 },
              },
              model: "gemini-3.1-flash-lite",
              userAgent: "antigravity",
              requestType: "web_search",
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
        // Like the native client, compaction continues the trajectory; the
        // next request only rebases the shrunken history.
        if (event.type === "session.compaction.ended") {
          const state = sessionStates.get(event.data.sessionID)?.get("primary");
          if (state) state.rebase = true;
        }
        if (event.type === "credential.switched" && event.data.integrationID === INTEGRATION_ID) {
          sessionStates.clear();
          void refresh();
        }
      }
    })();
    void refresh();
  },
});
