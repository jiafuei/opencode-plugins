import { describe, expect, spyOn, test } from "bun:test";
import http from "node:http";
import * as https from "node:https";
import { OAUTH_CREDENTIAL, setupPlugin } from "../claude-oauth/test_harness.ts";
import plugin from "./server.ts";

async function searchProvider(
  id: string,
  credential: Record<string, unknown> | undefined,
  options: Record<string, unknown> = {},
  provider: Record<string, unknown> = { id, name: id },
  rpc?: unknown,
) {
  const added: any[] = [];
  let transform!: (editor: unknown) => void;
  await plugin.setup({
    options,
    rpc,
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

test.each([
  { profile: "cli", model: "claude-sonnet-5", maxTokens: 64000 },
  { profile: "sdk-cli", model: "claude-sonnet-5-5", maxTokens: 128000 },
])("Claude subscription search uses $profile OAuth wire and returns citations", async ({ profile, model, maxTokens }) => {
  const oauth = await setupPlugin({ spoofingProfile: profile });
  const captures: Array<{ headers: Headers; body: any }> = [];
  const upstream = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      captures.push({ headers: request.headers, body: await request.json() });
      const events = [
        { type: "message_start", message: { id: "msg_search", model: "claude-opus-5-5", role: "assistant", content: [], usage: { input_tokens: 10 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Grounded answer" } },
        { type: "content_block_delta", index: 0, delta: { type: "citations_delta", citation: {
          type: "web_search_result_location", cited_text: "Evidence", url: "https://example.com", title: "Example", encrypted_index: "citation",
        } } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } },
        { type: "message_stop" },
      ];
      return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream", "request-id": "req_search" },
      });
    },
  });
  // Redirect only the final network hop; both plugins, SDK parsing, and the relay run normally.
  const transport = spyOn(https, "request").mockImplementation(((url: URL, options: http.RequestOptions, callback: any) => {
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages?beta=true");
    return http.request(new URL("v1/messages", upstream.url), { ...options, agent: undefined }, callback);
  }) as typeof https.request);
  try {
    const provider = await searchProvider("anthropic", OAUTH_CREDENTIAL,
      { providers: { anthropic: { model } } }, undefined,
      () => oauth.rpcMethods);
    // A refreshed credential must be resolved when preparing each search, not captured at setup.
    oauth.state.credential = { ...OAUTH_CREDENTIAL, access: "refreshed-access" };
    const results = await provider.execute({ query: "latest news" }, { signal: new AbortController().signal });
    expect(results).toEqual([{ url: "https://example.com", title: "Example", content: "Grounded answer", time: {} }]);
    const { headers, body } = captures[0]!;
    expect(headers.get("authorization")).toBe("Bearer refreshed-access");
    expect(headers.get("x-api-key")).toBeNull();
    expect(headers.get("user-agent")).toContain(`(external, ${profile})`);
    expect(headers.get("x-claude-code-request-class")).toBe("auxiliary");
    expect(headers.get("anthropic-beta")).toContain("oauth-2025-04-20");
    expect(headers.get("anthropic-beta")).not.toContain("advanced-tool-use");
    expect(headers.get("anthropic-beta")).not.toContain("thinking-binding-controls");
    expect(body.model).toBe(model);
    expect(body.max_tokens).toBe(maxTokens);
    expect(body.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 8 }]);
    expect(body.tool_choice).toEqual({ type: "auto" });
    expect(body.system).toHaveLength(3);
    expect(body.system[0].text).toContain(`cc_entrypoint=${profile};`);
    expect(body.system[0].text).not.toContain("cch=00000");
    expect(body.system[2].text).toBe("You are an assistant for performing a web search tool use");
    expect(JSON.stringify(body)).not.toContain("cache_control");
    expect(body.diagnostics).toBeUndefined();
    expect(body.messages[0].content[0].text).toContain("latest news");
    expect(JSON.parse(body.metadata.user_id).account_uuid).toBe("acct-test-123");
    expect(oauth.state.sessions).toEqual({});
  } finally {
    transport.mockRestore();
    oauth.cleanup?.();
    upstream.stop(true);
  }
});

test("Anthropic API-key search keeps provider settings and exposes the original HTTP error", async () => {
  const provider = await searchProvider("claude-proxy", { type: "key", key: "anthropic-key" },
    { providers: { "claude-proxy": { type: "anthropic", model: "claude-sonnet-5-5" } } },
    { id: "claude-proxy", name: "Claude proxy", settings: { baseURL: "https://proxy.example/v1" }, headers: { "x-proxy": "configured" } });
  const originalFetch = globalThis.fetch;
  let request: { url: string; headers: Headers; body: any } | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    request = { url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
    return Response.json({ type: "error", error: { type: "rate_limit_error", message: "Search quota exceeded" } },
      { status: 429, headers: { "retry-after": "30" } });
  }) as typeof fetch;
  // streamText logs errors by default, even when the caller consumes and handles its error event.
  const logging = spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(provider.execute({ query: "latest news" }, { signal: new AbortController().signal })).rejects.toMatchObject({
      statusCode: 429, message: "Search quota exceeded", responseHeaders: { "retry-after": "30" },
    });
    expect(request?.url).toBe("https://proxy.example/v1/messages");
    expect(request?.headers.get("x-api-key")).toBe("anthropic-key");
    expect(request?.headers.get("authorization")).toBeNull();
    expect(request?.headers.get("x-proxy")).toBe("configured");
    expect(request?.body.model).toBe("claude-sonnet-5-5");
    expect(request?.body.tools[0].type).toBe("web_search_20260209");
  } finally {
    globalThis.fetch = originalFetch;
    logging.mockRestore();
  }
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
