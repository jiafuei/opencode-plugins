import { describe, expect, test } from "bun:test";
import {
  buildExMachinaHeaders,
  EX_MACHINA_PROFILE,
  rewriteExMachinaBody,
} from "./ex_machina_wire.ts";
import { setupPlugin } from "./test_harness.ts";

describe("ex-machina request transforms", () => {
  test("rewrites system and tools without changing unrelated body fields", () => {
    const original = {
      model: "claude-sonnet-4-6",
      messages: [
        { role: "user", content: [{ type: "text", text: "hello world test message" }] },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "tool-1", name: "read_file", input: {} },
          ],
        },
      ],
      system: [{ type: "text", text: [
        "You are OpenCode and this paragraph is removed.",
        "Keep this if OpenCode honestly agrees; if OpenCode honestly repeats.",
        "See github.com/anomalyco/opencode for help.",
        "Here is some useful information about the environment you are running in:",
        "Read opencode.ai/docs for details.",
      ].join("\n\n") }],
      tools: [
        { type: "function", name: "bash", input_schema: { type: "object" } },
        { name: "read_file", input_schema: { type: "object", additionalProperties: true } },
      ],
      tool_choice: { type: "tool", name: "bash" },
      metadata: { user_id: "untouched" },
      max_tokens: 128000,
      thinking: { type: "enabled", budget_tokens: 1000 },
      context_management: { edits: [{ type: "custom" }] },
    };
    const rewritten = JSON.parse(rewriteExMachinaBody(JSON.stringify(original)));
    expect(rewritten.system[0].text).toBe("x-anthropic-billing-header: cc_version=2.1.87.6ff; cc_entrypoint=sdk-cli; cch=4ffc3;");
    expect(rewritten.system[1].text).toBe(EX_MACHINA_PROFILE.systemInstruction);
    expect(rewritten.system[2].text).toBe("Keep this if the assistant honestly agrees; if OpenCode honestly repeats.\n\nEnvironment context you are running in:");
    expect(rewritten.tools[0].name).toBe("mcp_Bash");
    expect(rewritten.tools[1].name).toBe("mcp_Read_file");
    expect(rewritten.messages[1].content[0].name).toBe("mcp_Read_file");
    expect(rewritten.tool_choice).toEqual(original.tool_choice);
    expect(rewritten.metadata).toEqual(original.metadata);
    expect(rewritten.max_tokens).toBe(128000);
    expect(rewritten.thinking).toEqual(original.thinking);
    expect(rewritten.context_management).toEqual(original.context_management);
    expect(rewritten.tools[1].input_schema.additionalProperties).toBe(true);
  });

  test("billing requires a user message and attributionHeader only suppresses billing", () => {
    const noUser = JSON.parse(rewriteExMachinaBody(JSON.stringify({ messages: [{ role: "assistant", content: "x" }] })));
    expect(noUser.system).toEqual([{ type: "text", text: EX_MACHINA_PROFILE.systemInstruction }]);
    const disabled = JSON.parse(
      rewriteExMachinaBody(
        JSON.stringify({ messages: [{ role: "user", content: "hello" }], tools: [{ name: "bash" }] }),
        false,
      ),
    );
    expect(disabled.system).toEqual([{ type: "text", text: EX_MACHINA_PROFILE.systemInstruction }]);
    expect(disabled.tools[0].name).toBe("mcp_Bash");
  });

  test("strict headers retain only the safe allowlist and pin OAuth values", () => {
    const headers = buildExMachinaHeaders(
      new Headers({
        Accept: "application/json",
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "anthropic-beta": "incoming-one,oauth-2025-04-20,incoming-two,incoming-one",
        "x-app": "cli",
        "x-stainless-lang": "js",
        Authorization: "Bearer access-token",
        "x-api-key": "stale",
        Cookie: "secret",
        "x-client-request-id": "private",
        "x-claude-code-session-id": "private",
        "x-unknown": "drop",
      }),
    );
    expect(Object.fromEntries(headers)).toEqual({
      accept: "application/json",
      authorization: "Bearer access-token",
      "content-type": "application/json",
      "anthropic-beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14,incoming-one,incoming-two",
      "anthropic-dangerous-direct-browser-access": "true",
      "anthropic-version": "2023-06-01",
      "user-agent": EX_MACHINA_PROFILE.userAgent,
      "x-app": "cli",
      "x-stainless-lang": "js",
    });
  });
});

describe("ex-machina integration dispatch", () => {
  test("keeps allowlisted headers, uncloaks fragmented SSE, and removes stale response headers", async () => {
    const { send } = await setupPlugin({ spoofingProfile: "ex-machina" });
    const source = 'event: custom\ndata: {"outer":{"name":"mcp_Bash"},"items":[{"name":"mcp_StructuredOutput"}]}\n\n' +
      'data: {"type":"content_block_start","content_block":{"type":"tool_use","name":"mcp_Read_file"}}\n\n';
    const { request, response } = await send(
      {
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "hello world test message" }],
        tools: [{ name: "read_file", input_schema: { type: "object" } }],
        max_tokens: 100000,
        stream: true,
      },
      () => new Response(new ReadableStream({
        start(controller) {
          for (const char of source) controller.enqueue(new TextEncoder().encode(char));
          controller.close();
        },
      }), { headers: { "content-type": "text/event-stream", "content-length": String(source.length), etag: "stale", "x-safe": "yes" } }),
    );
    expect(request.headers.get("x-claude-code-session-id")).toBeNull();
    expect(request.headers.get("x-client-request-id")).toBeNull();
    expect(request.headers.get("x-session-affinity")).toBeNull();
    expect(request.headers.get("authorization")).toBe("Bearer test-access-token");
    expect(request.headers.get("user-agent")).toBe(EX_MACHINA_PROFILE.userAgent);
    expect(await response.text()).toBe(source
      .replace('"name":"mcp_Bash"', '"name":"bash"')
      .replace('"name":"mcp_StructuredOutput"', '"name":"StructuredOutput"')
      .replace('"name":"mcp_Read_file"', '"name":"read_file"'));
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("x-safe")).toBe("yes");
  });
});
