import type { Plugin } from "@opencode-ai/plugin";

// Configure the package in `opencode.json` like:
//
// {
//   "plugin": [
//     ["@jiafuei/opencode-anthropic-compaction", {
//       "threshold": "70%",
//       "additionalProviders": ["anthropic-proxy"],
//       "additionalModels": ["anthropic.claude-sonnet-4-6-v1:0"]
//     }]
//   ]
// }

type CompactionOptions = {
  enabled?: boolean;
  threshold?: number | `${number}%`;
  additionalProviders?: string[];
  additionalModels?: string[];
  instructions?: string;
};

type ContextManagement = {
  edits?: Array<{ type: string }>;
};

type Threshold = { ratio: number } | { tokens: number };

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
const SKIPPED_AGENTS = new Set(["title", "summary", "compaction"]);
const MINIMUM_TRIGGER = 50_000;

const AnthropicCompactionPlugin: Plugin = async (_input, options) => {
  const config = (options ?? {}) as CompactionOptions;
  if (config.enabled === false) return {};

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

  return {
    "chat.params": async (input, output) => {
      if (!providers.has(input.model.providerID) || SKIPPED_AGENTS.has(input.agent)) return;
      if (input.model.api.npm !== "@ai-sdk/anthropic") return;
      if (!models.has(input.model.id) && !models.has(input.model.api.id)) return;

      if ("ratio" in threshold && input.model.limit.context <= 0) return;
      const trigger =
        "ratio" in threshold
          ? Math.max(MINIMUM_TRIGGER, Math.floor(input.model.limit.context * threshold.ratio))
          : threshold.tokens;
      const current = output.options.contextManagement as ContextManagement | undefined;
      const edits = current?.edits ?? [];
      output.options.contextManagement = {
        ...current,
        edits: [
          ...edits.filter((edit) => edit.type !== "compact_20260112"),
          {
            type: "compact_20260112",
            trigger: { type: "input_tokens", value: trigger },
            ...(config.instructions ? { instructions: config.instructions } : {}),
          },
        ],
      };
    },
  };
};

export default {
  id: "anthropic_compaction",
  server: AnthropicCompactionPlugin,
};
