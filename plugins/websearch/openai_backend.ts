import { createOpenAI, type OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import type { PluginInput } from "@opencode-ai/plugin";
import { streamText } from "ai";
import { join, sep } from "node:path";
import type { ProviderData, SearchBackend } from "./backend.ts";
import { createWebSocketFetch } from "./websocket_fetch.ts";

type OpenAIAuth = { access?: string; accountId?: string; type?: string };

const CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex";

function authPath(statePath: string) {
  const stateMarker = `${sep}state${sep}opencode`;
  const dataMarker = `${sep}share${sep}opencode`;
  return join(`${statePath.slice(0, -stateMarker.length)}${dataMarker}`, "auth.json");
}

async function readAuth(client: PluginInput["client"], directory: string) {
  const response = await client.path.get({ query: { directory } });
  const store = (await Bun.file(authPath(response.data!.state)).json()) as Record<string, OpenAIAuth>;
  const auth = store.openai;
  if (auth?.type !== "oauth" || !auth.access) throw new Error("Connect an OpenAI ChatGPT subscription before using websearch");
  return { access: auth.access, accountId: auth.accountId };
}

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

export function createOpenAIBackend(client: PluginInput["client"], directory: string): SearchBackend {
  const websocketFetch = createWebSocketFetch();

  return {
    id: "openai",
    matches: (provider: ProviderData) => provider.id === "openai",
    dispose: () => websocketFetch.close(),
    async search({ context, model, query }) {
      const auth = await readAuth(client, directory);
      const location = residency(auth.access);
      const openai = createOpenAI({
        apiKey: auth.access,
        baseURL: CHATGPT_BASE_URL,
        fetch: websocketFetch,
        headers: {
          ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
          ...(location ? { "x-openai-internal-codex-residency": location } : {}),
        },
      });
      const result = streamText({
        abortSignal: context.abort,
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
      const allSources = [
        ...sources.flatMap((source) => source.sourceType === "url" ? [{ title: source.title, url: source.url }] : []),
        ...toolResults.flatMap((toolResult) =>
          toolResult.toolName === "web_search"
            ? (toolResult.output.sources ?? []).flatMap((source) => source.type === "url" ? [{ url: source.url }] : [])
            : [],
        ),
      ];
      return { sources: allSources, text };
    },
  };
}
