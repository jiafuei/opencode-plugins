import { Plugin } from "@opencode/plugin";

// Opt providers in, and enable native compaction on them, in `opencode.json`:
//
// {
//   "plugins": [
//     {
//       "package": "@jiafuei/opencode-anthropic-compaction",
//       "options": {
//         "providers": {
//           "anthropic": { "mechanism": "threshold" },
//           "my-bedrock-proxy": { "aws": true, "models": { "claude-opus-4-6": "threshold" } }
//         }
//       }
//     }
//   ],
//   "providers": {
//     "anthropic": { "settings": { "compaction": { "type": "native" } } }
//   }
// }

type Mechanism = "on-demand" | "threshold";

type ProviderOptions = {
  // Used for models that neither `models` nor the on-demand default covers.
  mechanism?: Mechanism;
  models?: Record<string, Mechanism>;
  // The provider forwards the body to Bedrock InvokeModel, which reads betas from the body, not the header.
  aws?: boolean;
};

type CompactionOptions = {
  providers?: Record<string, ProviderOptions>;
  instructions?: string;
};

type CompactionPart = { type: "compaction"; text?: string | null };
type ContentPart = { type: string } | CompactionPart;

// The published plugin types predate this hook, so it is typed here.
type NativeCompaction = {
  model: { id: string };
  send: (input: { options: Record<string, unknown> }) => Promise<{ content: ReadonlyArray<ContentPart> }>;
  result?: { replacement: ReadonlyArray<unknown> };
};

// Anthropic's lowest threshold trigger, so a threshold request always compacts once input reaches it.
const MINIMUM_TRIGGER = 50_000;
// Threshold compaction ignores everything before its block, but the conversation must still open with a user message.
const OPENING = {
  role: "user",
  content: [
    { type: "text", text: "<synthetic_user_message>The conversation so far was compacted.</synthetic_user_message>" },
  ],
};

// Claude models with on-demand compaction: Haiku, Sonnet, and Opus from 5.5, Fable and Mythos from 5. Matches
// Anthropic, Bedrock, and proxy IDs such as `claude-opus-5-5`, `us.anthropic.claude-sonnet-5-5-v1`, or `opus-5.5`,
// without reading a date suffix (`claude-opus-4-20250514`) as a minor version.
function onDemandByDefault(modelID: string) {
  const match = modelID.match(/(haiku|sonnet|opus|fable|mythos)-(\d+)(?:[-.](\d{1,2}))?(?!\d)/);
  if (!match) return false;
  const version = Number(match[2]) * 100 + Number(match[3] ?? 0);
  return version >= (match[1] === "fable" || match[1] === "mythos" ? 500 : 505);
}

export default Plugin.define({
  id: "anthropic_compaction",
  setup: async (ctx) => {
    const { providers = {}, instructions } = ctx.options as CompactionOptions;

    for (const [providerID, { mechanism: fallback, models = {}, aws }] of Object.entries(providers)) {
      await (ctx.session.hook as any)(
        "experimental.compaction.native",
        async (event: NativeCompaction) => {
          const modelID = event.model.id;
          const mechanism = models[modelID] ?? (onDemandByDefault(modelID) ? "on-demand" : fallback);
          if (mechanism !== "on-demand" && mechanism !== "threshold") {
            throw new Error(
              `anthropic_compaction: set "on-demand" or "threshold" for ${providerID}/${modelID} in the provider's "mechanism" or "models"`,
            );
          }
          const options =
            mechanism === "on-demand"
              ? { compaction: { type: "summarize", ...(instructions ? { instructions } : {}) } }
              : {
                  contextManagement: {
                    edits: [
                      {
                        type: "compact_20260112",
                        trigger: { type: "input_tokens", value: MINIMUM_TRIGGER },
                        pauseAfterCompaction: true,
                        ...(instructions ? { instructions } : {}),
                      },
                    ],
                  },
                };
          const { content } = await event.send({ options });
          const compaction = content.find((part): part is CompactionPart => part.type === "compaction");
          if (!compaction) {
            throw new Error(
              mechanism === "threshold"
                ? `Anthropic did not compact: threshold compaction only runs once input reaches ${MINIMUM_TRIGGER} tokens`
                : "Anthropic did not return a compaction block",
            );
          }
          // A null summary means Anthropic failed to compact, and installing it would drop the whole history.
          if (!compaction.text) throw new Error("Anthropic failed to produce a compaction summary");
          // An on-demand block must come first in the conversation, in place of the messages it summarizes.
          const checkpoint = { role: "assistant", content: [compaction] };
          event.result = { replacement: mechanism === "on-demand" ? [checkpoint] : [OPENING, checkpoint] };
        },
        { providerID },
      );

      if (aws) {
        await ctx.session.hook(
          "http.request",
          async (event) => {
            const request = event.request;
            const body = await request.json();
            const betas = request.headers.get("anthropic-beta")?.split(",") ?? [];
            event.request = new Request(request.url, {
              method: request.method,
              headers: request.headers,
              signal: request.signal,
              body: JSON.stringify({
                ...body,
                anthropic_version: "bedrock-2023-05-31",
                anthropic_beta: [...new Set([...(body.anthropic_beta ?? []), ...betas])],
              }),
            });
          },
          { providerID },
        );
      }
    }
  },
});
