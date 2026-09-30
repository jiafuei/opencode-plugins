import { describe, expect, test } from "bun:test";
import plugin from "./server.ts";

async function searchProvider(
  id: string,
  credential: Record<string, unknown> | undefined,
  options: Record<string, unknown> = {},
  provider: Record<string, unknown> = { id, name: id },
) {
  const added: any[] = [];
  let transform!: (editor: unknown) => void;
  await plugin.setup({
    options,
    provider: {
      list: async () => ({ data: credential ? [provider] : [] }),
      get: async () => ({ data: provider }),
    },
    integration: {
      connection: {
        active: async () => (credential ? { type: "credential", id: "cred-1", label: "", method: "oauth" } : undefined),
        resolve: async () => credential,
      },
    },
    websearch: {
      transform: async (callback: any) => void (transform = callback),
      reload: async () => {},
    },
    event: { subscribe: async function* () {} },
  } as any);
  transform({ add: (definition: unknown) => added.push(definition) });
  return added.find((definition) => definition.id === id);
}

function responsesStream() {
  const events = [
    { type: "response.created", response: { id: "response", created_at: 0, model: "gpt-5.6-luna", service_tier: null } },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "message", phase: "final_answer" } },
    { type: "response.output_text.delta", item_id: "message", delta: "Grounded answer" },
    {
      type: "response.output_text.annotation.added",
      item_id: "message",
      output_index: 0,
      content_index: 0,
      annotation_index: 0,
      annotation: { type: "url_citation", url: "https://example.com", title: "Example", start_index: 0, end_index: 8 },
    },
    { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "message", phase: "final_answer" } },
    {
      type: "response.completed",
      response: {
        incomplete_details: null,
        usage: { input_tokens: 1, input_tokens_details: null, output_tokens: 1, output_tokens_details: null },
        reasoning: null,
        service_tier: null,
      },
    },
  ];
  return new Response(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

function geminiStream() {
  const chunk = {
    candidates: [
      {
        content: { role: "model", parts: [{ text: "Grounded answer" }] },
        finishReason: "STOP",
        groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com", title: "Example" } }] },
      },
    ],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  };
  return new Response(`data: ${JSON.stringify(chunk)}\n\n`, { headers: { "content-type": "text/event-stream" } });
}

const subscriptionToken = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_compute_residency: "eu" } })).toString("base64url")}.signature`;

describe("OpenAI web search provider", () => {
  test("is only offered while an OpenAI connection exists", async () => {
    expect(await searchProvider("openai", undefined)).toBeUndefined();
  });

  describe.serial("HTTPS transport", () => {
    test.each([
      {
        name: "ChatGPT subscription",
        credential: { type: "oauth", methodID: "chatgpt-browser", access: subscriptionToken, refresh: "r", expires: 0, metadata: { accountID: "account" } },
        url: "https://chatgpt.com/backend-api/codex/responses",
        token: subscriptionToken,
        accountId: "account",
        residency: "eu",
      },
      {
        name: "OpenAI API key",
        credential: { type: "key", key: "api-key" },
        url: "https://api.openai.com/v1/responses",
        token: "api-key",
        accountId: null,
        residency: null,
      },
    ])("uses HTTPS for $name", async ({ credential, url, token, accountId, residency }) => {
      const provider = await searchProvider("openai", credential);
      const originalFetch = globalThis.fetch;
      let request: { input: string; headers: Headers; body: any } | undefined;
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        request = { input: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
        return responsesStream();
      }) as typeof fetch;
      try {
        const results = await provider.execute({ query: "latest news" }, { signal: new AbortController().signal });
        expect(request?.input).toBe(url);
        expect(request?.headers.get("authorization")).toBe(`Bearer ${token}`);
        expect(request?.headers.get("chatgpt-account-id")).toBe(accountId);
        expect(request?.headers.get("x-openai-internal-codex-residency")).toBe(residency);
        expect(results).toEqual([{ url: "https://example.com", title: "Example", content: "Grounded answer", time: {} }]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

test("custom @ai-sdk/google provider searches through its own endpoint", async () => {
  const provider = await searchProvider(
    "gemini-proxy",
    { type: "key", key: "google-key" },
    { providers: { "gemini-proxy": { type: "google" } } },
    { id: "gemini-proxy", name: "Gemini proxy", settings: { baseURL: "https://proxy.example/v1beta" } },
  );
  const originalFetch = globalThis.fetch;
  let request: { input: string; headers: Headers; body: any } | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    request = { input: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
    return geminiStream();
  }) as typeof fetch;
  try {
    const results = await provider.execute({ query: "latest news" }, { signal: new AbortController().signal });
    expect(provider.name).toBe("Gemini proxy");
    expect(request?.input).toBe("https://proxy.example/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
    expect(request?.headers.get("x-goog-api-key")).toBe("google-key");
    expect(request?.body.tools).toEqual([{ googleSearch: {} }]);
    expect(results).toEqual([{ url: "https://example.com", title: "Example", content: "Grounded answer", time: {} }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
