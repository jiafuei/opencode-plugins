import { describe, expect, test } from "bun:test";
import plugin from "./server.ts";

type Hook = (event: any) => Promise<void>;

async function load(options: Record<string, unknown>) {
  const hooks: { name: string; callback: Hook; options: { providerID: string } }[] = [];
  const ctx = {
    options,
    session: {
      hook: async (name: string, callback: Hook, options: { providerID: string }) => {
        hooks.push({ name, callback, options });
      },
    },
  };
  await plugin.setup(ctx as never);
  return hooks;
}

function compaction(content: unknown[], modelID = "claude-opus-4-6") {
  const sent: Record<string, any>[] = [];
  const event = {
    model: { id: modelID },
    send: async (input: { options: Record<string, any> }) => {
      sent.push(input.options);
      return { content };
    },
    result: undefined as { replacement: unknown[] } | undefined,
  };
  return { event, sent };
}

const block = { type: "compaction", provider: "anthropic", text: "Summary." };

describe("native compaction", () => {
  test("registers per provider, with the AWS body rewrite only where asked", async () => {
    expect(await load({})).toEqual([]);
    const hooks = await load({
      providers: { anthropic: { mechanism: "on-demand" }, "my-proxy": { mechanism: "threshold", aws: true } },
    });
    expect(hooks.map((hook) => [hook.name, hook.options.providerID])).toEqual([
      ["experimental.compaction.native", "anthropic"],
      ["experimental.compaction.native", "my-proxy"],
      ["http.request", "my-proxy"],
    ]);
  });

  test("picks the mechanism from models, then the on-demand default, then the provider", async () => {
    const [hook] = await load({
      providers: { anthropic: { mechanism: "threshold", models: { "claude-opus-5-5": "threshold" } } },
    });
    const sent = async (modelID: string) => {
      const run = compaction([block], modelID);
      await hook!.callback(run.event);
      return Object.keys(run.sent[0]!)[0];
    };
    expect(await sent("claude-opus-5-5")).toBe("contextManagement");
    expect(await sent("us.anthropic.claude-sonnet-5-5-v1")).toBe("compaction");
    expect(await sent("claude-fable-5")).toBe("compaction");
    expect(await sent("claude-opus-4-20250514")).toBe("contextManagement");
    expect(await sent("claude-sonnet-5")).toBe("contextManagement");

    const [unset] = await load({ providers: { anthropic: {} } });
    await expect(unset!.callback(compaction([block]).event)).rejects.toThrow("anthropic/claude-opus-4-6");
  });

  test("on-demand installs the signed block first in the conversation", async () => {
    const [hook] = await load({ providers: { anthropic: { mechanism: "on-demand" } }, instructions: "Keep paths." });
    const { event, sent } = compaction([block]);
    await hook!.callback(event);
    expect(sent).toEqual([{ compaction: { type: "summarize", instructions: "Keep paths." } }]);
    expect(event.result?.replacement).toEqual([{ role: "assistant", content: [block] }]);
  });

  test("threshold installs the block after a synthetic user message", async () => {
    const [hook] = await load({ providers: { anthropic: { mechanism: "threshold" } } });
    const { event, sent } = compaction([block]);
    await hook!.callback(event);
    expect(sent).toEqual([
      {
        contextManagement: {
          edits: [{ type: "compact_20260112", trigger: { type: "input_tokens", value: 50_000 }, pauseAfterCompaction: true }],
        },
      },
    ]);
    expect(event.result?.replacement).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "<synthetic_user_message>The conversation so far was compacted.</synthetic_user_message>" },
        ],
      },
      { role: "assistant", content: [block] },
    ]);
  });

  test("fails instead of installing a missing or null summary", async () => {
    const [hook] = await load({ providers: { anthropic: { mechanism: "threshold" } } });
    await expect(hook!.callback(compaction([{ type: "text", text: "Hi" }]).event)).rejects.toThrow("50000 tokens");
    const { event } = compaction([{ ...block, text: null }]);
    await expect(hook!.callback(event)).rejects.toThrow("failed to produce");
    expect(event.result).toBeUndefined();
  });

  test("AWS providers carry the beta header into the body", async () => {
    const hooks = await load({ providers: { proxy: { mechanism: "on-demand", aws: true } } });
    const http = hooks.find((hook) => hook.name === "http.request")!;
    const event = {
      request: new Request("https://proxy.example/v1/messages", {
        method: "POST",
        headers: { "anthropic-beta": "interleaved-thinking-2025-05-14,compact-2026-09-04" },
        body: JSON.stringify({ messages: [], anthropic_beta: ["existing"] }),
      }),
    };
    await http.callback(event);
    expect(await event.request.json()).toEqual({
      messages: [],
      anthropic_version: "bedrock-2023-05-31",
      anthropic_beta: ["existing", "interleaved-thinking-2025-05-14", "compact-2026-09-04"],
    });
  });
});
