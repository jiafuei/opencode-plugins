import { Plugin } from "@opencode/plugin";

// Opt providers in, and enable native compaction on them, in `opencode.json`:
//
// {
//   "plugins": [
//     { "package": "@jiafuei/opencode-anthropic-compaction", "options": { "providers": ["anthropic"] } }
//   ],
//   "providers": {
//     "anthropic": { "settings": { "compaction": { "type": "native" } } }
//   }
// }

type CompactionOptions = {
  providers?: string[];
  instructions?: string;
};

type ContentPart = { type: string };

// The published plugin types predate this hook, so it is typed here.
type NativeCompaction = {
  send: (input: { options: Record<string, unknown> }) => Promise<{ content: ReadonlyArray<ContentPart> }>;
  result?: { replacement: ReadonlyArray<unknown> };
};

// Anthropic's lowest trigger, so a compaction request always compacts once input reaches it.
const MINIMUM_TRIGGER = 50_000;
// Anthropic ignores everything before the compaction block, but the conversation must still open with a user message.
const OPENING = {
  role: "user",
  content: [
    { type: "text", text: "<synthetic_user_message>The conversation so far was compacted.</synthetic_user_message>" },
  ],
};

export default Plugin.define({
  id: "anthropic_compaction",
  setup: async (ctx) => {
    const { providers = [], instructions } = ctx.options as CompactionOptions;

    for (const providerID of providers) {
      await (ctx.session.hook as any)(
        "experimental.compaction.native",
        async (event: NativeCompaction) => {
          const { content } = await event.send({
            options: {
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
            },
          });
          const compaction = content.find((part) => part.type === "compaction");
          if (!compaction) {
            throw new Error(`Anthropic did not compact: it only compacts once input reaches ${MINIMUM_TRIGGER} tokens`);
          }
          event.result = { replacement: [OPENING, { role: "assistant", content: [compaction] }] };
        },
        { providerID },
      );
    }
  },
});
