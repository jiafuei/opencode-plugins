import { Plugin, type Tool } from "@opencode/plugin";
import { ToolResultCacheRpc } from "./rpc.ts";

const TTL = 5 * 60 * 1000;

export default Plugin.define({
  id: "tool-result-cache",
  async setup(ctx) {
    const allow = ((ctx.options.allow as string[] | undefined) ?? []).map((pattern) =>
      new RegExp(`^${pattern.replaceAll("\\", "/")
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replaceAll("*", ".*").replaceAll("?", ".")}$`, process.platform === "win32" ? "si" : "s"));
    type Permission = Pick<Parameters<typeof ctx.permission.assert>[0], "action" | "resources" | "metadata">;
    type Entry = { result: Tool.Result; expires: number; permissions: Permission[] };
    type Call = { cacheable: boolean; permissions: Permission[] };
    const sessions = new Map<string, Map<string, Entry>>();
    const calls = new Map<string, Set<Call>>();

    await ctx.permission.hook("evaluate", (event) => {
      const active = event.source && calls.get(event.source.id);
      if (!active) return;
      for (const call of active) {
        // Code Mode shares a call ID; overlapping permission checks cannot be attributed.
        if (active.size > 1 || event.effect !== "allow") call.cacheable = false;
        call.permissions.push({ action: event.action, resources: event.resources, metadata: event.metadata });
      }
    });

    await ctx.tool.transform((editor) => {
      for (const tool of editor.list()) {
        const name = tool.name.replace(/[^a-zA-Z0-9_-]/g, "_");
        const path = tool.options?.namespace ? `${tool.options.namespace}.${name}` : name;
        if (!allow.some((pattern) => pattern.test(tool.id) || pattern.test(path))) continue;
        editor.update(tool.id, (draft) => {
          const execute = draft.execute;
          draft.execute = async (input, context) => {
            let entries = sessions.get(context.sessionID);
            if (!entries) {
              entries = new Map();
              sessions.set(context.sessionID, entries);
            }
            const key = JSON.stringify([context.agent, tool.id, input], (_key, value) =>
              value !== null && typeof value === "object" && !Array.isArray(value)
                ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))
                : value);
            const cached = entries.get(key);
            if (cached && cached.expires > Date.now()) {
              // Tool executors own permission checks, so replay them on a cache hit.
              for (const permission of cached.permissions) {
                await ctx.permission.assert({
                  ...permission,
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.messageID, id: context.id },
                });
              }
              return structuredClone(cached.result);
            }
            entries.delete(key);
            const call: Call = { cacheable: true, permissions: [] };
            let active = calls.get(context.id);
            if (!active) {
              active = new Set();
              calls.set(context.id, active);
            }
            active.add(call);
            try {
              const result = await execute(input, context);
              if (call.cacheable && !context.signal.aborted) {
                entries.set(key, {
                  result: structuredClone(result),
                  expires: Date.now() + TTL,
                  permissions: call.permissions,
                });
              }
              return result;
            } finally {
              active.delete(call);
              if (active.size === 0) calls.delete(context.id);
            }
          };
        });
      }
    });

    await ctx.rpc.register(ToolResultCacheRpc, {
      clear: async ({ sessionID }) => {
        const entries = sessions.get(sessionID);
        const cleared = entries ? [...entries.values()].filter((entry) => entry.expires > Date.now()).length : 0;
        // In-flight calls retain their old bucket and cannot refill the cleared cache.
        sessions.delete(sessionID);
        return { cleared };
      },
    });

    const sweep = setInterval(() => {
      for (const entries of sessions.values()) {
        for (const [key, entry] of entries) {
          if (entry.expires <= Date.now()) entries.delete(key);
        }
      }
    }, 60_000);
    sweep.unref();
    const subscription = new AbortController();
    void (async () => {
      for await (const event of ctx.event.subscribe({ types: ["session.deleted"], signal: subscription.signal })) {
        sessions.delete(event.data.sessionID);
      }
    })();
    return () => {
      clearInterval(sweep);
      subscription.abort();
      sessions.clear();
      calls.clear();
    };
  },
});
