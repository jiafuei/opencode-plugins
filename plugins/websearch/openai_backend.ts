import { createOpenAI, type OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import type { PluginInput } from "@opencode-ai/plugin";
import { streamText } from "ai";
import { join, sep } from "node:path";
import type { ProviderData, SearchBackend } from "./backend.ts";
import { createWebSocketFetch } from "./websocket_fetch.ts";

type OpenAIAuth = { access?: string; accountId?: string; type?: string };
type OpenAIConnection =
  | { apiKey: string; type: "api" }
  | { accountId?: string; apiKey: string; type: "subscription" };
export type OpenAISubscriptionTransport = "https" | "websocket";

const CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex";

function authPath(statePath: string) {
  const stateMarker = `${sep}state${sep}opencode`;
  const dataMarker = `${sep}share${sep}opencode`;
  return join(`${statePath.slice(0, -stateMarker.length)}${dataMarker}`, "auth.json");
}

export function resolveOpenAIAuth(auth: (OpenAIAuth & { key?: string }) | undefined): OpenAIConnection {
  if (auth?.type === "oauth" && auth.access) {
    return { type: "subscription", apiKey: auth.access, accountId: auth.accountId };
  }
  if (auth?.type === "api" && auth.key) return { type: "api", apiKey: auth.key };
  throw new Error("Connect a ChatGPT subscription or OpenAI API key before using websearch");
}

async function readAuth(client: PluginInput["client"], directory: string) {
  const response = await client.path.get({ query: { directory } });
  const store = (await Bun.file(authPath(response.data!.state)).json()) as Record<string, OpenAIAuth & { key?: string }>;
  return resolveOpenAIAuth(store.openai);
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

export function createOpenAIBackend(
  client: PluginInput["client"],
  directory: string,
  subscriptionTransport: OpenAISubscriptionTransport = "https",
): SearchBackend {
  const websocketFetch = subscriptionTransport === "websocket" ? createWebSocketFetch() : undefined;

  return {
    id: "openai",
    matches: (provider: ProviderData) => provider.id === "openai",
    dispose: () => websocketFetch?.close(),
    async search({ context, model, query }) {
      const auth = await readAuth(client, directory);
      const subscription = auth.type === "subscription";
      const location = subscription ? residency(auth.apiKey) : undefined;
      const openai = createOpenAI({
        apiKey: auth.apiKey,
        ...(subscription ? { baseURL: CHATGPT_BASE_URL } : {}),
        ...(subscription && websocketFetch ? { fetch: websocketFetch } : {}),
        ...(subscription
          ? {
              headers: {
                ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
                ...(location ? { "x-openai-internal-codex-residency": location } : {}),
              },
            }
          : {}),
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
