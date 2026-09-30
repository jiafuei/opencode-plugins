import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import { createOpenAI, type OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { Plugin } from "@opencode/plugin";
import { streamText } from "ai";
import { createWebSocketFetch } from "./websocket_fetch.ts";

type SearchType = "openai" | "google" | "anthropic";

interface SearchEntry {
  type: SearchType;
  model?: string;
  transport?: "https" | "websocket";
}

interface WebSearchOptions {
  providers?: Record<string, Partial<SearchEntry>>;
}

// Keyed by opencode provider ID; user entries merge over these.
const DEFAULT_ENTRIES: Record<string, SearchEntry> = {
  openai: { type: "openai" },
  google: { type: "google" },
  anthropic: { type: "anthropic" },
};

const DEFAULT_MODELS: Record<SearchType, string> = {
  openai: "gpt-6-luna",
  google: "gemini-3.8-flash",
  anthropic: "claude-opus-5-5",
};

const CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex";

function residency(accessToken: string): string | undefined {
  const claims = JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString());
  const value = claims["https://api.openai.com/auth"]?.chatgpt_compute_residency ?? claims.chatgpt_compute_residency;
  return value === "no_constraint" ? undefined : value;
}

export default Plugin.define({
  id: "websearch",
  setup: async (ctx) => {
    const options = ctx.options as WebSearchOptions;
    const ids = new Set([...Object.keys(DEFAULT_ENTRIES), ...Object.keys(options.providers ?? {})]);
    const entries = new Map(
      [...ids].map((id) => [id, { ...DEFAULT_ENTRIES[id], ...options.providers?.[id] } as SearchEntry]),
    );
    for (const [id, entry] of entries) if (!entry.type) throw new Error(`websearch provider "${id}" needs a type: openai, google, or anthropic`);
    const websocketFetches = new Map(
      [...entries].filter(([, entry]) => entry.transport === "websocket").map(([id]) => [id, createWebSocketFetch()]),
    );
    // Search providers whose opencode provider is currently available, keyed by ID with display names.
    let available = new Map<string, string>();

    await ctx.websearch.transform((editor) => {
      for (const [id, name] of available) {
        const entry = entries.get(id)!;
        const modelID = entry.model ?? DEFAULT_MODELS[entry.type];
        editor.add({
          id,
          name,
          execute: async ({ query }, { signal }) => {
            const { data: provider } = await ctx.provider.get({ providerID: id });
            const connection = await ctx.integration.connection.active(provider.integrationID ?? id);
            const auth = connection && (await ctx.integration.connection.resolve(connection));
            // Missing keys fall through to each SDK's env lookup, which throws when that is empty too.
            const settings = {
              apiKey: auth?.type === "key" ? auth.key : provider.settings?.apiKey,
              baseURL: provider.settings?.baseURL,
              headers: provider.headers,
            };
            const request = (() => {
              if (entry.type === "openai") {
                // ChatGPT subscriptions (OAuth) go through the Codex backend; API keys use the provider's endpoint.
                const openai =
                  auth?.type === "oauth"
                    ? createOpenAI({
                        apiKey: auth.access,
                        baseURL: CHATGPT_BASE_URL,
                        fetch: websocketFetches.get(id),
                        // ai-sdk drops undefined header values.
                        headers: {
                          "ChatGPT-Account-Id": auth.metadata?.accountID,
                          "x-openai-internal-codex-residency": residency(auth.access),
                        } as Record<string, string>,
                      })
                    : createOpenAI(settings);
                return {
                  model: openai.responses(modelID),
                  providerOptions: {
                    openai: { reasoningEffort: "low", store: false } satisfies OpenAIResponsesProviderOptions,
                  },
                  toolChoice: { type: "tool", toolName: "web_search" } as const,
                  tools: { web_search: openai.tools.webSearch() },
                };
              }
              // Gemini and current Claude models reject forced tool use, so the prompt asks them to search.
              if (entry.type === "google") {
                const google = createGoogleGenerativeAI(settings);
                return {
                  model: google(modelID),
                  providerOptions: {
                    google: { thinkingConfig: { thinkingLevel: "low" } } satisfies GoogleLanguageModelOptions,
                  },
                  tools: { google_search: google.tools.googleSearch({}) },
                };
              }
              const anthropic = createAnthropic(settings);
              return {
                model: anthropic(modelID),
                maxOutputTokens: 64000,
                providerOptions: { anthropic: { effort: "low" } satisfies AnthropicLanguageModelOptions },
                tools: { web_search: anthropic.tools.webSearch_20260209() },
              };
            })();
            const result = streamText({
              ...request,
              abortSignal: signal,
              maxRetries: 0,
              prompt: `Search the live web for this query and return a concise, factual answer grounded in the retrieved content. Include useful details and cite sources.\n\n${query}`,
            });
            const [text, sources, toolResults] = await Promise.all([result.text, result.sources, result.toolResults]);
            const found = new Map<string, string | undefined>();
            for (const source of sources) if (source.sourceType === "url" && !found.has(source.url)) found.set(source.url, source.title);
            // OpenAI lists consulted-but-uncited pages only in the tool output.
            for (const { output } of toolResults) {
              const extra = (output as { sources?: { type: string; url: string }[] }).sources ?? [];
              for (const source of extra) if (source.type === "url" && !found.has(source.url)) found.set(source.url, undefined);
            }
            // No backend returns per-source excerpts, so the synthesized answer rides on
            // the first result (with an empty url when nothing was cited).
            const [first = { url: "", time: {} }, ...rest] = [...found].map(([url, title]) => ({ url, ...(title ? { title } : {}), time: {} }));
            return [{ ...first, content: text.trim() }, ...rest];
          },
        });
      }
    });

    const refresh = async () => {
      const { data } = await ctx.provider.list();
      available = new Map(data.filter((provider) => entries.has(provider.id)).map((provider) => [provider.id, provider.name]));
      await ctx.websearch.reload();
    };
    void (async () => {
      for await (const event of ctx.event.subscribe()) {
        if (event.type === "credential.switched" || event.type === "provider.updated") await refresh();
      }
    })();
    await refresh();

    return () => {
      for (const websocketFetch of websocketFetches.values()) websocketFetch.close();
    };
  },
});
