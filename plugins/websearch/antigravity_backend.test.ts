import { describe, expect, test } from "bun:test";
import { createAntigravityBackend } from "./antigravity_backend.ts";

describe("Antigravity web search backend", () => {
  test("delegates to the Antigravity OAuth search bridge", async () => {
    const symbol = Symbol.for("@jiafuei/opencode-antigravity-oauth/web-search");
    const registry = globalThis as Record<symbol, unknown>;
    const previous = registry[symbol];
    const abort = new AbortController().signal;
    let call: { query: string; signal: AbortSignal } | undefined;
    registry[symbol] = {
      search: async (query: string, signal: AbortSignal) => {
        call = { query, signal };
        return { text: "Grounded answer", sources: [{ title: "Example", url: "https://example.com" }] };
      },
    };

    try {
      const result = await createAntigravityBackend().search({
        context: { abort } as any,
        model: "gemini-3.1-pro",
        query: "latest news",
      });

      expect(call).toEqual({ query: "latest news", signal: abort });
      expect(result).toEqual({ text: "Grounded answer", sources: [{ title: "Example", url: "https://example.com" }] });
    } finally {
      if (previous === undefined) delete registry[symbol];
      else registry[symbol] = previous;
    }
  });
});
