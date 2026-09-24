import { Plugin } from "@opencode/plugin";

// Configure the package in `opencode.json` like:
//
// {
//   "plugins": [
//     {
//       "package": "@jiafuei/opencode-anthropic-compaction",
//       "options": {
//         "threshold": "70%",
//         "additionalProviders": ["anthropic-proxy"],
//         "additionalModels": ["anthropic.claude-sonnet-4-6-v1:0"]
//       }
//     }
//   ]
// }

type CompactionOptions = {
  enabled?: boolean;
  threshold?: number | `${number}%`;
  additionalProviders?: string[];
  additionalModels?: string[];
  instructions?: string;
};

type Threshold = { ratio: number } | { tokens: number };

type Anchor = {
  // Last history message ID of the request that produced the compaction block.
  messageID: string;
  // Route provider identity the Anthropic protocol checks before replaying a compaction block.
  provider: string;
};

const SUPPORTED_MODELS = new Set([
  "claude-fable-5",
  "claude-mythos-5",
  "claude-mythos-preview",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
]);
const PACKAGES = new Set(["@opencode/ai/providers/anthropic", "@opencode/ai/providers/anthropic-compatible"]);
const MINIMUM_TRIGGER = 50_000;

async function readCompaction(body: ReadableStream<Uint8Array>): Promise<string | undefined> {
  const decoder = new TextDecoder();
  let buffered = "";
  let text: string | undefined;
  for await (const chunk of body) {
    buffered += decoder.decode(chunk, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const event = JSON.parse(line.slice(5));
      if (event.type === "content_block_start" && event.content_block.type === "compaction") {
        text = event.content_block.content ?? text;
      }
      if (event.type === "content_block_delta" && event.delta.type === "compaction_delta") {
        text = event.delta.content ?? text;
      }
    }
  }
  return text;
}

export default Plugin.define({
  id: "anthropic_compaction",
  setup: async (ctx) => {
    const config = ctx.options as CompactionOptions;
    if (config.enabled === false) return;

    const configuredThreshold = config.threshold ?? "70%";
    let threshold: Threshold;
    if (typeof configuredThreshold === "number") {
      threshold = configuredThreshold <= 1 ? { ratio: configuredThreshold } : { tokens: Math.floor(configuredThreshold) };
    } else {
      const match = /^(\d+(?:\.\d+)?)%$/.exec(configuredThreshold);
      threshold = { ratio: match ? Number(match[1]) / 100 : Number.NaN };
    }
    const value = "ratio" in threshold ? threshold.ratio : threshold.tokens;
    if (!Number.isFinite(value) || value <= 0 || ("ratio" in threshold && value > 1)) {
      throw new Error("Anthropic compaction threshold must be a positive token count or a percentage in (0%, 100%]");
    }
    if ("tokens" in threshold && threshold.tokens < MINIMUM_TRIGGER) {
      throw new Error("Anthropic compaction absolute threshold must be at least 50000 tokens");
    }

    const providers = new Set(["anthropic", ...(config.additionalProviders ?? [])]);
    const models = new Set([...SUPPORTED_MODELS, ...(config.additionalModels ?? [])]);
    // Core drops inline compaction blocks from the transcript, so the plugin keeps the latest block per
    // session and replays it. `pending` anchors the in-flight request whose response is being read.
    const pending = new Map<string, Anchor>();
    const compactions = new Map<string, Anchor & { text: string }>();

    await ctx.session.hook("context", async (event) => {
      pending.delete(event.sessionID);
      if (!providers.has(event.model.providerID)) return;
      const { data } = await ctx.model.list();
      const model = data.find((item) => item.providerID === event.model.providerID && item.id === event.model.id)!;
      if (!PACKAGES.has(model.package ?? "")) return;
      if (!models.has(model.id) && !models.has(model.modelID)) return;
      if ("ratio" in threshold && model.limit.context <= 0) return;

      const trigger =
        "ratio" in threshold
          ? Math.max(MINIMUM_TRIGGER, Math.floor(model.limit.context * threshold.ratio))
          : threshold.tokens;
      event.options.contextManagement = {
        edits: [
          {
            type: "compact_20260112",
            trigger: { type: "input_tokens", value: trigger },
            ...(config.instructions ? { instructions: config.instructions } : {}),
          },
        ],
      };

      const compaction = compactions.get(event.sessionID);
      const anchor = compaction ? event.messages.findIndex((message) => message.id === compaction.messageID) : -1;
      const target = anchor === -1 ? -1 : event.messages.findIndex((message, index) => index > anchor && message.role === "assistant");
      if (compaction && target === -1) compactions.delete(event.sessionID);
      if (compaction && target !== -1) {
        // Anthropic drops everything before the compaction block, so it leads the first response after the anchor.
        const message = event.messages[target]!;
        const Message = message.constructor as new (input: typeof message) => typeof message;
        event.messages[target] = new Message({
          ...message,
          content: [{ type: "compaction", provider: compaction.provider, text: compaction.text }, ...message.content],
        });
      }

      pending.set(event.sessionID, {
        messageID: event.messages.findLast((message) => message.id !== undefined)!.id!,
        provider: model.canonical ?? model.providerID,
      });
    });

    for (const providerID of providers) {
      await ctx.session.hook(
        "http.response",
        (event) => {
          const anchor = pending.get(event.sessionID);
          if (event.kind !== "primary" || !anchor || !event.response.body) return;
          pending.delete(event.sessionID);
          const [body, copy] = event.response.body.tee();
          event.response = new Response(body, event.response);
          // An interrupted stream also cancels the copy; the block is simply not recorded.
          void readCompaction(copy)
            .then((text) => {
              if (text) compactions.set(event.sessionID, { ...anchor, text });
            })
            .catch(() => {});
        },
        { providerID },
      );
    }

    void (async () => {
      for await (const event of ctx.event.subscribe()) {
        if (event.type !== "session.deleted") continue;
        pending.delete(event.data.sessionID);
        compactions.delete(event.data.sessionID);
      }
    })();
  },
});
