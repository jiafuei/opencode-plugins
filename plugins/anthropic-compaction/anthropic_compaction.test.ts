import { describe, expect, test } from "bun:test";
import plugin from "./anthropic_compaction.ts";

type Hook = (input: any, output: { options: Record<string, any> }) => Promise<void>;

async function setup(
  config: Record<string, unknown> = {},
  overrides: {
    providerID?: string;
    modelID?: string;
    apiID?: string;
    npm?: string;
    context?: number;
    agent?: string;
    initialOptions?: Record<string, any>;
  } = {},
) {
  const hooks = await plugin.server({} as never, config);
  const output = { options: overrides.initialOptions ?? {} };
  await (hooks["chat.params"] as Hook | undefined)?.(
    {
      sessionID: "ses_1",
      agent: overrides.agent ?? "build",
      model: {
        providerID: overrides.providerID ?? "anthropic",
        id: overrides.modelID ?? "claude-sonnet-4-6",
        api: {
          id: overrides.apiID ?? overrides.modelID ?? "claude-sonnet-4-6",
          npm: overrides.npm ?? "@ai-sdk/anthropic",
        },
        limit: { context: overrides.context ?? 200_000 },
      },
    } as never,
    output,
  );
  return output.options;
}

const compactionEdit = (options: Record<string, any>) => options.contextManagement?.edits.at(-1);

describe("configuration", () => {
  test("uses 70% of the context window by default", async () => {
    const options = await setup();
    expect(compactionEdit(options)).toMatchObject({
      type: "compact_20260112",
      trigger: { type: "input_tokens", value: 140_000 },
    });
    expect(compactionEdit(options)).not.toHaveProperty("instructions");
  });

  test("supports percentages, fractional thresholds, and absolute token counts", async () => {
    expect(compactionEdit(await setup({ threshold: "60%" })).trigger.value).toBe(120_000);
    expect(compactionEdit(await setup({ threshold: 0.5 })).trigger.value).toBe(100_000);
    expect(compactionEdit(await setup({ threshold: 80_000 }, { context: 0 })).trigger.value).toBe(80_000);
  });

  test("clamps relative thresholds to Anthropic's minimum", async () => {
    expect(compactionEdit(await setup({ threshold: "10%" }, { context: 100_000 })).trigger.value).toBe(50_000);
  });

  test("rejects invalid thresholds", async () => {
    for (const threshold of [0, -1, "0%", "101%", "70", 49_999] as const) {
      await expect(plugin.server({} as never, { threshold } as never)).rejects.toThrow("Anthropic compaction");
    }
  });

  test("uses custom instructions", async () => {
    const options = await setup({ instructions: "Preserve every identifier. Do not call tools." });
    expect(compactionEdit(options).instructions).toBe("Preserve every identifier. Do not call tools.");
  });

  test("can be disabled", async () => {
    expect(await plugin.server({} as never, { enabled: false })).toEqual({});
  });
});

describe("request gating", () => {
  test("enables documented Anthropic models", async () => {
    for (const modelID of [
      "claude-fable-5",
      "claude-mythos-5",
      "claude-mythos-preview",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-5",
      "claude-sonnet-4-6",
    ]) {
      expect(compactionEdit(await setup({}, { modelID }))?.type).toBe("compact_20260112");
    }
  });

  test("supports configured proxy providers and model aliases", async () => {
    const options = await setup(
      {
        additionalProviders: ["bedrock-proxy"],
        additionalModels: ["anthropic.claude-sonnet-4-6-v1:0"],
      },
      {
        providerID: "bedrock-proxy",
        modelID: "sonnet-alias",
        apiID: "anthropic.claude-sonnet-4-6-v1:0",
      },
    );
    expect(compactionEdit(options)?.type).toBe("compact_20260112");
  });

  test("leaves unconfigured providers, adapters, and models untouched", async () => {
    expect(await setup({}, { providerID: "proxy" })).toEqual({});
    expect(await setup({}, { npm: "@ai-sdk/amazon-bedrock" })).toEqual({});
    expect(await setup({}, { modelID: "claude-haiku-4-5" })).toEqual({});
  });

  test("skips internal agents and unresolved percentage thresholds", async () => {
    for (const agent of ["title", "summary", "compaction"]) {
      expect(await setup({}, { agent })).toEqual({});
    }
    expect(await setup({}, { context: 0 })).toEqual({});
  });
});

describe("Bedrock proxy requests", () => {
  test("adds Bedrock fields to compaction requests from marked providers", async () => {
    const requests: RequestInit[] = [];
    const providerOptions: Record<string, any> = {
      anthropicCompactionBedrock: true,
      fetch: async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        requests.push(init ?? {});
        return new Response();
      },
    };
    const hooks = await plugin.server({} as never, {});

    await hooks.config?.({ provider: { "bedrock-proxy": { options: providerOptions } } } as never);
    await providerOptions.fetch("https://proxy.example/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        anthropic_beta: ["another-beta"],
        context_management: { edits: [{ type: "compact_20260112" }] },
      }),
    });

    expect(providerOptions).not.toHaveProperty("anthropicCompactionBedrock");
    expect(JSON.parse(requests[0]!.body as string)).toMatchObject({
      anthropic_version: "bedrock-2023-05-31",
      anthropic_beta: ["another-beta", "compact-2026-01-12"],
      context_management: { edits: [{ type: "compact_20260112" }] },
    });
  });

  test("leaves unmarked providers and non-compaction bodies unchanged", async () => {
    const requests: RequestInit[] = [];
    const markedOptions: Record<string, any> = {
      anthropicCompactionBedrock: true,
      fetch: async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        requests.push(init ?? {});
        return new Response();
      },
    };
    const unmarkedFetch = async () => new Response();
    const unmarkedOptions = { fetch: unmarkedFetch };
    const hooks = await plugin.server({} as never, {});

    await hooks.config?.({
      provider: {
        marked: { options: markedOptions },
        unmarked: { options: unmarkedOptions },
      },
    } as never);
    const body = JSON.stringify({ messages: [] });
    await markedOptions.fetch("https://proxy.example/v1/messages", { method: "POST", body });

    expect(requests[0]!.body).toBe(body);
    expect(unmarkedOptions.fetch).toBe(unmarkedFetch);
  });
});

describe("context management composition", () => {
  test("preserves other edits and replaces an existing compaction edit", async () => {
    const options = await setup(
      { threshold: 75_000 },
      {
        initialOptions: {
          contextManagement: {
            edits: [
              { type: "clear_thinking_20251015", keep: "all" },
              { type: "compact_20260112", trigger: { type: "input_tokens", value: 60_000 } },
            ],
          },
        },
      },
    );
    expect(options.contextManagement.edits).toHaveLength(2);
    expect(options.contextManagement.edits[0]).toEqual({ type: "clear_thinking_20251015", keep: "all" });
    expect(options.contextManagement.edits[1].trigger.value).toBe(75_000);
  });
});
