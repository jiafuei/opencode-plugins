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

type CompactionPlugin = (
  input: Parameters<Plugin>[0],
  options?: Parameters<Plugin>[1],
) => Promise<
  Awaited<ReturnType<Plugin>> & {
    "experimental.session.compaction.decide"?: (
      input: {
        sessionID: string;
        agent: string;
        model: { providerID: string; id: string };
        tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
      },
      output: { action: "compact" | "continue" },
    ) => Promise<void>;
  }
>;

type SessionInfo = {
  providerID: string;
  model: string;
  agent: string;
  messageID: string;
  trigger: number;
  variant?: string;
};

type SessionClient = {
  session: {
    prompt(input: {
      path: { id: string };
      query: { directory: string };
      body: {
        messageID: string;
        model: { providerID: string; modelID: string };
        agent: string;
        variant?: string;
        noReply: true;
        parts: Array<{ type: "text"; text: string; ignored: true }>;
      };
    }): Promise<{ data?: unknown; error?: unknown }>;
  };
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
const BEDROCK_OPTION = "anthropicCompactionBedrock";

function precedingMessageID(messageID: string): string | undefined {
  const match = /^msg_([0-9a-fA-F]{12})([0-9a-zA-Z]{14})$/.exec(messageID);
  if (!match) return undefined;
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const random = match[2]!.split("");
  for (let index = random.length - 1; index >= 0; index--) {
    const value = alphabet.indexOf(random[index]!);
    if (value <= 0) continue;
    random[index] = alphabet[value - 1]!;
    random.fill("z", index + 1);
    return `msg_${match[1]!.toLowerCase()}${random.join("")}`;
  }
  const value = BigInt(`0x${match[1]}`);
  if (value === 0n) return undefined;
  return `msg_${(value - 1n).toString(16).padStart(12, "0")}${"z".repeat(14)}`;
}

const AnthropicCompactionPlugin: CompactionPlugin = async ({ client, directory }, options) => {
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
  const sessionClient = client as unknown as SessionClient;
  const sessions = new Map<string, SessionInfo>();
  const shownParts = new Map<string, Set<string>>();

  const showCompactionIndicators = async (sessionID: string, info: SessionInfo) => {
    void client.tui
      .showToast({
        body: {
          title: "Context compaction",
          message: "Compacting context...",
          variant: "info",
          duration: 5_000,
        },
      })
      .catch(() => {});

    const messageID = precedingMessageID(info.messageID);
    if (!messageID) return;
    const result = await sessionClient.session.prompt({
      path: { id: sessionID },
      query: { directory },
      body: {
        messageID,
        model: { providerID: info.providerID, modelID: info.model },
        agent: info.agent,
        ...(info.variant ? { variant: info.variant } : {}),
        noReply: true,
        parts: [{ type: "text", text: "Compacting context...", ignored: true }],
      },
    });
    if (result.error) throw result.error;
  };

  return {
    config: async (opencodeConfig) => {
      for (const provider of Object.values(opencodeConfig.provider ?? {})) {
        const providerOptions = provider.options;
        if (providerOptions?.[BEDROCK_OPTION] !== true) continue;

        const providerFetch = typeof providerOptions.fetch === "function" ? providerOptions.fetch : undefined;
        delete providerOptions[BEDROCK_OPTION];
        providerOptions.fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          if (typeof init?.body !== "string") return (providerFetch ?? fetch)(input, init);

          const body = JSON.parse(init.body);
          if (!body.context_management) return (providerFetch ?? fetch)(input, init);

          body.anthropic_version ??= "bedrock-2023-05-31";
          body.anthropic_beta = [...new Set([...(body.anthropic_beta ?? []), "compact-2026-01-12"])] as string[];
          return (providerFetch ?? fetch)(input, { ...init, body: JSON.stringify(body) });
        };
      }
    },
    "chat.params": async (input, output) => {
      if (SKIPPED_AGENTS.has(input.agent)) return;
      sessions.delete(input.sessionID);
      if (!providers.has(input.model.providerID)) return;
      if (input.model.api.npm !== "@ai-sdk/anthropic") return;
      if (!models.has(input.model.id) && !models.has(input.model.api.id)) return;

      if ("ratio" in threshold && input.model.limit.context <= 0) return;
      const trigger =
        "ratio" in threshold
          ? Math.max(MINIMUM_TRIGGER, Math.floor(input.model.limit.context * threshold.ratio))
          : threshold.tokens;
      sessions.set(input.sessionID, {
        providerID: input.model.providerID,
        model: input.model.id,
        agent: input.agent,
        messageID: input.message.id,
        trigger,
        variant: (input.message.model as typeof input.message.model & { variant?: string }).variant,
      });
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
    "experimental.session.compaction.decide": async (input, output) => {
      const info = sessions.get(input.sessionID);
      if (
        !info ||
        info.providerID !== input.model.providerID ||
        info.model !== input.model.id ||
        info.agent !== input.agent
      ) {
        return;
      }
      const tokens =
        input.tokens.input +
        input.tokens.output +
        input.tokens.reasoning +
        input.tokens.cache.read +
        input.tokens.cache.write;
      if (tokens < info.trigger) return;
      output.action = "continue";
    },
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const sessionID = event.properties.info.id;
        sessions.delete(sessionID);
        shownParts.delete(sessionID);
        return;
      }
      if (event.type !== "message.part.updated") return;
      const part = event.properties.part;
      if (part.type !== "text") return;
      const metadata = part.metadata?.anthropic as { type?: string } | undefined;
      if (metadata?.type !== "compaction") return;
      const info = sessions.get(part.sessionID);
      if (!info) return;
      const shown = shownParts.get(part.sessionID) ?? new Set<string>();
      if (shown.has(part.id)) return;
      shown.add(part.id);
      shownParts.set(part.sessionID, shown);
      await showCompactionIndicators(part.sessionID, info).catch(() => {});
    },
  };
};

export default {
  id: "anthropic_compaction",
  server: AnthropicCompactionPlugin,
};
