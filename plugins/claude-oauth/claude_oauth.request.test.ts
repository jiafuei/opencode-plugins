import { afterEach, describe, expect, test } from "bun:test";
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
  "interleaved-thinking-2025-05-14",
  "thinking-token-count-2026-05-13",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "structured-outputs-2025-12-15",
];

const AGENT_BASE_BETAS = [
  "claude-code-20250219",
  "interleaved-thinking-2025-05-14",
  "thinking-token-count-2026-05-13",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "mid-conversation-system-2026-04-07",
  "advanced-tool-use-2025-11-20",
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
      headers: { "X-Claude-Code-Session-Id": "session-test-1" },
    });
    expect(await result.text).toBe("Hello!");

    expect(captured).toHaveLength(1);
    const req = captured[0]!;

    expect(req.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(req.method).toBe("POST");
    // OAuth bearer replaces the SDK's dummy x-api-key.
    expect(req.headers["authorization"]).toBe("Bearer test-access-token");
    expect(req.headers["x-api-key"]).toBeUndefined();
    expect(req.headers["user-agent"]).toBe("claude-cli/2.1.220 (external, claude-desktop)");
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
    expect(body.system[0].text).toContain("cc_entrypoint=claude-desktop");
    // cch placeholder must be replaced with the real attestation before send.
    expect(body.system[0].text).not.toContain("cch=00000");
    expect(body.system[0].text).toMatch(/cch=[0-9a-f]{5}/);
    expect(body.system[1].text).toBe("You are a Claude agent, built on Anthropic's Claude Agent SDK.");
    expect(body.system[2].text).toBe("You are a coding agent.");

    const userId = JSON.parse(body.metadata.user_id);
    expect(userId.device_id).toMatch(/^[0-9a-f]{64}$/);
    expect(userId.session_id).toBe("session-test-1");
    expect(userId.account_uuid).toBe("acct-test-123");
  });
});

describe("request capture: non-streaming request", () => {
  test("non-streaming request keeps stream unset and is still fingerprinted", async () => {
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
    expect(body.system[0].text).toContain("x-anthropic-billing-header:");
    expect(body.system[0].text).toMatch(/cch=[0-9a-f]{5}/);
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

  test("SDK context_management passes through unchanged when thinking is off", async () => {
    const { anthropic, captured, fromSdk } = await setupHarness();

    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      prompt: "hi",
      maxOutputTokens: 1000,
      providerOptions: {
        anthropic: { contextManagement: { edits: [{ type: "clear_tool_uses_20250919" }] } },
      },
    });
    await result.text;

    // The SDK serializes context_management into the body it hands the
    // plugin's loader; without active thinking the plugin forwards it as-is.
    const sdkBody = JSON.parse(fromSdk[0]!.bodyText);
    expect(sdkBody.context_management).toEqual({ edits: [{ type: "clear_tool_uses_20250919" }] });

    const body = JSON.parse(captured[0]!.bodyText);
    expect(body.context_management).toEqual({ edits: [{ type: "clear_tool_uses_20250919" }] });
  });

  test("compact edit from the SDK is preserved alongside the clear-thinking edit", async () => {
    const { anthropic, captured, fromSdk } = await setupHarness();

    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      prompt: "hi",
      maxOutputTokens: 1000,
      providerOptions: {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: 1024 },
          contextManagement: {
            edits: [
              { type: "compact_20260112", trigger: { type: "input_tokens", value: 150000 } },
              { type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: 2 } },
            ],
          },
        },
      },
    });
    await result.text;

    const sdkBody = JSON.parse(fromSdk[0]!.bodyText);
    expect(sdkBody.context_management.edits).toEqual([
      { type: "compact_20260112", trigger: { type: "input_tokens", value: 150000 } },
      { type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: 2 } },
    ]);

    // Active thinking guarantees exactly one canonical clear-thinking edit;
    // the SDK's compact edit survives with its fields intact.
    const body = JSON.parse(captured[0]!.bodyText);
    expect(body.context_management).toEqual({
      edits: [
        { type: "clear_thinking_20251015", keep: "all" },
        { type: "compact_20260112", trigger: { type: "input_tokens", value: 150000 } },
      ],
    });
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
    const betas = captured[0]!.headers["anthropic-beta"]!;
    expect(betas.split(",")).toContain("context-management-2025-06-27");
  });

  test("merges SDK-generated betas into the final anthropic-beta header after the profile", async () => {
    const { anthropic, captured, fromSdk } = await setupHarness();

    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      prompt: "hi",
      maxOutputTokens: 1000,
      providerOptions: {
        anthropic: { anthropicBeta: ["fast-mode-2026-02-01"], speed: "fast" },
      },
    });
    await result.text;

    // The SDK emits fast-mode-2026-02-01 in its anthropic-beta header; the
    // plugin preserves it, deduplicated, after the utility profile. Body
    // `speed` survives via the extras passthrough.
    const sdkReq = fromSdk[0]!;
    expect(sdkReq.headers["anthropic-beta"]!.split(",")).toContain("fast-mode-2026-02-01");

    const req = captured[0]!;
    expect(req.headers["anthropic-beta"]!.split(",")).toEqual([...UTILITY_BETAS, "fast-mode-2026-02-01"]);
    expect(JSON.parse(req.bodyText).speed).toBe("fast");
  });

  test("agent profile for tool requests: fallback credit, no effort, SDK structured-outputs beta preserved", async () => {
    const { anthropic, captured } = await setupHarness();

    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      prompt: "hi",
      maxOutputTokens: 1000,
      tools: {
        echo: tool({ inputSchema: z.object({ x: z.string() }), execute: async ({ x }) => x }),
      },
    });
    await result.text;

    // Tools select the agent profile (fallback credit, no effort beta since
    // thinking is off). The pinned SDK's own structured-outputs beta rides
    // along as a deduplicated extra after the profile.
    const req = captured[0]!;
    const betas = req.headers["anthropic-beta"]!.split(",");
    expect(betas.slice(0, 8)).toEqual([...AGENT_BASE_BETAS, "fallback-credit-2026-06-01"]);
    expect(betas).not.toContain("effort-2025-11-24");
    expect(betas).toContain("structured-outputs-2025-11-13");
    const body = JSON.parse(req.bodyText);
    expect(Array.isArray(body.tools) && body.tools.length > 0).toBe(true);
  });

  test("disabled thinking keeps the utility profile: no effort, no fallback credit", async () => {
    const { anthropic, captured } = await setupHarness();

    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      prompt: "hi",
      maxOutputTokens: 1000,
      providerOptions: {
        anthropic: { thinking: { type: "disabled" } },
      },
    });
    await result.text;

    const req = captured[0]!;
    const betas = req.headers["anthropic-beta"]!.split(",");
    expect(betas).toEqual(UTILITY_BETAS);
    expect(betas).not.toContain("effort-2025-11-24");
    expect(betas).not.toContain("fallback-credit-2026-06-01");
    // The pinned SDK omits the thinking field entirely when disabled.
    expect(JSON.parse(req.bodyText).thinking).toBeUndefined();
  });
});

describe("request capture: header parity", () => {
  test("preserves an incoming claude-cli User-Agent verbatim", async () => {
    const { anthropic, captured } = await setupHarness();

    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      prompt: "hi",
      maxOutputTokens: 1000,
      headers: { "User-Agent": "claude-cli/9.9.9 (custom-build)" },
    });
    await result.text;

    // The pinned SDK appends its runtime suffix; the plugin must preserve the
    // whole incoming value verbatim.
    expect(captured[0]!.headers["user-agent"]!.startsWith("claude-cli/9.9.9 (custom-build)")).toBe(true);
  });

  test("preserves a claude-cli UA regardless of casing", async () => {
    const { anthropic, captured } = await setupHarness();

    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      prompt: "hi",
      maxOutputTokens: 1000,
      headers: { "User-Agent": "CLAUDE-CLI/1.2.3" },
    });
    await result.text;

    expect(captured[0]!.headers["user-agent"]!.startsWith("CLAUDE-CLI/1.2.3")).toBe(true);
  });

  test("replaces non-claude-cli User-Agents with the cowork UA", async () => {
    const { anthropic, captured } = await setupHarness();

    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      prompt: "hi",
      maxOutputTokens: 1000,
      headers: { "User-Agent": "my-opencode-client/1.0" },
    });
    await result.text;

    expect(captured[0]!.headers["user-agent"]).toBe("claude-cli/2.1.220 (external, claude-desktop)");
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
