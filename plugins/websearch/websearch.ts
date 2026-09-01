import { tool, type Plugin, type PluginOptions } from "@opencode-ai/plugin";
import { createAntigravityBackend } from "./antigravity_backend.ts";
import type { ProviderData, SearchBackend, SearchResult } from "./backend.ts";
import { createOpenAIBackend, type OpenAISubscriptionTransport } from "./openai_backend.ts";

type ActiveModel = { modelID: string; providerID: string };
interface WebSearchOptions extends PluginOptions {
  openaiSubscriptionTransport?: OpenAISubscriptionTransport;
}
type Resolution = {
  backend: SearchBackend;
  fallbackModel?: string;
  lockedModel?: string;
  providerID: string;
};

function scanProviders(providers: ProviderData[], backends: SearchBackend[]): Resolution[] {
  return providers.flatMap((provider) => {
    const backend = backends.find((candidate) => candidate.matches(provider));
    if (!backend) return [];

    let lockedModel: string | undefined;
    let fallbackModel: string | undefined;
    for (const model of Object.values(provider.models)) {
      if (!lockedModel && model.options.websearch === "always") lockedModel = model.id;
      if (!fallbackModel && model.options.websearch === "auto") fallbackModel = model.id;
    }
    return [{ backend, fallbackModel, lockedModel, providerID: provider.id }];
  });
}

export function pickResolution(resolutions: Resolution[], active: ActiveModel | undefined) {
  const locked = resolutions.find((resolution) => resolution.lockedModel);
  if (locked?.lockedModel) return { backend: locked.backend, model: locked.lockedModel };

  const current = active && resolutions.find((resolution) => resolution.providerID === active.providerID);
  if (current && active) return { backend: current.backend, model: active.modelID };

  const fallback = resolutions.find((resolution) => resolution.fallbackModel);
  return fallback?.fallbackModel ? { backend: fallback.backend, model: fallback.fallbackModel } : undefined;
}

function formatResult(result: SearchResult) {
  const seen = new Set<string>();
  const links = result.sources.flatMap((source) => {
    if (seen.has(source.url)) return [];
    seen.add(source.url);
    return [`- [${source.title ?? source.url}](${source.url})`];
  });
  return links.length ? `${result.text.trim()}\n\nSources:\n${links.join("\n")}` : result.text.trim();
}

const WebSearchPlugin: Plugin = async ({ client, directory }, options?: PluginOptions | WebSearchOptions) => {
  const pluginOptions = options as WebSearchOptions | undefined;
  if (
    pluginOptions?.openaiSubscriptionTransport !== undefined &&
    pluginOptions.openaiSubscriptionTransport !== "https" &&
    pluginOptions.openaiSubscriptionTransport !== "websocket"
  ) {
    throw new Error(`Unsupported OpenAI subscription transport "${String(pluginOptions.openaiSubscriptionTransport)}"`);
  }
  const backends: SearchBackend[] = [
    createOpenAIBackend(client, directory, pluginOptions?.openaiSubscriptionTransport),
    createAntigravityBackend(),
  ];
  const log = (level: "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) =>
    client.app.log({ body: { service: "websearch", level, message, extra }, query: { directory } }).catch(() => {});
  const activeModels = new Map<string, ActiveModel>();
  let resolutions: Resolution[] | undefined;

  log("info", "Plugin initialized; web-search tool registered", {
    backends: backends.map((backend) => backend.id),
    openaiSubscriptionTransport: pluginOptions?.openaiSubscriptionTransport ?? "https",
  });

  return {
    dispose: async () => {
      for (const backend of backends) backend.dispose();
    },
    "chat.message": async (input) => {
      if (input.model) activeModels.set(input.sessionID, input.model);
    },
    tool: {
      "web-search": tool({
        description: "Search the live web with a provider-native search model and return grounded content with sources. Use for current information and topics beyond the model's knowledge cutoff.",
        args: {
          query: tool.schema.string().describe("The web search query."),
        },
        execute: async ({ query }, context) => {
          await context.ask({ permission: "websearch", patterns: [query], always: ["*"], metadata: { query } });
          context.metadata({ title: `Web Search: ${query}` });

          if (!resolutions) {
            const response = await client.config.providers({ query: { directory } });
            if (!response.data) throw new Error("Failed to retrieve search models");
            resolutions = scanProviders(response.data.providers as ProviderData[], backends);
            log("info", "Search backends resolved", {
              resolutions: resolutions.map(({ backend, fallbackModel, lockedModel, providerID }) => ({
                backend: backend.id,
                fallbackModel,
                lockedModel,
                providerID,
              })),
            });
          }
          const selected = pickResolution(resolutions, activeModels.get(context.sessionID));
          if (!selected) {
            log("warn", "No search backend selected", { activeModel: activeModels.get(context.sessionID) });
            throw new Error('Choose a supported model for web search with `"websearch": "always"` or `"websearch": "auto"`');
          }

          log("info", "Search started", { backend: selected.backend.id, model: selected.model });
          try {
            const result = await selected.backend.search({ context, model: selected.model, query });
            log("info", "Search completed", { backend: selected.backend.id, sources: result.sources.length });
            return formatResult(result);
          } catch (error) {
            log("error", "Search failed", {
              backend: selected.backend.id,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
      }),
    },
  };
};

export default {
  id: "websearch",
  server: WebSearchPlugin,
};
