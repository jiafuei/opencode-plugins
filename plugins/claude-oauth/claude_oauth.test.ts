import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { streamText, tool, stepCountIs, generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import {
  applyClaudeToolPrefix,
  buildBetas,
  ClaudeOAuthPlugin,
  createSseToolNameTransform,
  mapStainlessArch,
  rewriteBody,
  stripClaudeToolPrefix,
  transformJsonToolUseNames,
} from "./claude_oauth.ts";
import { SDK_CLI_PROFILE } from "./wire_format.ts";
import { coworkTransport } from "./cowork_fetch.ts";

const BILLING_PREFIX = "x-anthropic-billing-header:";

const baseBody = JSON.stringify({
  model: "claude-sonnet-4-6",
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: "hello world, this is the first user message" }],
    },
  ],
  system: [{ type: "text", text: "You are a coding agent." }],
  max_tokens: 128000,
});

function parse(json: string) {
  return JSON.parse(json) as Record<string, any>;
}

// The billing fingerprint must match CC's computeFingerprint:
// sha256(salt + msg[4] + msg[7] + msg[20] + version)[:3]
function expectedVersionSuffix(text: string): string {
  const k = [4, 7, 20]
    .map((i) => text[i] ?? "0")
    .join("");
  return createHash("sha256")
    .update(`59cf53e54c78${k}${SDK_CLI_PROFILE.version}`)
    .digest("hex")
    .slice(0, 3);
}

describe("rewriteBody", () => {
  test("injects billing and the profile identity ahead of the caller system", () => {
    const firstUserText = "hello world, this is the first user message";
    const out = parse(rewriteBody(baseBody, {}).json);
    expect(out.system[0].text).toContain(BILLING_PREFIX);
    expect(out.system[0].text).toContain(`cc_version=${SDK_CLI_PROFILE.version}.${expectedVersionSuffix(firstUserText)}`);
    expect(out.system[1].text).toBe(SDK_CLI_PROFILE.systemInstruction);
    expect(out.system[2].text).toBe("You are a coding agent.");
  });

  test("clamps max_tokens to 64000", () => {
    const out = parse(rewriteBody(baseBody, {}).json);
    expect(out.max_tokens).toBe(64000);
  });

  test("preserves the incoming stream value instead of forcing true", () => {
    expect(parse(rewriteBody(JSON.stringify({ ...parse(baseBody), stream: true }), {}).json).stream).toBe(true);
    expect(parse(rewriteBody(JSON.stringify({ ...parse(baseBody), stream: false }), {}).json).stream).toBe(false);
    // Omitted stream stays omitted (non-streaming SDK requests).
    expect(parse(rewriteBody(baseBody, {}).json).stream).toBeUndefined();
  });

  test("billing fingerprint skips leading system-reminder text blocks", () => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-6",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "<system-reminder>metadata</system-reminder>" },
            { type: "text", text: "actual user prompt" },
          ],
        },
      ],
      max_tokens: 100,
    });
    const out = parse(rewriteBody(body, {}).json);
    expect(out.system[0].text).toContain(`cc_version=2.1.224.${expectedVersionSuffix("actual user prompt")}`);
  });

  test("does not duplicate an existing billing block", () => {
    const existing = `${BILLING_PREFIX} cc_version=2.1.224.abc; cc_entrypoint=cli; cch=00000;`;
    const body = JSON.stringify({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "hi" }],
      system: [{ type: "text", text: existing }, { type: "text", text: "You are a coding agent." }],
      max_tokens: 100,
    });
    const out = parse(rewriteBody(body, {}).json);
    expect(out.system.filter((b: any) => b.text.startsWith(BILLING_PREFIX))).toHaveLength(1);
  });

  test("attributionHeader false removes billing metadata but keeps the profile identity", () => {
    const body = JSON.stringify({
      ...parse(baseBody),
      system: [{ type: "text", text: `${BILLING_PREFIX} cc_version=old; cch=abcde;` }],
    });
    const out = parse(rewriteBody(body, { attributionHeader: false }).json);
    expect(JSON.stringify(out.system)).not.toContain(BILLING_PREFIX);
    expect(out.system[0].text).toBe(SDK_CLI_PROFILE.systemInstruction);
  });

  test("sets metadata.user_id in the CC attribution envelope", () => {
    const out = parse(rewriteBody(baseBody, { sessionId: "ses-123", accountId: "acct-456" }).json);
    const userId = JSON.parse(out.metadata.user_id);
    expect(userId.device_id).toMatch(/^[0-9a-f]{64}$/);
  });

  const CLOAKING_USER_ID =
    `user_${"a".repeat(64)}_account_11111111-2222-3333-4444-555555555555` +
    `_session_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`;

  test("preserves a valid legacy cloaking user_id verbatim", () => {
    const body = JSON.stringify({ ...parse(baseBody), metadata: { user_id: CLOAKING_USER_ID } });
    const result = rewriteBody(body, { sessionId: "hdr-session", accountId: "acct" });
    const out = parse(result.json);
    expect(out.metadata.user_id).toBe(CLOAKING_USER_ID);
    // The body session is surfaced so Step 5 can align the session header.
    expect(result.sessionId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  test("synthesizes a session when no hook ran and no valid user_id exists", () => {
    const result = rewriteBody(baseBody, {});
    expect(result.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // The synthesized session is the body's metadata session, so the header
    // derived from it cannot diverge from the body.
    expect(JSON.parse(parse(result.json).metadata.user_id).session_id).toBe(result.sessionId);
  });

  test("adds context_management when thinking is enabled", () => {
    const body = JSON.stringify({ ...parse(baseBody), thinking: { type: "enabled", budget_tokens: 1024 } });
    const out = parse(rewriteBody(body, {}).json);
    expect(out.context_management).toEqual({ edits: [{ type: "clear_thinking_20251015", keep: "all" }] });
  });

  test("omits context_management without thinking", () => {
    const out = parse(rewriteBody(baseBody, {}).json);
    expect(out.context_management).toBeUndefined();
  });

  test("preserves thinking display and the active thinking configuration", () => {
    const body = JSON.stringify({
      ...parse(baseBody),
      thinking: { type: "adaptive", display: "summarized", budget_tokens: 2048 },
    });
    expect(parse(rewriteBody(body, {}).json).thinking).toEqual({
      type: "adaptive",
      display: "summarized",
      budget_tokens: 2048,
    });
  });

});

describe("buildBetas", () => {
  const UTILITY = [...SDK_CLI_PROFILE.utilityBetas, "fallback-credit-2026-06-01"];
  const AGENT_BASE = [...SDK_CLI_PROFILE.agentBetas];

  test("utility profile when there are no tools and no thinking", () => {
    expect(buildBetas(undefined, false)).toEqual(UTILITY.join(","));
  });

  test("active agent requests add effort while unsafe caller betas are stripped", () => {
    const betas = buildBetas(
      { type: "enabled", budget_tokens: 1024 },
      true,
      "context-1m-2025-08-07,fast-mode-2026-02-01",
    ).split(",");
    expect(betas).toEqual([...AGENT_BASE, "effort-2025-11-24", "fallback-credit-2026-06-01", "fast-mode-2026-02-01"]);
  });
});

describe("mapStainlessArch", () => {
  test("maps Stainless arch values", () => {
    expect(mapStainlessArch("amd64")).toBe("x64");
    expect(mapStainlessArch("aarch64")).toBe("arm64");
    expect(mapStainlessArch("ia32")).toBe("x86");
    expect(mapStainlessArch("sparc64")).toBe("other::sparc64");
    expect(mapStainlessArch("ARM64")).toBe("arm64");
  });
});

describe("rewriteBody cch", () => {
  const billingHeader = "x-anthropic-billing-header: cch=00000;";
  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 64000,
    messages: [{ role: "user", content: "hello" }],
    fallback_credit_token: "credit",
    system: [{ type: "text", text: billingHeader }],
    tools: [],
    metadata: { user_id: JSON.stringify({ device_id: "dev", session_id: "session" }) },
    fallbacks: [{ model: "claude-opus-4-6" }],
    stream: true,
  };

  test("leaves an existing billing value without a placeholder unchanged", () => {
    const existing = billingHeader.replace("cch=00000", "cch=abcde");
    const out = parse(rewriteBody(JSON.stringify({ ...body, system: [{ type: "text", text: existing }] }), {}).json);
    expect(out.system.find((block: any) => block.text?.startsWith(BILLING_PREFIX)).text).toBe(existing);
  });

  test("replaces only the first placeholder in the billing block", () => {
    const repeated = billingHeader.replace(";", " cch=00000;");
    const out = parse(rewriteBody(JSON.stringify({ ...body, system: [{ type: "text", text: repeated }] }), {}).json);
    expect(out.system.find((block: any) => block.text?.startsWith(BILLING_PREFIX)).text).toMatch(
      /cch=[0-9a-f]{5} cch=00000/,
    );
  });
});

describe("tool name prefix helpers", () => {
  test("round-trips logical names through apply/strip exactly once", () => {
    for (const name of ["get_weather", "_secret_tool", "nested_tool", "a"]) {
      expect(stripClaudeToolPrefix(applyClaudeToolPrefix(name))).toBe(name);
    }
    expect(applyClaudeToolPrefix("web_search")).toBe("web_search");
  });
});

describe("rewriteBody tool name cloaking", () => {
  const toolBody = JSON.stringify({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "checking" },
          { type: "tool_use", id: "toolu_01", name: "get_weather", input: { city: "SF" } },
          { type: "server_tool_use", id: "srv_01", name: "web_search", input: {} },
          { type: "mcp_tool_use", id: "mcp_01", name: "mcp_tool", input: {}, server_name: "srv" },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_01", content: "sunny" },
          { type: "tool_result", tool_use_id: "srv_01", content: "results" },
        ],
      },
    ],
    tools: [
      {
        name: "get_weather",
        description: "d",
        input_schema: { type: "object" },
        eager_input_streaming: true,
      },
      { name: "_secret", description: "d", input_schema: { type: "object" } },
      { name: "web_search", description: "d", input_schema: { type: "object" } },
      // Server tools carry versioned types and must stay untouched.
      { type: "web_search_20250305", name: "web_search", max_uses: 3 },
      { type: "code_execution_20250522", name: "code_execution" },
      { type: "text_editor_20250429", name: "str_replace_based_edit_tool" },
      { type: "computer_20250124", name: "computer", display_width_px: 1024 },
      { type: "bash_20250124", name: "bash" },
    ],
    tool_choice: { type: "tool", name: "get_weather" },
    metadata: { user_id: JSON.stringify({ device_id: "dev", session_id: "tool-session" }) },
    max_tokens: 100,
  });

  test("prefixes custom tool definitions, tool_choice, and historical tool_use names", () => {
    const out = parse(rewriteBody(toolBody, {}).json);
    expect(out.tools.map((t: any) => t.name)).toEqual(["_get_weather", "__secret", "web_search", "web_search", "code_execution", "str_replace_based_edit_tool", "computer", "bash"]);
    expect(out.tool_choice).toEqual({ type: "tool", name: "_get_weather" });
    const assistant = out.messages[1].content;
    expect(assistant[1].name).toBe("_get_weather");
    expect(assistant[2].name).toBe("web_search");
    expect(assistant[3].name).toBe("mcp_tool");
  });

  test("cch hashes custom tool prefixes as retained request content", () => {
    const json = rewriteBody(toolBody, {}).json;
    expect(json).toContain('"name":"_get_weather"');
    const cch = json.match(/cch=([0-9a-f]{5})/)?.[1]!;
    const changed = rewriteBody(toolBody.replaceAll("get_weather", "other_tool"), {}).json;
    expect(changed.match(/cch=([0-9a-f]{5})/)?.[1]).not.toBe(cch);
  });
});

// ---------------------------------------------------------------------------
// SSE response uncloaking
// ---------------------------------------------------------------------------

// Each entry is one complete SSE event (framed with a blank line); CRLF/LF
// framing alternates like a real mixed stream.
const SSE_EVENTS = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
  "event: ping\ndata: {\"type\":\"ping\"}",
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"checking the weather"}}',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
  'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01","name":"_get_weather","input":{}}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"SF\\"}"}}',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}',
  'event: content_block_start\ndata: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_02","name":"__secret","input":{}}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"NY\\"}"}}',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":2}',
  'event: content_block_start\ndata: {"type":"content_block_start","index":3,"content_block":{"type":"tool_use","id":"toolu_03","name":"web_search","input":{}}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"LA\\"}"}}',
  // A delta whose JSON payload merely contains the marker string must survive untouched.
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"\\"content_block_start\\""}}',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":3}',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":25}}',
  'event: message_stop\ndata: {"type":"message_stop"}',
];

const SSE_PAYLOAD = SSE_EVENTS.map((event, i) => event + (i % 3 === 1 ? "\r\n\r\n" : "\n\n")).join("");

// The same payload with tool_use names uncloaked — the expected output bytes.
const SSE_EXPECTED = SSE_PAYLOAD
  .replace('"name":"_get_weather"', '"name":"get_weather"')
  .replace('"name":"__secret"', '"name":"_secret"');

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function fragmentedStream(bytes: Uint8Array, sizes: number[]): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const size = sizes[offset % sizes.length]!;
      controller.enqueue(bytes.subarray(offset, Math.min(offset + size, bytes.length)));
      offset += size;
    },
  });
}

describe("createSseToolNameTransform", () => {
  test("restores tool names across arbitrary chunk boundaries and mixed CRLF/LF", async () => {
    const bytes = new TextEncoder().encode(SSE_PAYLOAD);
    for (const sizes of [[1], [3], [7, 1, 13], [64], [bytes.length]]) {
      const output = await collect(
        fragmentedStream(bytes, sizes).pipeThrough(createSseToolNameTransform()),
      );
      expect(new TextDecoder().decode(output)).toBe(SSE_EXPECTED);
    }
  });

  test("leaves malformed data lines untouched", async () => {
    const bytes = new TextEncoder().encode('data: not-json{"type":"content_block_start"\n\n');
    const output = await collect(fragmentedStream(bytes, [3]).pipeThrough(createSseToolNameTransform()));
    expect(new TextDecoder().decode(output)).toBe('data: not-json{"type":"content_block_start"\n\n');
  });

  test("joins multiple data: lines per SSE rules before JSON parsing and rewrites as one", async () => {
    const payload =
      'data: {"type":"content_block_start","index":9,\n' +
      'data: "content_block":{"type":"tool_use","id":"toolu_09","name":"_split_name","input":{}}}\n' +
      "\n";
    const output = await collect(
      fragmentedStream(new TextEncoder().encode(payload), [13]).pipeThrough(createSseToolNameTransform()),
    );
    const dataLines = new TextDecoder().decode(output).split("\n").filter((line) => line.startsWith("data:"));
    expect(JSON.parse(dataLines[0]!.slice("data: ".length))).toEqual({
      type: "content_block_start",
      index: 9,
      content_block: { type: "tool_use", id: "toolu_09", name: "split_name", input: {} },
    });
  });

  test("uncloaks tool_use names in message_start.message.content blocks", async () => {
    const payload =
      'event: message_start\n' +
      'data: {"type":"message_start","message":{"id":"msg_ms","role":"assistant","content":[' +
      '{"type":"text","text":"hi"},' +
      '{"type":"tool_use","id":"toolu_10","name":"_prefixed","input":{}}' +
      ']}}\r\n\r\n';
    const output = await collect(
      fragmentedStream(new TextEncoder().encode(payload), [17]).pipeThrough(createSseToolNameTransform()),
    );
    const dataLine = new TextDecoder()
      .decode(output)
      .split("\n")
      .find((line) => line.startsWith("data:"))!;
    const event = JSON.parse(dataLine.slice("data: ".length));
    expect(event.message.content[1].name).toBe("prefixed");
  });

  test("fails clearly when a partial event exceeds the assembly cap", async () => {
    // No blank line: the record never completes and keeps growing.
    const payload = `data: "${"x".repeat(2 * 1024 * 1024)}"\n`;
    let error: unknown;
    try {
      await collect(
        fragmentedStream(new TextEncoder().encode(payload), [4096]).pipeThrough(createSseToolNameTransform()),
      );
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toMatch(/exceeded.*bytes/i);
  });
});

describe("transformJsonToolUseNames", () => {
  test("strips exactly one prefix from non-streaming tool_use names, preserving ids", () => {
    const body = JSON.stringify({
      id: "msg_02",
      type: "message",
      role: "assistant",
      content: [
        { type: "text", text: "hi" },
        { type: "tool_use", id: "toolu_01", name: "_get_weather", input: { city: "SF" } },
        { type: "tool_use", id: "toolu_02", name: "__secret", input: {} },
        { type: "tool_use", id: "toolu_03", name: "web_search", input: {} },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    const out = JSON.parse(transformJsonToolUseNames(body));
    expect(out.content[1].name).toBe("get_weather");
    expect(out.content[2].name).toBe("_secret");
    expect(out.content[3].name).toBe("web_search");
  });

  test("passes through non-JSON and bodies without content", () => {
    expect(transformJsonToolUseNames("not json at all")).toBe("not json at all");
  });
});

// ---------------------------------------------------------------------------
// Real SDK integration through the plugin's OAuth fetch
// ---------------------------------------------------------------------------

describe("SDK integration: tool name cloaking through plugin fetch", () => {
  const OAUTH_AUTH = {
    type: "oauth" as const,
    access: "test-access-token",
    refresh: "test-refresh-token",
    expires: Date.now() + 60 * 60 * 1000,
    accountId: "acct-test-123",
  };

  function sseResponse(): Response {
    const bytes = new TextEncoder().encode(SSE_PAYLOAD);
    // Fragment at awkward offsets: mid-name, mid-line, across CRLF pairs.
    return new Response(fragmentedStream(bytes, [11, 1, 37, 3]), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  function finalTextResponse(): Response {
    const payload = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_03","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":20,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"It is sunny."}}',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}',
      'event: message_stop\ndata: {"type":"message_stop"}',
    ].join("\n\n");
    return new Response(fragmentedStream(new TextEncoder().encode(payload + "\n\n"), [9, 2, 23]), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  const JSON_RESPONSE = JSON.stringify({
    id: "msg_02",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: [
      { type: "text", text: "It is sunny." },
      { type: "tool_use", id: "toolu_01", name: "_get_weather", input: { city: "SF" } },
      { type: "tool_use", id: "toolu_02", name: "__secret", input: {} },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 25 },
  });

  /** Loader + mocked upstream: returns the plugin-wrapped fetch for the SDK. */
  async function wrappedFetch(captured: { url: string; body: string }[], responder: (url: string, body: string) => Response) {
    const plugin = await ClaudeOAuthPlugin({ client: { auth: { set: async () => {} } } } as never);
    const options = await plugin.auth!.loader!(async () => OAUTH_AUTH as never, {} as never);
    const originalFetch = globalThis.fetch;
    const originalTransport = coworkTransport.impl;
    const mock = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? init.body : new TextDecoder().decode(init?.body as Uint8Array);
      captured.push({ url, body });
      return responder(url, body);
    }) as typeof fetch;
    globalThis.fetch = mock;
    coworkTransport.impl = (input, init) => globalThis.fetch(input, init);
    return {
      // The SDK must go through the plugin's OAuth fetch wrapper.
      fetch: options.fetch!,
      restore: () => {
        globalThis.fetch = originalFetch;
        coworkTransport.impl = originalTransport;
      },
    };
  }

  const weatherTool = tool({
    description: "Get the weather",
    inputSchema: z.object({ city: z.string() }),
    execute: async () => "sunny",
  });

  test("streaming: request names prefixed, streamed names restored, and builtins untouched", async () => {
    const captured: { url: string; body: string }[] = [];
    const { fetch: doFetch, restore } = await wrappedFetch(captured, (_url, body) =>
      body.includes('"tool_result"') ? finalTextResponse() : sseResponse(),
    );
    try {
      const anthropic = createAnthropic({ apiKey: "unused", fetch: doFetch });
      const result = streamText({
        model: anthropic("claude-sonnet-4-6"),
        messages: [{ role: "user", content: "weather and secrets?" }],
        tools: {
          get_weather: weatherTool,
          _secret: weatherTool,
          web_search: weatherTool,
        },
        toolChoice: { type: "tool", toolName: "get_weather" },
        stopWhen: stepCountIs(3),
      });
      const toolCalls: { toolName: string; toolCallId: string }[] = [];
      for await (const part of result.fullStream) {
        if (part.type === "tool-call") toolCalls.push({ toolName: part.toolName, toolCallId: part.toolCallId });
      }
      expect(toolCalls.map((t) => t.toolName)).toEqual(["get_weather", "_secret", "web_search"]);

      const first = JSON.parse(captured[0]!.body);
      expect(first.tools.map((t: any) => t.name)).toEqual(["_get_weather", "__secret", "web_search"]);
      expect(first.tool_choice).toEqual({ type: "tool", name: "_get_weather" });

      const second = JSON.parse(captured[1]!.body);
      const assistant = second.messages.find((m: any) => m.role === "assistant");
      const toolUses = assistant.content.filter((b: any) => b.type === "tool_use");
      expect(toolUses.map((b: any) => b.name)).toEqual(["_get_weather", "__secret", "web_search"]);
      expect(captured[1]!.body).not.toContain("cch=00000");
    } finally {
      restore();
    }
  });

  test("non-streaming JSON: tool_use names restored to logical names", async () => {
    const captured: { url: string; body: string }[] = [];
    const { fetch: doFetch, restore } = await wrappedFetch(captured, () =>
      new Response(JSON_RESPONSE, { status: 200, headers: { "content-type": "application/json" } }),
    );
    try {
      const anthropic = createAnthropic({ apiKey: "unused", fetch: doFetch });
      const result = await generateText({
        model: anthropic("claude-sonnet-4-6"),
        messages: [{ role: "user", content: "weather?" }],
        tools: { get_weather: weatherTool, _secret: weatherTool },
      });
      expect(result.toolCalls.map((c) => c.toolName)).toEqual(["get_weather", "_secret"]);
      expect(result.text).toBe("It is sunny.");
      expect(JSON.parse(captured[0]!.body).tools.map((t: any) => t.name)).toEqual(["_get_weather", "__secret"]);
    } finally {
      restore();
    }
  });
});

describe("plugin hooks", () => {
  const OAUTH_AUTH = {
    type: "oauth" as const,
    access: "test-access-token",
    refresh: "test-refresh-token",
    expires: Date.now() + 60 * 60 * 1000,
    accountId: "acct-test-123",
  };

  test("loader is inert without oauth auth", async () => {
    const plugin = await ClaudeOAuthPlugin({} as never);
    const options = await plugin.auth!.loader!(async () => ({ type: "api", key: "sk-ant-api" }) as never, {} as never);
    expect(options).toEqual({});
  });

  test("appends beta=true to the official /messages OAuth URL, preserving existing query params", async () => {
    const plugin = await ClaudeOAuthPlugin({ client: { auth: { set: async () => {} } } } as never);
    const options = await plugin.auth!.loader!(async () => OAUTH_AUTH as never, {} as never);
    const capturedUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    const originalTransport = coworkTransport.impl;
    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrls.push(String(input));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    coworkTransport.impl = (input, init) => globalThis.fetch(input, init);
    try {
      await options.fetch!("https://api.anthropic.com/v1/messages?foo=bar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [], max_tokens: 1, stream: false }),
      });
    } finally {
      globalThis.fetch = originalFetch;
      coworkTransport.impl = originalTransport;
    }
    expect(capturedUrls).toEqual(["https://api.anthropic.com/v1/messages?foo=bar&beta=true"]);
  });
});
