import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, streamText, tool } from "ai";
import { z } from "zod";
import { ClaudeOAuthPlugin } from "./claude_oauth.ts";
import { coworkTransport } from "./cowork_fetch.ts";

// Integration-style request capture harness.
//
// Drives the real @ai-sdk/anthropic serialization path (pinned to the exact
// version OpenCode bundles) through the plugin's auth loader and captures the
// final fetch — URL, headers, and body — right before it hits the network.
// Auth, client, and network are deterministic mocks; the only real code in
// between is the SDK request builder plus the plugin's fetch override.

const OAUTH_AUTH = {
  type: "oauth" as const,
  access: "test-access-token",
  refresh: "test-refresh-token",
  expires: Date.now() + 60 * 60 * 1000,
  accountId: "acct-test-123",
};

interface CapturedRequest {
  url: string;
  method?: string;
  headers: Record<string, string>;
  bodyText: string;
}

function sseResponse(): Response {
  const events: Array<[string, unknown]> = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_test",
          role: "assistant",
          content: [],
          model: "claude-sonnet-4-6",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      },
    ],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello!" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  const payload = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function jsonResponse(): Response {
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "Hello!" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

let cleanupFetch: (() => void) | undefined;
const originalTransport = coworkTransport.impl;
beforeEach(() => {
  coworkTransport.impl = (input, init) => globalThis.fetch(input, init);
});
afterEach(() => {
  cleanupFetch?.();
  cleanupFetch = undefined;
  coworkTransport.impl = originalTransport;
});

async function setupHarness() {
  const plugin = await ClaudeOAuthPlugin({
    client: { auth: { set: async () => {} } },
  } as never);
  const rawLoaderOptions = await plugin.auth!.loader!(async () => OAUTH_AUTH as never, {} as never);

  // Capture at two layers so preservation is observable:
  // - `fromSdk`: what @ai-sdk/anthropic hands to the plugin's auth loader
  // - `captured`: the final request after the plugin rewrites it
  const fromSdk: CapturedRequest[] = [];
  const loaderFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    let bodyText = "";
    if (typeof init?.body === "string") bodyText = init.body;
    else if (init?.body instanceof Uint8Array) bodyText = new TextDecoder().decode(init.body);
    fromSdk.push({ url: String(input), method: init?.method, headers, bodyText });
    return rawLoaderOptions.fetch!(input, init);
  };

  const captured: CapturedRequest[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    let bodyText = "";
    if (typeof init?.body === "string") bodyText = init.body;
    else if (init?.body instanceof Uint8Array) bodyText = new TextDecoder().decode(init.body);
    captured.push({ url: String(input), method: init?.method, headers, bodyText });
    // Streaming bodies get an SSE envelope; non-streaming ones a JSON message.
    return bodyText.includes('"stream":true') ? sseResponse() : jsonResponse();
  }) as typeof fetch;
  cleanupFetch = () => {
    globalThis.fetch = originalFetch;
  };

  // Same wiring as OpenCode's provider.ts resolveSDK: the loader's options
  // (apiKey + fetch) feed straight into createAnthropic.
  const anthropic = createAnthropic({
    name: "anthropic",
    apiKey: rawLoaderOptions.apiKey!,
    fetch: loaderFetch as typeof fetch,
  });
  return { anthropic, captured, fromSdk };
}

describe("request capture: normal streaming request", () => {
  test("streaming request reaches the wire fingerprinted as Claude Code", async () => {
    const { anthropic, captured } = await setupHarness();

    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      system: "You are a coding agent.",
      prompt: "hello world, this is the first user message",
      maxOutputTokens: 128000,
      headers: {
        "X-Claude-Code-Session-Id": "session-test-1",
        "x-session-affinity": "ses_opencode",
        "x-session-id": "ses_opencode",
        "x-parent-session-id": "ses_parent",
      },
    });
    expect(await result.text).toBe("Hello!");

    expect(captured).toHaveLength(1);
    const req = captured[0]!;

    expect(req.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(req.headers["authorization"]).toBe("Bearer test-access-token");
    expect(req.headers["x-api-key"]).toBeUndefined();
    expect(req.headers["x-session-affinity"]).toBeUndefined();
    expect(req.headers["x-session-id"]).toBeUndefined();
    expect(req.headers["x-parent-session-id"]).toBeUndefined();
    expect(req.headers["user-agent"]).toBe("claude-cli/2.1.224 (external, sdk-cli)");
    expect(req.headers["x-client-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.headers["x-claude-code-session-id"]).toBe("session-test-1");

    const body = JSON.parse(req.bodyText);
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(64000);
    expect(body.system[0].text).toContain("x-anthropic-billing-header:");
    expect(body.system[0].text).not.toContain("cch=00000");

    const userId = JSON.parse(body.metadata.user_id);
    expect(userId.session_id).toBe("session-test-1");
    expect(userId.account_uuid).toBe("acct-test-123");
  });
});

describe("request capture: non-streaming request", () => {
  test("non-streaming request keeps stream unset", async () => {
    const { anthropic, captured } = await setupHarness();

    const result = await generateText({
      model: anthropic("claude-sonnet-4-6"),
      prompt: "hello world, this is the first user message",
      maxOutputTokens: 128000,
      headers: { "X-Claude-Code-Session-Id": "session-nonstream" },
    });
    expect(result.text).toBe("Hello!");

    const req = captured[0]!;

    const body = JSON.parse(req.bodyText);
    expect(body.stream).toBeUndefined();
    expect(body.tools).toEqual([]);
    expect(JSON.parse(body.metadata.user_id).session_id).toBe("session-nonstream");
  });
});

describe("request capture: SDK-generated beta/context-management data", () => {
  test("thinking + SDK context_management survive when thinking is on", async () => {
    const { anthropic, captured } = await setupHarness();

    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      prompt: "hi",
      maxOutputTokens: 1000,
      providerOptions: {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: 1024 },
          contextManagement: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] },
        },
      },
    });
    await result.text;

    const req = captured[0]!;
    const body = JSON.parse(req.bodyText);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
    expect(body.context_management).toEqual({ edits: [{ type: "clear_thinking_20251015", keep: "all" }] });
  });

  test("normalizes SDK tool streaming, structured-output, and cache fields at the wire boundary", async () => {
    const { anthropic, captured, fromSdk } = await setupHarness();

    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      messages: [
        {
          role: "system",
          content: "Cached system prompt",
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        },
        { role: "user", content: "hi" },
      ],
      tools: {
        lookup: tool({
          description: "Lookup",
          inputSchema: z.object({ query: z.string() }),
        }),
      },
    });
    await result.text;

    const sdkBody = JSON.parse(fromSdk[0]!.bodyText);
    expect(sdkBody.system[0].cache_control).toEqual({ type: "ephemeral" });

    const req = captured[0]!;
    const betas = req.headers["anthropic-beta"]!.split(",");
    const body = JSON.parse(req.bodyText);
    expect(betas).not.toContain("structured-outputs-2025-11-13");
    expect(body.tools[0].name).toBe("_lookup");
    expect(body.tools[0].eager_input_streaming).toBe(true);
    expect(body.tools[0].input_schema.additionalProperties).toBe(false);
  });

});

describe("request capture: x-client-request-id per-invocation semantics", () => {
  // Private plugin transport header set by chat.headers; never sent on the wire.
  const REQUEST_ID_HEADER = "x-claude-oauth-request-id";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  async function makeLoaderFetch() {
    const plugin = await ClaudeOAuthPlugin({ client: { auth: { set: async () => {} } } } as never);
    return plugin.auth!.loader!(async () => OAUTH_AUTH as never, {} as never);
  }

  test("SDK retries reusing prepared headers keep the same id; fallback mints fresh ones; no private-header leakage", async () => {
    const options = await makeLoaderFetch();
    const ids: string[] = [];
    let privateHeaderSeenOnWire = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (headers.has(REQUEST_ID_HEADER)) privateHeaderSeenOnWire = true;
      ids.push(headers.get("x-client-request-id")!);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const body = JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "a" }], max_tokens: 1 });
      // chat.headers output as it arrives at fetch: one prepared invocation,
      // retried by the SDK three times with identical prepared headers.
      const retryInit: RequestInit = {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [REQUEST_ID_HEADER]: "11111111-2222-3333-4444-555555555555",
          "X-Claude-Code-Session-Id": "session-retry",
        },
        body,
      };
      await options.fetch!("https://api.anthropic.com/v1/messages", { ...retryInit });
      await options.fetch!("https://api.anthropic.com/v1/messages", { ...retryInit });
      await options.fetch!("https://api.anthropic.com/v1/messages", { ...retryInit });
      // A separate logical invocation without the hook header falls back to a
      // freshly minted UUID.
      await options.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Claude-Code-Session-Id": "session-retry" },
        body,
      });
      await options.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Claude-Code-Session-Id": "session-retry" },
        body,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(ids[0]).toBe("11111111-2222-3333-4444-555555555555");
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).toBe(ids[0]);
    expect(ids[3]).toMatch(UUID);
    expect(ids[4]).not.toBe(ids[3]);
    expect(privateHeaderSeenOnWire).toBe(false);
  });

  test("count_tokens gets its own profile headers without messages body attribution", async () => {
    const options = await makeLoaderFetch();
    let captured: CapturedRequest | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => (headers[key] = value));
      captured = { url: String(input), method: init?.method, headers, bodyText: init?.body as string };
      return new Response(JSON.stringify({ input_tokens: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const response = await options.fetch!("https://api.anthropic.com/v1/messages/count_tokens?source=test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [REQUEST_ID_HEADER]: "11111111-2222-3333-4444-555555555555",
          "x-claude-oauth-prompt-id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          "X-Claude-Code-Session-Id": "session-count",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          messages: [{ role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "get_weather", input: {} }] }],
          tools: [{ name: "get_weather", input_schema: { type: "object" } }],
        }),
      });
      expect((await response.json()).input_tokens).toBe(42);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(captured!.url).toBe("https://api.anthropic.com/v1/messages/count_tokens?source=test&beta=true");
    expect(captured!.headers["anthropic-beta"]).toBe(
      "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,structured-outputs-2025-12-15,token-counting-2024-11-01",
    );
    expect(captured!.headers[REQUEST_ID_HEADER]).toBeUndefined();
    expect(captured!.headers["x-claude-oauth-prompt-id"]).toBeUndefined();
    const body = JSON.parse(captured!.bodyText);
    expect(body.system).toBeUndefined();
    expect(body.metadata).toBeUndefined();
    expect(body.tools[0].name).toBe("_get_weather");
    expect(body.messages[0].content[0].name).toBe("_get_weather");
  });

  test("chat.headers maps each OpenCode session to a stable process-local UUIDv4, rotated on deletion", async () => {
    const plugin = await ClaudeOAuthPlugin({ client: { auth: { set: async () => {} } } } as never);
    const sessionId = async (sessionID: string) => {
      const output = { headers: {} as Record<string, string> };
      await plugin["chat.headers"]!(
        {
          model: { providerID: "anthropic" },
          provider: { options: { claudeOAuth: true } },
          sessionID,
          message: { id: "msg_1" },
        } as never,
        output as never,
      );
      return output.headers["X-Claude-Code-Session-Id"]!;
    };
    const first = await sessionId("ses_stable");
    expect(await sessionId("ses_stable")).toBe(first);
    expect(await sessionId("ses_other")).not.toBe(first);
    await plugin.event!({ event: { type: "session.deleted", properties: { info: { id: "ses_stable" } } } } as never);
    expect(await sessionId("ses_stable")).not.toBe(first);
    await plugin.dispose!();
  });

  test("attributionHeader false suppresses billing and prompt markers through the plugin", async () => {
    const plugin = await ClaudeOAuthPlugin(
      { client: { auth: { set: async () => {} } } } as never,
      { attributionHeader: false },
    );
    const output = { headers: {} as Record<string, string> };
    await plugin["chat.headers"]!(
      {
        model: { providerID: "anthropic" },
        provider: { options: { claudeOAuth: true } },
        sessionID: "session-no-attribution",
        message: { id: "message-no-attribution" },
      } as never,
      output as never,
    );
    const options = await plugin.auth!.loader!(async () => OAUTH_AUTH as never, {} as never);
    let wireBody = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      wireBody = init?.body as string;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await options.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", ...output.headers },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          messages: [{ role: "user", content: "hi" }],
          system: [{ type: "text", text: "x-anthropic-billing-header: cc_version=old; cch=abcde;" }],
          max_tokens: 1,
        }),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    const system = JSON.parse(wireBody).system as Array<{ text: string }>;
    expect(system.some((block) => block.text.startsWith("x-anthropic-billing-header:"))).toBe(false);
  });
});
