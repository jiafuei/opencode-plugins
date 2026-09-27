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

function compaction(content: unknown[]) {
  const sent: Record<string, any>[] = [];
  const event = {
    send: async (input: { options: Record<string, any> }) => {
      sent.push(input.options);
      return { content };
    },
    result: undefined as { replacement: unknown[] } | undefined,
  };
  return { event, sent };
}

describe("native compaction", () => {
  test("registers only for opted-in providers", async () => {
    expect(await load({})).toEqual([]);
    const hooks = await load({ providers: ["anthropic", "my-proxy"] });
    expect(hooks.map((hook) => [hook.name, hook.options])).toEqual([
      ["experimental.compaction.native", { providerID: "anthropic" }],
      ["experimental.compaction.native", { providerID: "my-proxy" }],
    ]);
  });

  test("installs Anthropic's compaction block after a synthetic user message", async () => {
    const [hook] = await load({ providers: ["anthropic"], instructions: "Keep file paths." });
    const block = { type: "compaction", provider: "anthropic", text: "Summary." };
    const { event, sent } = compaction([block]);
    await hook!.callback(event);
    expect(sent).toEqual([
      {
        contextManagement: {
          edits: [
            {
              type: "compact_20260112",
              trigger: { type: "input_tokens", value: 50_000 },
              pauseAfterCompaction: true,
              instructions: "Keep file paths.",
            },
          ],
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

  test("fails when Anthropic returns no compaction block", async () => {
    const [hook] = await load({ providers: ["anthropic"] });
    await expect(hook!.callback(compaction([{ type: "text", text: "Hi" }]).event)).rejects.toThrow("50000 tokens");
  });
});
