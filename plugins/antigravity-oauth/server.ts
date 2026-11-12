import { Credential, Integration, Plugin } from "@opencode/plugin";
import { discoverModels } from "./discovery.ts";
import { goFetch } from "./transport.ts";
import { AntigravityRpc } from "./rpc.ts";
import {
  ANTIGRAVITY_DAILY_ENDPOINT,
  COMPACTION_PROMPT,
  COMPACTION_RESUME_HEADER,
  PROVIDER_ID,
  SNAPSHOT_CATALOG,
  WIRE_MODEL_HEADER,
  antigravityHeaders,
  createCcaSseUnwrap,
  createSessionState,
  describeInBandError,
  randomSignedDecimalSessionId,
  providerModels,
  readInBandError,
  rewriteBodyForAntigravity,
  unwrapCcaJson,
  unwrappedResponseHeaders,
  type AntigravitySessionState,
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
//   "plugins": [{ "package": "@jiafuei/opencode-antigravity-oauth", "options": { "trajectoryAcls": false } }]
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

// Shared across project instances; successful refreshes bridge core's credential-save window.
const refreshes = new Map<string, ReturnType<typeof refreshToken>>();

async function refreshCredential(credential: Credential.OAuth): Promise<Credential.OAuth> {
  const key = credential.refresh;
  let pending = refreshes.get(key);
  if (!pending) {
    pending = refreshToken(key).then((tokens) => {
      setTimeout(() => refreshes.delete(key), 30_000).unref();
      return tokens;
    }).catch((error) => {
      refreshes.delete(key);
      throw error;
    });
    refreshes.set(key, pending);
  }
  return { ...credential, ...(await pending) };
}

type TextMessage = {
  role: string;
  content: ReadonlyArray<{ type: string; text?: string; metadata?: { requests?: string[] } }>;
};
// The published plugin types predate this hook, so it is typed here.
type NativeCompaction = {
  sessionID: string;
  messages: ReadonlyArray<TextMessage>;
  retained: ReadonlyArray<TextMessage>;
  send: (input: { options: Record<string, unknown> }) => Promise<{ content: TextMessage["content"] }>;
  result?: { replacement: ReadonlyArray<unknown> };
};
type NativeCompactionHook = (
  name: "experimental.compaction.native",
  callback: (event: NativeCompaction) => Promise<void>,
  options: { providerID: string },
) => Promise<unknown>;

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
    const options = ctx.options as { trajectoryAcls?: boolean };
    /** Opt-in trajectory ACL grant before generation. */
    const trajectoryAcls = options.trajectoryAcls ?? false;

    /** Per-OpenCode-session envelope identity; cleared on session deletion and credential switches. */
    const sessionStates = new Map<string, {
      sessionId: string;
      trajectories: Map<string, AntigravitySessionState>;
    }>();
    /** Sessions with a native compaction in flight; its request carries the native summary prompt. */
    const nativeCompactions = new Set<string>();
    // The Gemini serializer flattens error results into ordinary text. Keep
    // their call IDs from the typed messages before that distinction is lost.
    const failedToolCalls = new Map<string, Set<string>>();
    /** Request-local replay state, retained across response streaming. */
    const pendingCalls = new WeakMap<
      Request,
      {
        wireModelId: string;
        state?: AntigravitySessionState;
      }
    >();
    /** Account-specific state loaded from the active connection. */
    let loaded: {
      connection: NonNullable<Awaited<ReturnType<typeof ctx.integration.connection.active>>>;
      projectId: string;
      catalog: WireCatalog;
      webSearchModelId: string;
      discovered: boolean;
    } | undefined;

    const load = async () => {
      const connection = await ctx.integration.connection.active(INTEGRATION_ID);
      const credential = connection ? await ctx.integration.connection.resolve(connection).catch(() => undefined) : undefined;
      if (!connection || credential?.type !== "oauth") {
        loaded = undefined;
        return;
      }
      const projectId = credential.metadata?.projectId as string;
      const discovered = await discoverModels(credential.access, projectId);
      loaded = {
        connection,
        projectId,
        catalog: discovered?.catalog ?? SNAPSHOT_CATALOG,
        webSearchModelId: discovered?.webSearchModelId ?? "gemini-3.5-flash-lite",
        discovered: discovered !== undefined,
      };
    };
    // Requests wait for the account state, so a prompt sent right after
    // startup or a connection switch still carries the project.
    let loading = Promise.resolve();
    const refresh = () =>
      (loading = loading.then(load)).then(() => Promise.all([ctx.provider.reload(), ctx.websearch.reload()]));

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
        refresh: refreshCredential,
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
        refresh: refreshCredential,
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
        models: providerModels(loaded?.catalog),
        sourceConnection: loaded?.discovered ? loaded.connection : undefined,
      });
    });

    for (const hook of ["context", "compaction", "generate", "title"] as const) {
      await ctx.session.hook(hook, (event) => {
        for (const message of event.messages) {
          if (message.role !== "tool") continue;
          for (const part of message.content) {
            if (part.result.type !== "error") continue;
            let failed = failedToolCalls.get(event.sessionID);
            if (!failed) failedToolCalls.set(event.sessionID, failed = new Set());
            failed.add(part.id);
          }
        }
      }, { providerID: PROVIDER_ID });
    }

    for (const hook of ["context", "compaction", "generate", "title"] as const) {
      await ctx.session.hook(hook, async (event) => {
        if (!event.model.id.startsWith("gemini-") || !event.messages.some((message) => message.role === "assistant")) return;
        const originals = new Map((await ctx.session.context({ sessionID: event.sessionID })).map((message) => [message.id, message]));
        event.messages = event.messages.map((message) => {
          if (message.role !== "assistant") return message;
          const original = originals.get(message.id);
          // Incomplete/failed responses keep core's replay restrictions.
          if (original?.type !== "assistant" || original.error || original.finish === undefined ||
            original.model.providerID !== PROVIDER_ID || !original.model.id.startsWith("gemini-")) return message;
          return {
            ...message,
            content: message.content.map((part) => {
              const source = original.content.find((item) =>
                part.type === "tool-call"
                  ? item.type === "tool" && item.id === part.id
                  : (part.type === "text" || part.type === "reasoning") && item.type === part.type && item.text === part.text,
              );
              const signature = source?.native?.thoughtSignature;
              if (typeof signature !== "string") return part;
              return {
                ...part,
                providerMetadata: {
                  ...part.providerMetadata,
                  google: { ...part.providerMetadata?.google, thoughtSignature: signature },
                },
              };
            }),
          };
        });
      }, { providerID: PROVIDER_ID });
    }

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
        await loading;
        const account = loaded;
        if (!account) throw new Error("Google Antigravity is not connected.");
        const verb = match[2]!;
        const stream = verb === "streamGenerateContent";

        let session = sessionStates.get(evt.sessionID);
        if (!session) {
          session = { sessionId: randomSignedDecimalSessionId(), trajectories: new Map() };
          sessionStates.set(evt.sessionID, session);
        }
        const mode = evt.kind === "compaction" && nativeCompactions.has(evt.sessionID)
          ? "native-compaction"
          : evt.kind === "title" || evt.kind === "compaction" ? "passthrough" : "agent";
        let execution: { mode: "passthrough" } | { mode: "agent" | "native-compaction"; state: AntigravitySessionState } = { mode: "passthrough" };
        if (mode !== "passthrough") {
          const key = mode === "native-compaction" ? "primary" : evt.kind;
          let state = session.trajectories.get(key);
          if (!state) {
            state = createSessionState(key === "primary" ? session.sessionId : undefined);
            session.trajectories.set(key, state);
          }
          execution = { mode, state };
        }
        const state = execution.mode === "passthrough" ? undefined : execution.state;
        const wireModelId = request.headers.get(WIRE_MODEL_HEADER)!;
        const model = account.catalog[wireModelId];
        if (!model) throw new Error(`Antigravity model "${wireModelId}" is not in the current model catalog`);
        if (model.disabled) throw new Error(`Antigravity model "${wireModelId}" is unavailable. ${model.tagDescription ?? ""}`.trim());
        const args = await request.json() as Parameters<typeof rewriteBodyForAntigravity>[0]["args"];
        if (mode === "native-compaction") {
          args.contents.push({ role: "user", parts: [{ text: COMPACTION_PROMPT }] });
        }
        const envelope = rewriteBodyForAntigravity({
          args,
          logicalModelId: match[1]!,
          wireModelId,
          model,
          projectId: account.projectId,
          sessionId: state?.sessionId ?? session.sessionId,
          ...execution,
          failedToolCalls: failedToolCalls.get(evt.sessionID),
        });
        const agent = envelope.requestType === "agent";
        // OpenCode sends the OAuth access token as the Gemini API key. The
        // native header set is rebuilt from scratch so OpenCode, Gemini-client,
        // and user-supplied tracing headers never leak.
        const access = request.headers.get("x-goog-api-key")!;
        const headers = antigravityHeaders(access);

        // The native client grants the trajectory's ACL before its first agent
        // request. A failed grant never blocks generation and is retried next time.
        if (trajectoryAcls && agent && state && !state.aclWritten) {
          state.aclWritten = await goFetch(`${ANTIGRAVITY_DAILY_ENDPOINT}/v1internal:writeTrajectoryAcls`, {
            method: "POST",
            headers,
            body: JSON.stringify({ trajectoryId: state.trajectoryId }),
            signal: AbortSignal.timeout(5_000),
          }).then((response) => response.ok, () => false);
        }

        evt.request = new Request(`${ANTIGRAVITY_DAILY_ENDPOINT}/v1internal:${verb}${stream ? "?alt=sse" : ""}`, {
          method: "POST",
          headers,
          body: JSON.stringify(envelope),
        });
        pendingCalls.set(evt.request, {
          wireModelId,
          state,
        });
      },
      { providerID: PROVIDER_ID },
    );

    // Unwrap Cloud Code Assist responses back into plain Gemini for the native parser.
    await ctx.session.hook(
      "http.response",
      async (evt) => {
        const url = new URL(evt.request.url);
        const verb = /^\/v1internal:(streamGenerateContent|generateContent)$/.exec(url.pathname)?.[1];
        if (!verb) return;
        const call = pendingCalls.get(evt.request)!;
        const state = call.state;
        const response = evt.response;

        if (!response.ok) {
          const payload = await response.clone().json().catch(() => undefined) as { error?: Record<string, unknown> } | undefined;
          const verification = accountVerificationMessage(payload, "retry your request");
          if (!verification) return;
          evt.response = new Response(JSON.stringify({ error: { ...payload?.error, message: verification } }), {
            status: response.status,
            statusText: response.statusText,
            headers: unwrappedResponseHeaders(response),
          });
          return;
        }

        if (verb === "generateContent") {
          evt.response = new Response(JSON.stringify(unwrapCcaJson(await response.json() as Parameters<typeof unwrapCcaJson>[0])), {
            status: response.status,
            statusText: response.statusText,
            headers: unwrappedResponseHeaders(response),
          });
          return;
        }

        // Remember which model signed each response and when each tool call
        // arrived, for model-switch replay and native tool-result timestamps.
        const recordChunk = (chunk: Record<string, any>) => {
          if (!state) return;
          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (part.thoughtSignature) state.signatureModels.set(part.thoughtSignature, call.wireModelId);
            if (part.functionCall?.id && !state.callTimes.has(part.functionCall.id)) {
              state.callTimes.set(part.functionCall.id, { created: Date.now() });
            }
          }
        };
        evt.response = new Response(
          response.body!.pipeThrough(createCcaSseUnwrap(recordChunk)),
          { status: response.status, statusText: response.statusText, headers: unwrappedResponseHeaders(response) },
        );
      },
      { providerID: PROVIDER_ID },
    );

    // Native compaction (opt in with the provider's `compaction.type: "native"`;
    // the hook needs an OpenCode build that has it): the native summary prompt
    // over the full history, and the native resume message as the new window.
    await (ctx.session.hook as typeof ctx.session.hook & NativeCompactionHook)(
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
        // The native message lists the latest ten user requests. Core retains the
        // user's own messages since the last compaction (typed text first); earlier
        // requests ride on the previous resume message, which follows that window's
        // latest user request.
        const previous = event.messages.findLastIndex((message) => message.content[0]?.metadata?.requests);
        const latest = event.retained.length
          ? event.retained.slice(-1)
          : previous > 0 ? event.messages.slice(previous - 1, previous) : [];
        const requests = [
          ...(event.messages[previous]?.content[0]!.metadata!.requests ?? []),
          ...event.retained.flatMap(({ content: [part] }) => (part?.type === "text" && part.text!.trim() ? [part.text!] : [])),
        ].slice(-10);
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
          replacement: [...latest, { role: "user", content: [{ type: "text", text: resume, metadata: { requests } }] }],
        };
      },
      { providerID: PROVIDER_ID },
    );

    // The native client's quota summary request (October 3 capture).
    await ctx.rpc.register(AntigravityRpc, {
      usage: async () => {
        const connection = await ctx.integration.connection.active(INTEGRATION_ID);
        const credential = connection && (await ctx.integration.connection.resolve(connection));
        if (credential?.type !== "oauth") throw new Error("Google Antigravity is not connected.");
        const response = await goFetch(`${ANTIGRAVITY_DAILY_ENDPOINT}/v1internal:retrieveUserQuotaSummary`, {
          method: "POST",
          headers: antigravityHeaders(credential.access),
          body: JSON.stringify({ project: credential.metadata?.projectId }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`Antigravity quota request failed: ${response.status}`);
        const summary = (await response.json()) as {
          groups: { displayName: string; buckets: { window: string; remainingFraction: number; resetTime: string }[] }[];
        };
        return {
          groups: summary.groups.map((group) => ({
            name: group.displayName,
            buckets: group.buckets.map(({ window, remainingFraction, resetTime }) => ({ window, remainingFraction, resetTime })),
          })),
        };
      },
    });

    await ctx.websearch.transform((editor) => {
      const account = loaded;
      if (!account) return;
      editor.add({
        id: "antigravity",
        name: "Google Antigravity",
        execute: async ({ query }, { signal }) => {
          const connection = await ctx.integration.connection.active(INTEGRATION_ID);
          const credential = connection && (await ctx.integration.connection.resolve(connection));
          if (credential?.type !== "oauth") throw new Error("Connect Google Antigravity before using web search");
          const response = await goFetch(`${ANTIGRAVITY_DAILY_ENDPOINT}/v1internal:generateContent`, {
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
              model: account.webSearchModelId,
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
        if (event.type === "session.deleted") {
          sessionStates.delete(event.data.sessionID);
          failedToolCalls.delete(event.data.sessionID);
        }
        // Like the native client, compaction continues the trajectory; the
        // next request only rebases the shrunken history.
        if (event.type === "session.compaction.ended") {
          const state = sessionStates.get(event.data.sessionID)?.trajectories.get("primary");
          if (state) state.rebase = true;
        }
        if (event.type === "credential.switched" && event.data.integrationID === INTEGRATION_ID) {
          sessionStates.clear();
          failedToolCalls.clear();
          void refresh();
        }
      }
    })();
    void refresh();
  },
});
