import type { ToolContext } from "@opencode-ai/plugin";

export type ProviderData = {
  id: string;
  models: Record<string, { api: { npm: string }; id: string; options: Record<string, unknown> }>;
};

export type SearchResult = {
  sources: Array<{ title?: string; url: string }>;
  text: string;
};

export type SearchBackend = {
  dispose(): void;
  id: string;
  matches(provider: ProviderData): boolean;
  search(input: { context: ToolContext; model: string; query: string }): Promise<SearchResult>;
};
