import type { Plugin, PluginOptions } from "@opencode-ai/plugin";
import { rm } from "node:fs/promises";
import {
  compactUrl,
  compactionDirectory,
  isResponsesBody,
  isResponsesEndpoint,
  normalizeEndpoint,
  planRequest,
  readCompactedWindow,
  statePath,
  type CompactionState,
  type ResponsesBody,
} from "./openai_compaction_shared";

// Configure the package in `opencode.json` like:
//
// {
//   "plugin": [
//     ["@jiafuei/opencode-openai-compaction", {
//       "threshold": 0.7,
//       "debug": false
//     }]
//   ]
// }

type CompactionOptions = {
  enabled?: boolean;
  threshold?: number;
  debug?: boolean;
};

type SessionInfo = {
  contextLimit: number;
  model: string;
  failed: boolean;
};

type LogClient = {
  app: {
    log(input: {
      body: { service: string; level: "debug" | "info" | "warn" | "error"; message: string; extra?: Record<string, unknown> };
      query: { directory: string };
    }): Promise<unknown>;
  };
};

const SESSION_HEADER = "x-opencode-openai-compaction";
const SKIPPED_AGENTS = new Set(["title", "compaction"]);

const OpenAICompactionPlugin: Plugin = async ({ client, project, directory }, options) => {
  const config = (options ?? {}) as PluginOptions & CompactionOptions;
  if (config.enabled === false) return {};

  const threshold = config.threshold ?? 0.7;
  if (typeof threshold !== "number" || threshold <= 0 || threshold > 1) {
    throw new Error("OpenAI compaction threshold must be a number in (0, 1]");
  }

  // `Bun.write` creates the parent directory on first save.
  const root = compactionDirectory(project.id, directory);
  const logClient = client as unknown as LogClient;
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

  const compact = async (url: string, headers: Headers, body: ResponsesBody) => {
    const compactHeaders = new Headers(headers);
    compactHeaders.set("accept", "application/json");
    compactHeaders.set("content-type", "application/json");
    const response = await originalFetch(compactUrl(url), {
      method: "POST",
      headers: compactHeaders,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      log("warn", "compact request failed", { status: response.status, body: await response.text() });
      return undefined;
    }
    const window = readCompactedWindow(await response.json());
    if (!window) log("warn", "compact response had no output items");
    return window;
  };

  const rewrite = async (sessionID: string, url: string, body: ResponsesBody, headers: Headers) => {
    const info = sessions.get(sessionID);
    if (!info || info.failed) return undefined;

    const endpoint = normalizeEndpoint(url);
    const plan = planRequest({
      body,
      state: await readState(sessionID),
      endpoint,
      contextLimit: info.contextLimit,
      threshold,
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

    const window = await compact(url, headers, {
      model: body.model,
      input: plan.compactInput,
      ...(plan.instructions ? { instructions: plan.instructions } : {}),
    });
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
      if (input.model.providerID !== "openai" || SKIPPED_AGENTS.has(input.agent)) return;
      const previous = sessions.get(input.sessionID);
      sessions.set(input.sessionID, {
        contextLimit: input.model.limit.context,
        model: input.model.id,
        failed: previous?.model === input.model.id ? previous.failed : false,
      });
      output.headers[SESSION_HEADER] = input.sessionID;
    },
    event: async ({ event }) => {
      if (event.type !== "session.deleted") return;
      const sessionID = event.properties.info.id;
      sessions.delete(sessionID);
      await discardState(sessionID);
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
