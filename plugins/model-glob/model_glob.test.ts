import { describe, expect, test } from "bun:test";
import modelGlob from "./model_glob.ts";

type ServerHooks = {
  tool: {
    model_glob: {
      execute: (args: { text: string }, context: unknown) => Promise<string>;
    };
  };
};

async function createHarness() {
  let request: unknown;
  const client = {
    provider: {
      list: async (input: unknown) => {
        request = input;
        return {
          data: {
            all: [
              {
                id: "openai",
                models: {
                  "gpt-5.6": { id: "gpt-5.6", variants: { low: {}, medium: {}, high: {} } },
                  "gpt-5.6-sol": { id: "gpt-5.6-sol", variants: { low: {}, high: {} } },
                },
              },
              {
                id: "anthropic",
                models: {
                  "claude-sonnet": { id: "claude-sonnet" },
                },
              },
              {
                id: "unavailable",
                models: {
                  "gpt-5.6-hidden": { id: "gpt-5.6-hidden", variants: { high: {} } },
                },
              },
            ],
            connected: ["openai", "anthropic"],
          },
        };
      },
    },
  };
  const server = modelGlob.server as unknown as (input: unknown) => Promise<ServerHooks>;
  const hooks = await server({ client, directory: "/tmp/model-glob-test" });

  return {
    search: async (text: string) => JSON.parse(await hooks.tool.model_glob.execute({ text }, {})) as Array<{ id: string; variants: string[] }>,
    request: () => request,
  };
}

describe("model_glob", () => {
  test("returns sorted matching models and their variants from connected providers", async () => {
    const harness = await createHarness();

    expect(await harness.search("5.6")).toEqual([
      { id: "openai/gpt-5.6", variants: ["low", "medium", "high"] },
      { id: "openai/gpt-5.6-sol", variants: ["low", "high"] },
    ]);
    expect(harness.request()).toEqual({ query: { directory: "/tmp/model-glob-test" } });
  });

  test("matches model IDs case-insensitively", async () => {
    const harness = await createHarness();

    expect(await harness.search("CLAUDE")).toEqual([
      { id: "anthropic/claude-sonnet", variants: [] },
    ]);
  });

  test("returns an empty array when no connected model matches", async () => {
    const harness = await createHarness();

    expect(await harness.search("missing")).toEqual([]);
  });
});
