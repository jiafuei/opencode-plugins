import { createOpenAI, type OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { Plugin } from "@opencode/plugin";
import { streamText } from "ai";
import { createWebSocketFetch } from "./websocket_fetch.ts";

interface WebSearchOptions {
  model?: string;
  transport?: "https" | "websocket";
}

const DEFAULT_MODEL = "gpt-5.6-luna";
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
    const model = options.model ?? DEFAULT_MODEL;
    const websocketFetch = options.transport === "websocket" ? createWebSocketFetch() : undefined;
    let connected = false;

    await ctx.websearch.transform((editor) => {
      if (!connected) return;
      editor.add({
        id: "openai",
        name: "OpenAI",
        execute: async ({ query }, { signal }) => {
          const connection = await ctx.integration.connection.active("openai");
          const auth = connection && (await ctx.integration.connection.resolve(connection));
          if (!auth) throw new Error("Connect a ChatGPT subscription or OpenAI API key before using web search");
          // ChatGPT subscriptions (OAuth) go through the Codex backend; API keys use the public API.
          const openai =
            auth.type === "oauth"
              ? createOpenAI({
                  apiKey: auth.access,
                  baseURL: CHATGPT_BASE_URL,
                  fetch: websocketFetch,
                  // ai-sdk drops undefined header values.
                  headers: {
                    "ChatGPT-Account-Id": auth.metadata?.accountID,
                    "x-openai-internal-codex-residency": residency(auth.access),
                  } as Record<string, string>,
                })
              : createOpenAI({ apiKey: auth.key });
          const result = streamText({
            abortSignal: signal,
            maxRetries: 0,
            model: openai.responses(model),
            prompt: `Search the live web for this query and return a concise, factual answer grounded in the retrieved content. Include useful details and cite sources.\n\n${query}`,
            providerOptions: {
              openai: {
                reasoningEffort: "low",
                store: false,
              } satisfies OpenAIResponsesProviderOptions,
            },
            toolChoice: { type: "tool", toolName: "web_search" },
            tools: { web_search: openai.tools.webSearch() },
          });
          const [text, sources, toolResults] = await Promise.all([result.text, result.sources, result.toolResults]);
          const found = new Map<string, string | undefined>();
          for (const source of sources) if (source.sourceType === "url" && !found.has(source.url)) found.set(source.url, source.title);
          for (const { output } of toolResults) {
            for (const source of output.sources ?? []) if (source.type === "url" && !found.has(source.url)) found.set(source.url, undefined);
          }
          // The Responses API cites sources without per-source excerpts, so the
          // synthesized answer rides on the first result (with an empty url when nothing was cited).
          const [first = { url: "", time: {} }, ...rest] = [...found].map(([url, title]) => ({ url, ...(title ? { title } : {}), time: {} }));
          return [{ ...first, content: text.trim() }, ...rest];
        },
      });
    });

    const refresh = async () => {
      connected = (await ctx.integration.connection.active("openai")) !== undefined;
      await ctx.websearch.reload();
    };
    void (async () => {
      for await (const event of ctx.event.subscribe()) {
        if (event.type === "credential.switched" && event.data.integrationID === "openai") await refresh();
      }
    })();
    await refresh();

    return () => websocketFetch?.close();
  },
});
