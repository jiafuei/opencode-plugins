import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenAIBackend, resolveOpenAIAuth } from "./openai_backend.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { force: true, recursive: true });
});

async function backendWithAuth(auth: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "opencode-websearch-"));
  temporaryDirectories.push(root);
  const state = join(root, "state", "opencode");
  const data = join(root, "share", "opencode");
  await mkdir(data, { recursive: true });
  await Bun.write(join(data, "auth.json"), JSON.stringify({ openai: auth }));
  return createOpenAIBackend({ path: { get: async () => ({ data: { state } }) } } as any, "/tmp");
}

function responsesStream() {
  const events = [
    { type: "response.created", response: { id: "response", created_at: 0, model: "gpt-5.4", service_tier: null } },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "message", phase: "final_answer" } },
    { type: "response.output_text.delta", item_id: "message", delta: "Grounded answer" },
    { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "message", phase: "final_answer" } },
    {
      type: "response.completed",
      response: {
        incomplete_details: null,
        usage: {
          input_tokens: 1,
          input_tokens_details: null,
          output_tokens: 1,
          output_tokens_details: null,
        },
        reasoning: null,
        service_tier: null,
      },
    },
  ];
  return new Response(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("OpenAI web search authentication", () => {
  test("selects ChatGPT subscription credentials", () => {
    expect(resolveOpenAIAuth({ type: "oauth", access: "subscription-token", accountId: "account" })).toEqual({
      type: "subscription",
      apiKey: "subscription-token",
      accountId: "account",
    });
  });

  test("selects OpenAI API credentials", () => {
    expect(resolveOpenAIAuth({ type: "api", key: "api-key" })).toEqual({
      type: "api",
      apiKey: "api-key",
    });
  });

  test("rejects missing credentials", () => {
    expect(() => resolveOpenAIAuth(undefined)).toThrow(/ChatGPT subscription or OpenAI API key/);
  });
});

describe.serial("OpenAI web search HTTPS transport", () => {
  test.each([
    {
      name: "ChatGPT subscription",
      auth: { type: "oauth", access: "subscription-token", accountId: "account" },
      url: "https://chatgpt.com/backend-api/codex/responses",
      accountId: "account",
    },
    {
      name: "OpenAI API key",
      auth: { type: "api", key: "api-key" },
      url: "https://api.openai.com/v1/responses",
      accountId: null,
    },
  ])("uses HTTPS for $name by default", async ({ auth, url, accountId }) => {
    const backend = await backendWithAuth(auth);
    const originalFetch = globalThis.fetch;
    let request: { input: string; headers: Headers } | undefined;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      request = { input: String(input), headers: new Headers(init?.headers) };
      return responsesStream();
    }) as typeof fetch;
    try {
      const result = await backend.search({
        context: { abort: new AbortController().signal } as any,
        model: "gpt-5.4",
        query: "latest news",
      });
      expect(request?.input).toBe(url);
      expect(request?.headers.get("authorization")).toBe(`Bearer ${auth.type === "oauth" ? auth.access : auth.key}`);
      expect(request?.headers.get("chatgpt-account-id")).toBe(accountId);
      expect(result.text).toBe("Grounded answer");
    } finally {
      globalThis.fetch = originalFetch;
      backend.dispose();
    }
  });
});
