import { createOpenAI, type OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { Plugin } from "@opencode/plugin";
import { streamText } from "ai";
import { createWebSocketFetch } from "./websocket_fetch.ts";

export type OpenAISubscriptionTransport = "https" | "websocket";
interface WebSearchOptions {
  model?: string;
  openaiSubscriptionTransport?: OpenAISubscriptionTransport;
}

const DEFAULT_MODEL = "gpt-5.6-luna";
const CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex";

function residency(accessToken: string) {
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString()) as {
      chatgpt_compute_residency?: string;
      "https://api.openai.com/auth"?: { chatgpt_compute_residency?: string };
    };
    const value = claims["https://api.openai.com/auth"]?.chatgpt_compute_residency ?? claims.chatgpt_compute_residency;
    return value && value !== "no_constraint" ? value : undefined;
  } catch {
    return undefined;
  }
}

export default Plugin.define({
  id: "websearch",
  setup: async (ctx) => {
    const options = ctx.options as WebSearchOptions;
    const model = options.model ?? DEFAULT_MODEL;
    const websocketFetch = options.openaiSubscriptionTransport === "websocket" ? createWebSocketFetch() : undefined;
    let connected = false;

    const credential = async () => {
      const connection = await ctx.integration.connection.active("openai");
      return connection && ctx.integration.connection.resolve(connection);
    };

    await ctx.websearch.transform((editor) => {
      if (!connected) return;
      editor.add({
        id: "openai",
        name: "OpenAI",
        execute: async ({ query }, { signal }) => {
          const auth = await credential();
          if (!auth) throw new Error("Connect a ChatGPT subscription or OpenAI API key before using web search");
          // ChatGPT subscriptions (OAuth) go through the Codex backend; API keys use the public API.
          const subscription = auth.type === "oauth";
          const apiKey = subscription ? auth.access : auth.key;
          const accountID = subscription ? auth.metadata?.accountID as string | undefined : undefined;
          const location = subscription ? residency(apiKey) : undefined;
          const openai = createOpenAI({
            apiKey,
            ...(subscription ? { baseURL: CHATGPT_BASE_URL } : {}),
            ...(subscription && websocketFetch ? { fetch: websocketFetch } : {}),
            ...(subscription
              ? {
                  headers: {
                    ...(accountID ? { "ChatGPT-Account-Id": accountID } : {}),
                    ...(location ? { "x-openai-internal-codex-residency": location } : {}),
                  },
                }
              : {}),
          });
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
          for (const toolResult of toolResults) {
            if (toolResult.toolName !== "web_search") continue;
            for (const source of toolResult.output.sources ?? []) if (source.type === "url" && !found.has(source.url)) found.set(source.url, undefined);
          }
          // The Responses API cites sources without per-source excerpts, so the
          // synthesized answer rides on the first result.
          const answer = text.trim();
          return [...found].map(([url, title], index) => ({
            url,
            ...(title ? { title } : {}),
            ...(index === 0 && answer ? { content: answer } : {}),
            time: {},
          }));
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
