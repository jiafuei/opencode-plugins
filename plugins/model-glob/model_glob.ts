import { tool, type Plugin } from "@opencode-ai/plugin";

type ProviderList = {
  all: Array<{
    id: string;
    models: Record<string, {
      id: string;
      variants?: Record<string, unknown>;
    }>;
  }>;
  connected: string[];
};

const ModelGlobPlugin: Plugin = async ({ client, directory }) => ({
  tool: {
    model_glob: tool({
      description: "Search model IDs from connected providers using a case-insensitive substring and return each model's available variants. Use when user asks for a specific model for subagents or 'task' tool.",
      args: {
        text: tool.schema.string().min(1).describe("Case-insensitive substring to find in provider/model IDs."),
      },
      execute: async ({ text }) => {
        const response = await client.provider.list({ query: { directory } });
        if (!response.data) throw new Error("Failed to retrieve available models");

        const data = response.data as ProviderList;
        const connected = new Set(data.connected);
        const query = text.toLowerCase();
        const matches = data.all
          .filter((provider) => connected.has(provider.id))
          .flatMap((provider) =>
            Object.values(provider.models).map((model) => ({
              id: `${provider.id}/${model.id}`,
              variants: Object.keys(model.variants ?? {}),
            })),
          )
          .filter((model) => model.id.toLowerCase().includes(query))
          .sort((a, b) => a.id.localeCompare(b.id));

        return JSON.stringify(matches);
      },
    }),
  },
});

export default {
  id: "model_glob",
  server: ModelGlobPlugin,
};
