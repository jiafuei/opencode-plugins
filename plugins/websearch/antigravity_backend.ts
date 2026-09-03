import type { SearchBackend } from "./backend.ts";

const WEB_SEARCH_SYMBOL = Symbol.for("@jiafuei/opencode-antigravity-oauth/web-search");

type WebSearchBridge = {
  search(query: string, signal: AbortSignal): ReturnType<SearchBackend["search"]>;
};

export function createAntigravityBackend(): SearchBackend {
  return {
    id: "antigravity",
    matches: (provider) => Object.values(provider.models).some((model) => model.api.npm === "@ai-sdk/google"),
    dispose() {},
    async search({ context, query }) {
      const bridge = (globalThis as Record<symbol, unknown>)[WEB_SEARCH_SYMBOL] as WebSearchBridge | undefined;
      if (!bridge) throw new Error("Connect Google Antigravity with @jiafuei/opencode-antigravity-oauth before using websearch");
      return bridge.search(query, context.abort);
    },
  };
}
