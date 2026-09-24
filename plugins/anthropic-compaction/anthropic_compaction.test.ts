import { describe, expect, test } from "bun:test";
import plugin from "./anthropic_compaction.ts";

type Hook = (event: any) => Promise<void> | void;

class Message {
  constructor(input: Record<string, unknown>) {
    Object.assign(this, input);
  }
}

async function load(
  config: Record<string, unknown> = {},
  model: {
    providerID?: string;
    id?: string;
    modelID?: string;
    package?: string;
    context?: number;
  } = {},
) {
  const hooks = new Map<string, Hook>();
  const ctx = {
    options: config,
    model: {
      list: async () => ({
        data: [
          {
            providerID: model.providerID ?? "anthropic",
            id: model.id ?? "claude-sonnet-4-6",
            modelID: model.modelID ?? model.id ?? "claude-sonnet-4-6",
            package: model.package ?? "@opencode/ai/providers/anthropic",
            limit: { context: model.context ?? 200_000 },
          },
        ],
      }),
    },
    session: {
      hook: async (name: string, callback: Hook, options?: { providerID: string }) => {
        hooks.set(options ? `${name}:${options.providerID}` : name, callback);
      },
    },
    event: { subscribe: async function* () {} },
  };
  await plugin.setup(ctx as never);
  return hooks;
}

async function request(
  hooks: Map<string, Hook>,
  messages: Message[] = [new Message({ id: "msg_1", role: "user", content: [] })],
  model = { providerID: "anthropic", id: "claude-sonnet-4-6" },
) {
  const event = { sessionID: "ses_1", model, messages, options: {} as Record<string, any> };
  await hooks.get("context")?.(event);
  return event;
}

async function setup(config: Record<string, unknown> = {}, model: Parameters<typeof load>[1] = {}) {
  const hooks = await load(config, model);
  const event = await request(hooks, undefined, {
    providerID: model.providerID ?? "anthropic",
    id: model.id ?? "claude-sonnet-4-6",
  });
  return event.options;
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
      await expect(load({ threshold })).rejects.toThrow("Anthropic compaction");
    }
  });

  test("uses custom instructions", async () => {
    const options = await setup({ instructions: "Preserve every identifier. Do not call tools." });
    expect(compactionEdit(options).instructions).toBe("Preserve every identifier. Do not call tools.");
  });

  test("can be disabled", async () => {
    expect((await load({ enabled: false })).size).toBe(0);
  });
});

describe("request gating", () => {
  test("enables documented Anthropic models", async () => {
    for (const id of [
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
      expect(compactionEdit(await setup({}, { id }))?.type).toBe("compact_20260112");
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
        id: "sonnet-alias",
        modelID: "anthropic.claude-sonnet-4-6-v1:0",
        package: "@opencode/ai/providers/anthropic-compatible",
      },
    );
    expect(compactionEdit(options)?.type).toBe("compact_20260112");
  });

  test("leaves unconfigured providers, packages, and models untouched", async () => {
    expect(await setup({}, { providerID: "proxy" })).toEqual({});
    expect(await setup({}, { package: "@opencode/ai/providers/amazon-bedrock" })).toEqual({});
    expect(await setup({}, { id: "claude-haiku-4-5" })).toEqual({});
  });

  test("skips unresolved percentage thresholds", async () => {
    expect(await setup({}, { context: 0 })).toEqual({});
  });
});

describe("compaction decide", () => {
  test("defers OpenCode compaction to Anthropic once the trigger is reached", async () => {
    const hooks = await load();
    const decide = async (tokens: number, model = { providerID: "anthropic", id: "claude-sonnet-4-6" }) => {
      const event = { sessionID: "ses_1", agent: "build", model, tokens, action: "compact" };
      await hooks.get("experimental.compaction.decide:anthropic")!(event);
      return event.action;
    };
    expect(await decide(140_000)).toBe("continue");
    expect(await decide(139_999)).toBe("compact");
    expect(await decide(180_000, { providerID: "proxy", id: "claude-sonnet-4-6" })).toBe("compact");
  });
});

describe("compaction replay", () => {
  test("records a streamed compaction block and replays it on the following response", async () => {
    const hooks = await load();
    await request(hooks);

    const sse = [
      `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "compaction", content: null } })}`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "compaction_delta", content: "Summary." } })}`,
      `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
    ].join("\n\n");
    const response = { sessionID: "ses_1", kind: "primary", response: new Response(`${sse}\n\n`) };
    await hooks.get("http.response:anthropic")!(response);
    expect(await response.response.text()).toBe(`${sse}\n\n`);
    await Bun.sleep(0);

    const next = await request(hooks, [
      new Message({ id: "msg_0", role: "user", content: [] }),
      new Message({ id: "msg_1", role: "user", content: [] }),
      new Message({ id: "msg_2", role: "assistant", content: [{ type: "text", text: "Done." }] }),
      new Message({ id: "msg_3", role: "user", content: [] }),
    ]);
    expect(next.messages[2]).toBeInstanceOf(Message);
    expect((next.messages[2] as any).content).toEqual([
      { type: "compaction", provider: "anthropic", text: "Summary." },
      { type: "text", text: "Done." },
    ]);
  });
});
