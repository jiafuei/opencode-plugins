import { tool, type Plugin } from "@opencode-ai/plugin";
import type { ProviderData, SearchBackend, SearchResult } from "./backend.ts";
import { createOpenAIBackend } from "./openai_backend.ts";

type ActiveModel = { modelID: string; providerID: string };
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

const WebSearchPlugin: Plugin = async ({ client, directory }) => {
  const backends: SearchBackend[] = [createOpenAIBackend(client, directory)];
  const activeModels = new Map<string, ActiveModel>();
  let resolutions: Resolution[] | undefined;

  return {
    dispose: async () => {
      for (const backend of backends) backend.dispose();
    },
    "chat.message": async (input) => {
      if (input.model) activeModels.set(input.sessionID, input.model);
    },
    tool: {
      websearch: tool({
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
          }
          const selected = pickResolution(resolutions, activeModels.get(context.sessionID));
          if (!selected) throw new Error('Choose a supported model for web search with `"websearch": "always"` or `"websearch": "auto"`');

          return formatResult(await selected.backend.search({ context, model: selected.model, query }));
        },
      }),
    },
  };
};

export default {
  id: "websearch",
  server: WebSearchPlugin,
};
