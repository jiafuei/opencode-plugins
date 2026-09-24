import { describe, expect, test } from "bun:test";
import modelGlob from "./model_glob.ts";

type Execute = (input: { text: string }, context: unknown) => Promise<{ content: string }>;

async function createHarness() {
  let execute: Execute | undefined;
  const ctx = {
    model: {
      list: async () => ({
        data: [
          { providerID: "openai", id: "gpt-5.6", variants: [{ id: "low" }, { id: "medium" }, { id: "high" }] },
          { providerID: "openai", id: "gpt-5.6-sol", variants: [{ id: "low" }, { id: "high" }] },
          { providerID: "anthropic", id: "claude-sonnet", variants: [] },
        ],
      }),
    },
    tool: {
      transform: async (callback: (tools: { add: (tool: { execute: Execute }) => void }) => void) => {
        callback({ add: (tool) => (execute = tool.execute) });
      },
    },
  };
  await modelGlob.setup(ctx as never);

  return {
    search: async (text: string) => JSON.parse((await execute!({ text }, {})).content) as Array<{ id: string; variants: string[] }>,
  };
}

describe("model_glob", () => {
  test("returns sorted matching models and their variants", async () => {
    const harness = await createHarness();

    expect(await harness.search("5.6")).toEqual([
      { id: "openai/gpt-5.6", variants: ["low", "medium", "high"] },
      { id: "openai/gpt-5.6-sol", variants: ["low", "high"] },
    ]);
  });

  test("matches model IDs case-insensitively", async () => {
    const harness = await createHarness();

    expect(await harness.search("CLAUDE")).toEqual([
      { id: "anthropic/claude-sonnet", variants: [] },
    ]);
  });

  test("returns an empty array when no model matches", async () => {
    const harness = await createHarness();

    expect(await harness.search("missing")).toEqual([]);
  });
});
