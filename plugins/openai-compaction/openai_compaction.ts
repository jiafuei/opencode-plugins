import type { Plugin, PluginOptions } from "@opencode-ai/plugin";
import { rm } from "node:fs/promises";
import {
  compactUrl,
  compactionDirectory,
  isCodexResponsesEndpoint,
  isResponsesBody,
  isResponsesEndpoint,
  normalizeEndpoint,
  planRequest,
  readCompactedWindow,
  readStreamingCompactedWindow,
  statePath,
  type CompactionState,
  type ResponsesBody,
} from "./openai_compaction_shared";

// Configure the package in `opencode.json` like:
//
// {
//   "plugin": [
//     ["@jiafuei/opencode-openai-compaction", {
//       "threshold": "70%",
//       "additionalProviders": ["openai-compatible"],
//       "debug": false
//     }]
//   ]
// }

type CompactionOptions = {
  enabled?: boolean;
  threshold?: number | `${number}%`;
  additionalProviders?: string[];
  debug?: boolean;
};

type SessionInfo = {
  contextLimit: number;
  providerID: string;
  model: string;
  messageID: string;
  failed: boolean;
  latestTokens?: number;
  latestTokenMessageID?: string;
  lastDecision?: {
    type: "passthrough" | "replay" | "compact";
    reason?: string;
    tokens: number;
    tokenThreshold: number;
    state: "none" | "valid" | "stale";
  };
};

type LogClient = {
  app: {
    log(input: {
      body: { service: string; level: "debug" | "info" | "warn" | "error"; message: string; extra?: Record<string, unknown> };
      query: { directory: string };
    }): Promise<unknown>;
  };
};

type PartUpdateClient = {
  _client: {
    patch(input: {
      url: "/session/{sessionID}/message/{messageID}/part/{partID}";
      path: { sessionID: string; messageID: string; partID: string };
      query: { directory: string };
      body: {
        id: string;
        sessionID: string;
        messageID: string;
        type: "text";
        text: string;
        synthetic: true;
        ignored: true;
      };
      headers: { "content-type": "application/json" };
    }): Promise<{ error?: unknown }>;
  };
};

const SESSION_HEADER = "x-opencode-openai-compaction";
const SKIPPED_AGENTS = new Set(["title", "compaction"]);

function totalOpenCodeTokens(tokens: {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

const OpenAICompactionPlugin: Plugin = async ({ client, project, directory }, options) => {
  const config = (options ?? {}) as PluginOptions & CompactionOptions;
  if (config.enabled === false) return {};
  const providers = new Set(["openai", ...(config.additionalProviders ?? [])]);

  const configuredThreshold = config.threshold ?? 0.7;
  let threshold: number;
  if (typeof configuredThreshold === "number") {
    threshold = configuredThreshold;
  } else if (typeof configuredThreshold === "string") {
    const match = /^(\d+(?:\.\d+)?)%$/.exec(configuredThreshold);
    threshold = match ? Number(match[1]) / 100 : Number.NaN;
  } else {
    threshold = Number.NaN;
  }
  if (!Number.isFinite(threshold) || threshold <= 0 || (typeof configuredThreshold === "string" && threshold > 1)) {
    throw new Error("OpenAI compaction threshold must be a positive number or a percentage in (0%, 100%]");
  }

  // `Bun.write` creates the parent directory on first save.
  const root = compactionDirectory(project.id, directory);
  const logClient = client as unknown as LogClient;
  // The legacy plugin client does not expose the experimental part endpoint.
  // Reuse its configured transport so server auth and in-process fetch still work.
  const partClient = (client.session as unknown as PartUpdateClient)._client;
  const sessions = new Map<string, SessionInfo>();
  const states = new Map<string, CompactionState | undefined>();
  const originalFetch = globalThis.fetch;
  let disposed = false;

  const log = (level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) => {
    if (level === "debug" && !config.debug) return;
    logClient.app
      .log({ body: { service: "openai-compaction", level, message, extra }, query: { directory } })
      .catch(() => {});
  };
  log("info", "plugin initialized", {
    threshold: configuredThreshold,
    providers: [...providers],
    debug: config.debug === true,
  });

  const readState = async (sessionID: string) => {
    if (states.has(sessionID)) return states.get(sessionID);
    const state = (await Bun.file(statePath(root, sessionID))
      .json()
      .catch(() => undefined)) as CompactionState | undefined;
    states.set(sessionID, state);
    return state;
  };

  const writeState = async (state: CompactionState) => {
    states.set(state.sessionID, state);
    await Bun.write(statePath(root, state.sessionID), JSON.stringify(state));
  };

  const discardState = async (sessionID: string) => {
    states.delete(sessionID);
    await rm(statePath(root, sessionID), { force: true });
  };

  const compact = async (
    url: string,
    headers: Headers,
    body: ResponsesBody,
    input: unknown[],
    instructions: string,
  ) => {
    const codex = isCodexResponsesEndpoint(url);
    const compactHeaders = new Headers(headers);
    compactHeaders.set("content-type", "application/json");
    const endpoint = codex ? normalizeEndpoint(url) : compactUrl(url);
    let compactBody: ResponsesBody;
    if (codex) {
      compactHeaders.set("accept", "text/event-stream");
      compactHeaders.set("openai-beta", "responses=experimental");
      compactHeaders.set("x-codex-beta-features", "remote_compaction_v2");
      const include = Array.isArray(body.include)
        ? [...new Set([...body.include, "reasoning.encrypted_content"])]
        : body.reasoning
          ? ["reasoning.encrypted_content"]
          : undefined;
      compactBody = {
        model: body.model,
        input: [...input, { type: "compaction_trigger" }],
        instructions,
        stream: true,
        store: false,
        ...(body.reasoning ? { reasoning: body.reasoning } : {}),
        ...(include ? { include } : {}),
        ...(typeof body.prompt_cache_key === "string" ? { prompt_cache_key: body.prompt_cache_key } : {}),
        ...(Array.isArray(body.tools) && body.tools.length > 0
          ? { tools: body.tools, tool_choice: "auto" }
          : {}),
      };
    } else {
      compactHeaders.set("accept", "application/json");
      compactBody = { model: body.model, input, instructions };
    }
    const response = await originalFetch(endpoint, {
      method: "POST",
      headers: compactHeaders,
      body: JSON.stringify(compactBody),
    });
    if (!response.ok) {
      log("warn", "compact request failed", {
        endpoint,
        protocol: codex ? "codex_v2" : "responses_compact",
        status: response.status,
        body: await response.text(),
      });
      return undefined;
    }
    const window = codex
      ? readStreamingCompactedWindow(await response.text(), input)
      : readCompactedWindow(await response.json());
    if (!window) log("warn", "compact response had no output items");
    return window;
  };

  const showCompactionToast = () => {
    void client.tui
      .showToast({
        body: {
          title: "Context compaction",
          message: "Compacting context...",
          variant: "info",
          duration: 5_000,
        },
      })
      .catch(() => {});
  };

  const writeCompactionPart = async (sessionID: string, messageID: string, partID: string, text: string) => {
    const result = await partClient.patch({
      url: "/session/{sessionID}/message/{messageID}/part/{partID}",
      path: { sessionID, messageID, partID },
      query: { directory },
      body: {
        id: partID,
        sessionID,
        messageID,
        type: "text",
        text,
        synthetic: true,
        ignored: true,
      },
      headers: { "content-type": "application/json" },
    });
    if (result.error) throw result.error;
  };

  const rewrite = async (sessionID: string, url: string, body: ResponsesBody, headers: Headers) => {
    const info = sessions.get(sessionID);
    if (!info) {
      log("debug", "tagged request has no session metadata", { sessionID });
      return undefined;
    }
    if (info.failed) {
      log("debug", "native compaction is disabled after an earlier failure", { sessionID });
      return undefined;
    }

    const endpoint = normalizeEndpoint(url);
    const plan = planRequest({
      body,
      state: await readState(sessionID),
      endpoint,
      contextLimit: info.contextLimit,
      threshold,
      latestTokens: info.latestTokens,
    });
    info.lastDecision = {
      type: plan.type,
      ...(plan.type === "compact" ? {} : { reason: plan.reason }),
      tokens: plan.tokens,
      tokenThreshold: plan.tokenThreshold,
      state: plan.state,
    };
    log("debug", "evaluated request", {
      sessionID,
      model: body.model,
      contextLimit: info.contextLimit,
      inputItems: body.input.length,
      ...info.lastDecision,
    });
    if (plan.type === "passthrough") return undefined;
    if (plan.type === "replay") {
      log("debug", "replaying compacted window", {
        sessionID,
        originalItems: body.input.length,
        rewrittenItems: plan.input.length,
      });
      return { body: { ...body, input: plan.input }, fresh: false };
    }

    showCompactionToast();
    const time = (BigInt(Date.now()) * 0x1000n + 1n).toString(16).padStart(12, "0");
    const partID = `prt_${time}${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`;
    const partVisible = await writeCompactionPart(
      sessionID,
      info.messageID,
      partID,
      "--- Compacting context... ---",
    ).then(
      () => true,
      (error) => {
        log("warn", "could not show compaction transcript marker", {
          sessionID,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      },
    );

    let window: unknown[] | undefined;
    try {
      window = await compact(url, headers, body, plan.compactInput, plan.instructions);
    } catch (error) {
      if (partVisible) {
        await writeCompactionPart(sessionID, info.messageID, partID, "--- Context compaction failed ---").catch(
          () => {},
        );
      }
      throw error;
    }
    if (partVisible) {
      await writeCompactionPart(
        sessionID,
        info.messageID,
        partID,
        window ? "--- Context compacted ---" : "--- Context compaction failed ---",
      ).catch(() => {});
    }
    if (!window) {
      info.failed = true;
      return plan.fallbackInput ? { body: { ...body, input: plan.fallbackInput }, fresh: false } : undefined;
    }

    await writeState({
      sessionID,
      model: body.model,
      endpoint,
      compactedCount: plan.compactedCount,
      signature: plan.signature,
      window,
    });
    const input = [...plan.envelope, ...window, ...plan.keptTail];
    log("info", "compacted session context", {
      sessionID,
      originalItems: body.input.length,
      compactedItems: plan.compactInput.length,
      windowItems: window.length,
      rewrittenItems: input.length,
    });
    return { body: { ...body, input }, fresh: true };
  };

  // Wrapping the global fetch keeps this transform innermost: opencode's built-in
  // codex plugin rewrites the URL and injects the OAuth token in its own fetch,
  // so by the time we run the request is fully authenticated and addressed.
  const patchedFetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (disposed || init?.method?.toUpperCase() !== "POST" || typeof init.body !== "string") {
      return originalFetch(input, init);
    }
    const headers = new Headers(init.headers);
    const sessionID = headers.get(SESSION_HEADER);
    if (!sessionID) return originalFetch(input, init);

    headers.delete(SESSION_HEADER);
    const forward = { ...init, headers };
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(init.body);
    if (!isResponsesBody(body) || !isResponsesEndpoint(url)) return originalFetch(input, forward);

    const rewritten = await rewrite(sessionID, url, body, headers).catch((error) => {
      const info = sessions.get(sessionID);
      if (info) info.failed = true;
      log("warn", "native compaction failed, sending original request", {
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    });
    if (!rewritten) return originalFetch(input, forward);

    const response = await originalFetch(input, { ...forward, body: JSON.stringify(rewritten.body) });
    // A payload-shaped rejection means the window is unusable, so drop it either way.
    // A rejected replay is usually an expired window and worth retrying next turn; a
    // window rejected the moment it was created means this provider will not take our
    // payload at all, so stop rewriting for the rest of the session.
    if (response.status === 400 || response.status === 422) {
      await discardState(sessionID);
      const info = sessions.get(sessionID);
      if (info && rewritten.fresh) info.failed = true;
      log("warn", "provider rejected the compacted payload, discarding stored window", {
        sessionID,
        status: response.status,
        fresh: rewritten.fresh,
      });
    }
    return response;
  };
  globalThis.fetch = patchedFetch as typeof globalThis.fetch;

  return {
    "chat.headers": async (input, output) => {
      if (!providers.has(input.model.providerID)) return;
      if (SKIPPED_AGENTS.has(input.agent)) {
        log("debug", "skipping internal agent", {
          sessionID: input.sessionID,
          agent: input.agent,
        });
        return;
      }
      const previous = sessions.get(input.sessionID);
      const sameModel = previous?.providerID === input.model.providerID && previous.model === input.model.id;
      const latest = sameModel && previous !== undefined && previous.latestTokens !== undefined
        ? {
            tokens: previous.latestTokens,
            messageID: previous.latestTokenMessageID,
          }
        : await client.session
            .messages({ path: { id: input.sessionID }, query: { directory, limit: 20 } })
            .then((result) => {
              const messages = result.data ?? [];
              for (let index = messages.length - 1; index >= 0; index--) {
                const message = messages[index]?.info;
                if (message?.role !== "assistant" || message.summary) continue;
                const tokens = totalOpenCodeTokens(message.tokens);
                if (tokens > 0) {
                  return {
                    tokens,
                    messageID: message.id,
                  };
                }
              }
              return { tokens: 0 };
            })
            .catch(() => undefined);
      sessions.set(input.sessionID, {
        contextLimit: input.model.limit.context,
        providerID: input.model.providerID,
        model: input.model.id,
        messageID: input.message.id,
        failed: sameModel && previous !== undefined ? previous.failed : false,
        latestTokens: latest?.tokens,
        latestTokenMessageID: latest?.messageID,
        lastDecision: sameModel && previous !== undefined ? previous.lastDecision : undefined,
      });
      output.headers[SESSION_HEADER] = input.sessionID;
      log("debug", "tracking session request", {
        sessionID: input.sessionID,
        providerID: input.model.providerID,
        model: input.model.id,
        agent: input.agent,
        contextLimit: input.model.limit.context,
        latestTokens: latest?.tokens,
        tokenThreshold: threshold <= 1 ? input.model.limit.context * threshold : threshold,
      });
    },
    "experimental.session.compacting": async (input) => {
      const info = sessions.get(input.sessionID);
      if (!info) return;
      log("warn", "OpenCode built-in compaction started", {
        sessionID: input.sessionID,
        providerID: info.providerID,
        model: info.model,
        contextLimit: info.contextLimit,
        nativeFailed: info.failed,
        lastDecision: info.lastDecision,
      });
    },
    event: async ({ event }) => {
      if (event.type === "message.updated") {
        const message = event.properties.info;
        if (message.role !== "assistant" || message.summary || SKIPPED_AGENTS.has(message.mode)) return;
        const info = sessions.get(message.sessionID);
        if (!info || info.providerID !== message.providerID || info.model !== message.modelID) return;
        const tokens = totalOpenCodeTokens(message.tokens);
        if (tokens > 0) {
          info.latestTokens = tokens;
          info.latestTokenMessageID = message.id;
        }
        return;
      }
      if (event.type === "message.removed") {
        const info = sessions.get(event.properties.sessionID);
        if (info?.latestTokenMessageID === event.properties.messageID) {
          info.latestTokens = undefined;
          info.latestTokenMessageID = undefined;
        }
        return;
      }
      if (event.type === "session.deleted") {
        const sessionID = event.properties.info.id;
        sessions.delete(sessionID);
        await discardState(sessionID);
      }
    },
    // Another plugin instance may have wrapped ours afterwards; in that case the
    // `disposed` flag turns this wrapper into a pass-through instead.
    dispose: async () => {
      disposed = true;
      if (globalThis.fetch === patchedFetch) globalThis.fetch = originalFetch;
    },
  };
};

export default {
  id: "openai_compaction",
  server: OpenAICompactionPlugin,
};
