import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, streamText, tool } from "ai";
import { z } from "zod";
import { ClaudeOAuthPlugin, mapStainlessArch } from "./claude_oauth.ts";

// Integration-style request capture harness.
//
// Drives the real @ai-sdk/anthropic serialization path (pinned to the exact
// version OpenCode bundles) through the plugin's auth loader and captures the
// final fetch — URL, headers, and body — right before it hits the network.
// Auth, client, and network are deterministic mocks; the only real code in
// between is the SDK request builder plus the plugin's fetch override.

// Plain prompt without tools/thinking selects the utility profile.
const UTILITY_BETAS = [
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "redact-thinking-2026-02-12",
  "thinking-token-count-2026-05-13",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "structured-outputs-2025-12-15",
  "fallback-credit-2026-06-01",
];

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
afterEach(() => {
  cleanupFetch?.();
  cleanupFetch = undefined;
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
    expect(req.method).toBe("POST");
    // OAuth bearer replaces the SDK's dummy x-api-key.
    expect(req.headers["authorization"]).toBe("Bearer test-access-token");
    expect(req.headers["x-api-key"]).toBeUndefined();
    expect(req.headers["x-session-affinity"]).toBeUndefined();
    expect(req.headers["x-session-id"]).toBeUndefined();
    expect(req.headers["x-parent-session-id"]).toBeUndefined();
    expect(req.headers["user-agent"]).toBe("claude-cli/2.1.228 (external, cli)");
    expect(req.headers["accept"]).toBe("application/json");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");
    expect(req.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(req.headers["x-app"]).toBe("cli");
    expect(req.headers["x-client-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.headers["connection"]).toBe("keep-alive");
    expect(req.headers["accept-encoding"]).toBe("gzip, deflate, br, zstd");
    expect(req.headers["x-stainless-arch"]).toBe(mapStainlessArch(process.arch));
    expect(req.headers["x-stainless-retry-count"]).toBe("0");
    expect(req.headers["x-claude-code-session-id"]).toBe("session-test-1");

    expect(req.headers["anthropic-beta"]!.split(",")).toEqual(UTILITY_BETAS);

    const body = JSON.parse(req.bodyText);
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(64000);
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hello world, this is the first user message" }] },
    ]);
    expect(body.system[0].text).toContain("x-anthropic-billing-header:");
    expect(body.system[0].text).toContain("cc_entrypoint=cli");
    // cch placeholder must be replaced with the real attestation before send.
    expect(body.system[0].text).not.toContain("cch=00000");
    expect(body.system[0].text).toMatch(/cch=[0-9a-f]{5}/);
    expect(body.system[1].text).toBe("You are Claude Code, Anthropic's official CLI for Claude.");
    expect(body.system[2].text).toBe("You are a coding agent.");

    const userId = JSON.parse(body.metadata.user_id);
    expect(userId.device_id).toMatch(/^[0-9a-f]{64}$/);
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

    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.url).toBe("https://api.anthropic.com/v1/messages?beta=true");

    const body = JSON.parse(req.bodyText);
    // The SDK omits `stream` for non-streaming calls; the plugin preserves that.
    expect(body.stream).toBeUndefined();
    expect(body.max_tokens).toBe(64000);
    // The OAuth tools:[] insertion applies even without caller tools.
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
    const betas = req.headers["anthropic-beta"]!.split(",");
    expect(betas).toContain("effort-2025-11-24");
    expect(betas).toContain("context-management-2025-06-27");
  });

  test("merges SDK-generated betas into the final anthropic-beta header after the profile", async () => {
    const { anthropic, captured, fromSdk } = await setupHarness();

    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      prompt: "hi",
      maxOutputTokens: 1000,
      providerOptions: {
        anthropic: {
          anthropicBeta: ["fine-grained-tool-streaming-2025-05-14", "fast-mode-2026-02-01"],
          speed: "fast",
        },
      },
    });
    await result.text;

    // The SDK emits fast-mode-2026-02-01 in its anthropic-beta header; the
    // plugin preserves it, deduplicated, after the utility profile. Body
    // `speed` survives via the extras passthrough.
    const sdkReq = fromSdk[0]!;
    expect(sdkReq.headers["anthropic-beta"]!.split(",")).toContain("fine-grained-tool-streaming-2025-05-14");
    expect(sdkReq.headers["anthropic-beta"]!.split(",")).toContain("fast-mode-2026-02-01");

    const req = captured[0]!;
    expect(req.headers["anthropic-beta"]!.split(",")).toEqual([...UTILITY_BETAS, "fast-mode-2026-02-01"]);
    expect(JSON.parse(req.bodyText).speed).toBe("fast");
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

    const sdkReq = fromSdk[0]!;
    const sdkBody = JSON.parse(sdkReq.bodyText);
    expect(sdkReq.headers["anthropic-beta"]!.split(",")).toContain("structured-outputs-2025-11-13");
    expect(sdkBody.tools[0].eager_input_streaming).toBe(true);
    expect(sdkBody.system[0].cache_control).toEqual({ type: "ephemeral" });

    const req = captured[0]!;
    const betas = req.headers["anthropic-beta"]!.split(",");
    const body = JSON.parse(req.bodyText);
    expect(betas).not.toContain("structured-outputs-2025-11-13");
    expect(betas).not.toContain("advanced-tool-use-2025-11-20");
    expect(betas).toContain("extended-cache-ttl-2025-04-11");
    expect(body.tools[0].name).toBe("mcp__occli__lookup");
    expect(body.tools[0].eager_input_streaming).toBeUndefined();
    expect(body.tools[0].input_schema.additionalProperties).toBe(false);
    expect(body.system[2].cache_control).toEqual({ type: "ephemeral", ttl: "1h", scope: "global" });
  });

});

describe("request capture: header parity", () => {
  test("preserves incoming claude-cli User-Agents verbatim regardless of casing", async () => {
    const { anthropic, captured } = await setupHarness();
    const userAgents = ["claude-cli/9.9.9 (custom-build)", "CLAUDE-CLI/1.2.3"];
    for (const userAgent of userAgents) {
      const result = streamText({
        model: anthropic("claude-sonnet-4-6"),
        prompt: "hi",
        maxOutputTokens: 1000,
        headers: { "User-Agent": userAgent },
      });
      await result.text;
    }
    for (const [index, userAgent] of userAgents.entries()) {
      expect(captured[index]!.headers["user-agent"]!.startsWith(userAgent)).toBe(true);
    }
  });

  test("replaces non-claude-cli User-Agents with the CLI UA", async () => {
    const { anthropic, captured } = await setupHarness();

    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      prompt: "hi",
      maxOutputTokens: 1000,
      headers: { "User-Agent": "my-opencode-client/1.0" },
    });
    await result.text;

    expect(captured[0]!.headers["user-agent"]).toBe("claude-cli/2.1.228 (external, cli)");
  });

  test("synthesizes X-Claude-Code-Session-Id from metadata.user_id when no hook ran", async () => {
    const { anthropic, captured } = await setupHarness();

    // No X-Claude-Code-Session-Id caller header: rewriteBody generates the
    // envelope session and the wire header must match it exactly.
    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      prompt: "hi",
      maxOutputTokens: 1000,
    });
    await result.text;

    const req = captured[0]!;
    const bodySession = JSON.parse(JSON.parse(req.bodyText).metadata.user_id).session_id;
    expect(bodySession).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.headers["x-claude-code-session-id"]).toBe(bodySession);
  });

  test("header follows a preserved valid user_id session over a divergent hook value", async () => {
    const { anthropic, captured } = await setupHarness();

    const cloakingUserId =
      `user_${"a".repeat(64)}_account_11111111-2222-3333-4444-555555555555` +
      `_session_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`;
    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      prompt: "hi",
      maxOutputTokens: 1000,
      // The SDK serializes this into body metadata.user_id; the hook-supplied
      // header session diverges, but the preserved user_id session must win.
      headers: { "X-Claude-Code-Session-Id": "hook-session" },
      providerOptions: {
        anthropic: { metadata: { userId: cloakingUserId } },
      },
    });
    await result.text;

    const req = captured[0]!;
    expect(JSON.parse(req.bodyText).metadata.user_id).toBe(cloakingUserId);
    expect(req.headers["x-claude-code-session-id"]).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
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

  test("distinct identical logical SDK invocations get different ids", async () => {
    const { anthropic, captured } = await setupHarness();
    const invoke = () =>
      streamText({
        model: anthropic("claude-sonnet-4-6"),
        system: "You are a coding agent.",
        prompt: "hello world, this is the first user message",
        maxOutputTokens: 128000,
        headers: { "X-Claude-Code-Session-Id": "session-test-1" },
      });
    await (await invoke()).text;
    await (await invoke()).text;

    expect(captured).toHaveLength(2);
    const idA = captured[0]!.headers["x-client-request-id"]!;
    const idB = captured[1]!.headers["x-client-request-id"]!;
    expect(idA).toMatch(UUID);
    expect(idB).toMatch(UUID);
    expect(idB).not.toBe(idA);
  });

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
    expect(ids).toHaveLength(5);
    // Retries reuse the hook-provided id verbatim.
    expect(ids[0]).toBe("11111111-2222-3333-4444-555555555555");
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).toBe(ids[0]);
    // Fallback: fresh valid UUIDs, distinct per direct request.
    expect(ids[3]).toMatch(UUID);
    expect(ids[4]).toMatch(UUID);
    expect(ids[4]).not.toBe(ids[3]);
    expect(ids[3]).not.toBe(ids[0]);
    // The private marker must be stripped everywhere before dispatch.
    expect(privateHeaderSeenOnWire).toBe(false);
  });

  test("count_tokens gets its own CLI headers without messages body attribution", async () => {
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
      expect(await response.json()).toEqual({ input_tokens: 42 });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(captured!.url).toBe("https://api.anthropic.com/v1/messages/count_tokens?source=test&beta=true");
    expect(captured!.headers["anthropic-beta"]).toBe(
      "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,token-counting-2024-11-01",
    );
    expect(captured!.headers["x-stainless-timeout"]).toBeUndefined();
    expect(captured!.headers[REQUEST_ID_HEADER]).toBeUndefined();
    expect(captured!.headers["x-claude-oauth-prompt-id"]).toBeUndefined();
    const body = JSON.parse(captured!.bodyText);
    expect(body.system).toBeUndefined();
    expect(body.metadata).toBeUndefined();
    expect(body.tools[0].name).toBe("mcp__occli__get_weather");
    expect(body.tools[0].input_schema.additionalProperties).toBe(false);
    expect(body.messages[0].content[0].name).toBe("mcp__occli__get_weather");
  });

  test("prompt ids stay stable and successful request ids chain through billing metadata", async () => {
    const plugin = await ClaudeOAuthPlugin({ client: { auth: { set: async () => {} } } } as never);
    const options = await plugin.auth!.loader!(async () => OAUTH_AUTH as never, {} as never);
    const captured: CapturedRequest[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => (headers[key] = value));
      captured.push({ url: String(input), method: init?.method, headers, bodyText: init?.body as string });
      return new Response('{"type":"message"}', {
        status: 200,
        headers: { "content-type": "application/json", "request-id": captured.length === 1 ? "req_first" : "req_second" },
      });
    }) as typeof fetch;
    try {
      for (let index = 0; index < 2; index++) {
        const output = { headers: {} as Record<string, string> };
        await plugin["chat.headers"]!(
          {
            model: { providerID: "anthropic" },
            provider: { options: { claudeOAuth: true } },
            sessionID: "session-chain",
            message: { id: "message-stable" },
          } as never,
          output as never,
        );
        await options.fetch!("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", ...output.headers },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1,
          }),
        });
      }
    } finally {
      globalThis.fetch = originalFetch;
    }

    const billing = captured.map((request) =>
      JSON.parse(request.bodyText).system.find((block: { text?: string }) => block.text?.startsWith("x-anthropic-billing-header:"))
        .text as string,
    );
    const promptId = billing[0]!.match(/cc_prompt_id=([0-9a-f-]{36})/)![1]!;
    expect(billing[1]).toContain(`cc_prompt_id=${promptId};`);
    expect(billing[0]).not.toContain("cc_prev_req=");
    expect(billing[1]).toContain("cc_prev_req=req_first;");
    const sessionIds = captured.map((request) => JSON.parse(JSON.parse(request.bodyText).metadata.user_id).session_id);
    expect(sessionIds[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(sessionIds[1]).toBe(sessionIds[0]);
    expect(captured[1]!.headers["x-claude-code-session-id"]).toBe(sessionIds[0]);
    expect(captured.every((request) => request.headers["x-claude-oauth-prompt-id"] === undefined)).toBe(true);
    expect(captured.every((request) => request.headers["x-claude-oauth-session-id"] === undefined)).toBe(true);
  });

  test("previous request state does not cross OAuth credentials", async () => {
    const plugin = await ClaudeOAuthPlugin({ client: { auth: { set: async () => {} } } } as never);
    let auth = { ...OAUTH_AUTH, access: "account-a-token", accountId: "account-a" };
    const options = await plugin.auth!.loader!(async () => auth as never, {} as never);
    const bodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(init?.body as string);
      return new Response('{"type":"message"}', {
        status: 200,
        headers: { "content-type": "application/json", "request-id": bodies.length === 1 ? "req_account_a" : "req_account_b" },
      });
    }) as typeof fetch;
    try {
      const send = () =>
        options.fetch!("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "X-Claude-Code-Session-Id": "shared-session" },
          body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
        });
      await send();
      auth = { ...auth, access: "account-b-token", accountId: "account-b" };
      await send();
    } finally {
      globalThis.fetch = originalFetch;
    }
    const secondBilling = JSON.parse(bodies[1]!).system.find((block: { text?: string }) =>
      block.text?.startsWith("x-anthropic-billing-header:"),
    ).text as string;
    expect(secondBilling).not.toContain("cc_prev_req=req_account_a");
  });

  test("Claude session UUIDv4 persists across restarts and rotates after session deletion", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "claude-oauth-session-id-"));
    const databasePath = path.join(dir, "claude-oauth.db");
    const legacy = new Database(databasePath, { create: true });
    legacy.exec("PRAGMA user_version = 1");
    legacy.close();
    const sessionId = async (plugin: Awaited<ReturnType<typeof ClaudeOAuthPlugin>>) => {
      const output = { headers: {} as Record<string, string> };
      await plugin["chat.headers"]!(
        {
          model: { providerID: "anthropic" },
          provider: { options: { claudeOAuth: true } },
          sessionID: "ses_persisted",
          message: { id: "msg_1" },
        } as never,
        output as never,
      );
      return output.headers["X-Claude-Code-Session-Id"]!;
    };
    try {
      const firstPlugin = await ClaudeOAuthPlugin({} as never, { databasePath });
      const first = await sessionId(firstPlugin);
      expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      await firstPlugin.dispose!();

      const resumedPlugin = await ClaudeOAuthPlugin({} as never, { databasePath });
      expect(await sessionId(resumedPlugin)).toBe(first);
      await resumedPlugin.event!({
        event: { type: "session.deleted", properties: { info: { id: "ses_persisted" } } },
      } as never);
      expect(await sessionId(resumedPlugin)).not.toBe(first);
      await resumedPlugin.dispose!();

      const db = new Database(databasePath, { readonly: true });
      expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(2);
      expect(
        (db.query("SELECT claude_session_id FROM session_ids WHERE opencode_session_id = ?").get("ses_persisted") as {
          claude_session_id: string;
        }).claude_session_id,
      ).not.toBe(first);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("request chains resume from claude-oauth.db and compaction clears them", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "claude-oauth-request-chain-"));
    const databasePath = path.join(dir, "claude-oauth.db");
    const bodies: string[] = [];
    const plugins: Array<Awaited<ReturnType<typeof ClaudeOAuthPlugin>>> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(init?.body as string);
      return new Response('{"type":"message"}', {
        status: 200,
        headers: {
          "content-type": "application/json",
          ...(bodies.length === 1 ? { "request-id": "req_durable" } : {}),
        },
      });
    }) as typeof fetch;
    const createPlugin = async () => {
      const plugin = await ClaudeOAuthPlugin(
        { client: { auth: { set: async () => {} } } } as never,
        { databasePath },
      );
      plugins.push(plugin);
      return {
        plugin,
        options: await plugin.auth!.loader!(async () => OAUTH_AUTH as never, {} as never),
      };
    };
    const send = (options: Record<string, any>) =>
      options.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Claude-Code-Session-Id": "ses_durable" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          messages: [{ role: "user", content: "hi" }],
          metadata: { user_id: JSON.stringify({ device_id: "dev", session_id: "body-attribution" }) },
          max_tokens: 1,
        }),
      });
    try {
      const first = await createPlugin();
      await send(first.options);
      await first.plugin.dispose!();
      const completed = new Database(databasePath, { readonly: true });
      expect((completed.query("SELECT COUNT(*) AS count FROM requests").get() as { count: number }).count).toBe(0);
      completed.close();

      const resumed = await createPlugin();
      await send(resumed.options);
      const resumedBilling = JSON.parse(bodies[1]!).system.find((block: { text?: string }) =>
        block.text?.startsWith("x-anthropic-billing-header:"),
      ).text as string;
      expect(resumedBilling).toContain("cc_prev_req=req_durable");

      await resumed.plugin.event!({
        event: { type: "session.compacted", properties: { sessionID: "ses_durable" } },
      } as never);
      await resumed.plugin.dispose!();

      const afterCompaction = await createPlugin();
      await send(afterCompaction.options);
      const compactedBilling = JSON.parse(bodies[2]!).system.find((block: { text?: string }) =>
        block.text?.startsWith("x-anthropic-billing-header:"),
      ).text as string;
      expect(compactedBilling).not.toContain("cc_prev_req=");
      await afterCompaction.plugin.dispose!();

      const db = new Database(databasePath, { readonly: true });
      try {
        const row = db.query("SELECT * FROM sessions").get() as Record<string, unknown>;
        expect(row.session_id).toBe("ses_durable");
        expect(row.credential_key).toMatch(/^[0-9a-f]{64}$/);
        expect(JSON.stringify(row)).not.toContain(OAUTH_AUTH.accountId);
        expect(row.previous_request_id).toBeNull();
        expect(row.generation).toBe(1);
        expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(2);
        expect(
          (db.query("PRAGMA index_list(sessions)").all() as Array<{ name: string }>).some(
            (index) => index.name === "sessions_by_credential",
          ),
        ).toBe(true);
        const requestIndexes = (db.query("PRAGMA index_list(requests)").all() as Array<{ name: string }>).map(
          (index) => index.name,
        );
        expect(requestIndexes).toContain("requests_by_credential");
        expect(requestIndexes).toContain("requests_by_created_at");
      } finally {
        db.close();
      }
      expect(statSync(databasePath).mode & 0o777).toBe(0o600);
      expect(readdirSync(dir)).toEqual(["claude-oauth.db"]);
    } finally {
      for (const plugin of plugins) {
        try {
          await plugin.dispose!();
        } catch {}
      }
      globalThis.fetch = originalFetch;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("SQLite generation fencing rejects a late response after deletion and row reactivation", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "claude-oauth-request-fence-"));
    const databasePath = path.join(dir, "claude-oauth.db");
    const plugins: Array<Awaited<ReturnType<typeof ClaudeOAuthPlugin>>> = [];
    const bodies: string[] = [];
    let closeStream: (() => void) | undefined;
    let closeResumedStream: (() => void) | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(init?.body as string);
      if (bodies.length === 1) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            closeStream = () => controller.close();
            controller.enqueue(
              new TextEncoder().encode(
                'event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
              ),
            );
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream", "request-id": "req_before_compaction" },
        });
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          closeResumedStream = () => controller.close();
          controller.enqueue(
            new TextEncoder().encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
          );
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream", "request-id": "req_after_compaction" },
      });
    }) as typeof fetch;
    const createPlugin = async () => {
      const plugin = await ClaudeOAuthPlugin(
        { client: { auth: { set: async () => {} } } } as never,
        { databasePath },
      );
      plugins.push(plugin);
      return {
        plugin,
        options: await plugin.auth!.loader!(async () => OAUTH_AUTH as never, {} as never),
      };
    };
    const send = (options: Record<string, any>) =>
      options.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Claude-Code-Session-Id": "ses_fenced" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      });
    try {
      const requester = await createPlugin();
      const staleResponse = await send(requester.options);
      const deleter = await createPlugin();
      await deleter.plugin.event!({
        event: { type: "session.deleted", properties: { info: { id: "ses_fenced" } } },
      } as never);

      const resumed = await createPlugin();
      const resumedResponse = await send(resumed.options);
      closeStream!();
      await staleResponse.text();
      closeResumedStream!();
      await resumedResponse.text();
      const billing = JSON.parse(bodies[1]!).system.find((block: { text?: string }) =>
        block.text?.startsWith("x-anthropic-billing-header:"),
      ).text as string;
      expect(billing).not.toContain("cc_prev_req=req_before_compaction");
    } finally {
      for (const plugin of plugins) {
        try {
          await plugin.dispose!();
        } catch {}
      }
      globalThis.fetch = originalFetch;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("SQLite request sequencing prevents an earlier logical request from winning when it finishes last", async () => {
    const plugin = await ClaudeOAuthPlugin({ client: { auth: { set: async () => {} } } } as never);
    const options = await plugin.auth!.loader!(async () => OAUTH_AUTH as never, {} as never);
    const bodies: string[] = [];
    let resolveFirst: ((response: Response) => void) | undefined;
    let resolveSecond: ((response: Response) => void) | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(init?.body as string);
      if (bodies.length === 1) return new Promise<Response>((resolve) => (resolveFirst = resolve));
      if (bodies.length === 2) return new Promise<Response>((resolve) => (resolveSecond = resolve));
      if (bodies.length === 3) {
        return new Response('{"type":"message"}', {
          status: 200,
          headers: { "content-type": "application/json", "request-id": "req_logical_first_retry" },
        });
      }
      return new Response('{"type":"message"}', { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const send = (logicalRequestId: string) =>
      options.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Claude-Code-Session-Id": "ses_ordered",
          [REQUEST_ID_HEADER]: logicalRequestId,
        },
        body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      });
    try {
      const first = send("11111111-1111-4111-8111-111111111111");
      const second = send("22222222-2222-4222-8222-222222222222");
      while (!resolveFirst || !resolveSecond) await Bun.sleep(1);
      resolveSecond(
        new Response('{"type":"message"}', {
          status: 200,
          headers: { "content-type": "application/json", "request-id": "req_logical_second" },
        }),
      );
      await second;
      await send("11111111-1111-4111-8111-111111111111");
      resolveFirst(
        new Response('{"type":"message"}', {
          status: 200,
          headers: { "content-type": "application/json", "request-id": "req_logical_first" },
        }),
      );
      await first;
      await send("33333333-3333-4333-8333-333333333333");
      const billing = JSON.parse(bodies[3]!).system.find((block: { text?: string }) =>
        block.text?.startsWith("x-anthropic-billing-header:"),
      ).text as string;
      expect(billing).toContain("cc_prev_req=req_logical_second");
      expect(billing).not.toContain("cc_prev_req=req_logical_first");
      expect(billing).not.toContain("cc_prev_req=req_logical_first_retry");
    } finally {
      await plugin.dispose!();
      globalThis.fetch = originalFetch;
    }
  });

  test("an unavailable database falls back to process-local request chaining", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "claude-oauth-request-fallback-"));
    const blocker = path.join(dir, "not-a-directory");
    writeFileSync(blocker, "x");
    const plugin = await ClaudeOAuthPlugin(
      { client: { auth: { set: async () => {} } } } as never,
      { databasePath: path.join(blocker, "claude-oauth.db") },
    );
    const options = await plugin.auth!.loader!(async () => OAUTH_AUTH as never, {} as never);
    const bodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(init?.body as string);
      return new Response('{"type":"message"}', {
        status: 200,
        headers: {
          "content-type": "application/json",
          ...(bodies.length === 1 ? { "request-id": "req_memory_fallback" } : {}),
        },
      });
    }) as typeof fetch;
    const send = () =>
      options.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Claude-Code-Session-Id": "ses_memory_fallback" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      });
    try {
      await send();
      await send();
      const billing = JSON.parse(bodies[1]!).system.find((block: { text?: string }) =>
        block.text?.startsWith("x-anthropic-billing-header:"),
      ).text as string;
      expect(billing).toContain("cc_prev_req=req_memory_fallback");
    } finally {
      await plugin.dispose!();
      globalThis.fetch = originalFetch;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a late response cannot restore stale state after an A-B-A credential cycle", async () => {
    const plugin = await ClaudeOAuthPlugin({ client: { auth: { set: async () => {} } } } as never);
    let auth = { ...OAUTH_AUTH, access: "account-a-token", accountId: "account-a" };
    const options = await plugin.auth!.loader!(async () => auth as never, {} as never);
    const bodies: string[] = [];
    let closeFirstStream: (() => void) | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(init?.body as string);
      if (bodies.length === 1) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            closeFirstStream = () => controller.close();
            controller.enqueue(
              new TextEncoder().encode(
                'event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
              ),
            );
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream", "request-id": "req_stale_a" },
        });
      }
      const requestId = bodies.length === 2 ? "req_account_b" : bodies.length === 3 ? "req_new_a" : "req_final_a";
      return new Response('{"type":"message"}', {
        status: 200,
        headers: { "content-type": "application/json", "request-id": requestId },
      });
    }) as typeof fetch;
    const send = () =>
      options.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Claude-Code-Session-Id": "cycle-session" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      });
    try {
      const staleResponse = await send();
      auth = { ...auth, access: "account-b-token", accountId: "account-b" };
      await send();
      auth = { ...auth, access: "account-a-new-token", accountId: "account-a" };
      await send();
      closeFirstStream!();
      await staleResponse.text();
      await send();
    } finally {
      globalThis.fetch = originalFetch;
    }

    const finalBilling = JSON.parse(bodies[3]!).system.find((block: { text?: string }) =>
      block.text?.startsWith("x-anthropic-billing-header:"),
    ).text as string;
    expect(finalBilling).toContain("cc_prev_req=req_new_a");
    expect(finalBilling).not.toContain("cc_prev_req=req_stale_a");
  });

  test("streaming request ids are not recorded before the response body completes", async () => {
    const options = await makeLoaderFetch();
    const bodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(init?.body as string);
      if (bodies.length === 1) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('event: message_start\ndata: {"type":"message_start"}\n\n'));
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream", "request-id": "req_incomplete" },
        });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    let incomplete: Response | undefined;
    try {
      const send = () =>
        options.fetch!("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "X-Claude-Code-Session-Id": "stream-session" },
          body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
        });
      incomplete = await send();
      await send();
    } finally {
      await incomplete?.body?.cancel();
      globalThis.fetch = originalFetch;
    }
    const secondBilling = JSON.parse(bodies[1]!).system.find((block: { text?: string }) =>
      block.text?.startsWith("x-anthropic-billing-header:"),
    ).text as string;
    expect(secondBilling).not.toContain("cc_prev_req=req_incomplete");
  });

  test("a cleanly truncated SSE response without message_stop does not advance the chain", async () => {
    const options = await makeLoaderFetch();
    const bodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(init?.body as string);
      if (bodies.length === 1) {
        return new Response('event: message_start\ndata: {"type":"message_start"}\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream", "request-id": "req_truncated" },
        });
      }
      return new Response('{"type":"message"}', { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const send = () =>
      options.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Claude-Code-Session-Id": "truncated-session" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      });
    try {
      expect(await (await send()).text()).toContain("message_start");
      await send();
    } finally {
      globalThis.fetch = originalFetch;
    }
    const billing = JSON.parse(bodies[1]!).system.find((block: { text?: string }) =>
      block.text?.startsWith("x-anthropic-billing-header:"),
    ).text as string;
    expect(billing).not.toContain("cc_prev_req=req_truncated");
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
    expect(output.headers["x-claude-oauth-prompt-id"]).toBeUndefined();

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
    expect(system[0]!.text).toBe("You are Claude Code, Anthropic's official CLI for Claude.");
  });

  test("null-body streaming response is returned unchanged", async () => {
    const options = await makeLoaderFetch();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(undefined, { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch;
    try {
      const response = await options.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", [REQUEST_ID_HEADER]: "11111111-2222-3333-4444-555555555555" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "a" }], max_tokens: 1 }),
      });
      expect(response.body).toBeNull();
      expect(response.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
