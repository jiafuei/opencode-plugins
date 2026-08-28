import { describe, expect, test } from "bun:test";
import {
  buildExMachinaBillingHeader,
  buildExMachinaHeaders,
  EX_MACHINA_PROFILE,
  mergeExMachinaBetas,
  rewriteExMachinaBody,
  rewriteExMachinaUrl,
  sanitizeExMachinaSystemText,
  unprefixExMachinaName,
} from "./ex_machina_wire.ts";
import {
  createSseToolNameTransform,
  COWORK_PROFILE,
  readBoundedJsonText,
  resolveSpoofingProfile,
  SDK_CLI_PROFILE,
  transformJsonToolUseNames,
  uncloakedResponseHeaders,
} from "./wire_format.ts";
import { ClaudeOAuthPlugin } from "./claude_oauth.ts";
import { coworkTransport } from "./cowork_fetch.ts";

describe("ex-machina profile", () => {
  test("resolver keeps the existing default and accepts all three profile IDs", () => {
    expect(resolveSpoofingProfile(undefined)).toBe(SDK_CLI_PROFILE);
    expect(resolveSpoofingProfile("cowork")).toBe(COWORK_PROFILE);
    expect(resolveSpoofingProfile("sdk-cli")).toBe(SDK_CLI_PROFILE);
    expect(resolveSpoofingProfile("ex-machina")).toBe(EX_MACHINA_PROFILE);
    expect(() => resolveSpoofingProfile("invalid")).toThrow(
      /expected "cowork", "sdk-cli", or "ex-machina"/,
    );
  });

  test("pins production constants and merges required betas first", () => {
    expect(EX_MACHINA_PROFILE).toEqual({
      id: "ex-machina",
      wireFormat: "ex-machina",
      version: "2.1.87",
      userAgent: "claude-cli/2.1.87 (external, cli)",
      billingEntrypoint: "sdk-cli",
      systemInstruction: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
    });
    expect(
      mergeExMachinaBetas("incoming-one,oauth-2025-04-20,incoming-two,incoming-one"),
    ).toBe("oauth-2025-04-20,interleaved-thinking-2025-05-14,incoming-one,incoming-two");
  });

  test("matches the known billing vector", () => {
    expect(buildExMachinaBillingHeader([{ role: "user", content: "hello world test message" }])).toBe(
      "x-anthropic-billing-header: cc_version=2.1.87.6ff; cc_entrypoint=sdk-cli; cch=4ffc3;",
    );
  });
});

describe("ex-machina request transforms", () => {
  test("sanitizes anchored paragraphs and applies first-occurrence replacements", () => {
    const text = [
      "You are OpenCode and this paragraph is removed.",
      "Keep this if OpenCode honestly agrees; if OpenCode honestly repeats.",
      "See github.com/anomalyco/opencode for help.",
      "Here is some useful information about the environment you are running in:",
      "Read opencode.ai/docs for details.",
    ].join("\n\n");
    expect(sanitizeExMachinaSystemText(text)).toBe(
      "Keep this if the assistant honestly agrees; if OpenCode honestly repeats.\n\nEnvironment context you are running in:",
    );
  });

  test("rewrites system and tools without changing unrelated body fields", () => {
    const original = {
      model: "claude-sonnet-4-6",
      messages: [
        { role: "user", content: [{ type: "text", text: "hello world test message" }] },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "tool-1", name: "read_file", input: {} },
            { type: "tool_use", id: "tool-2", name: "", input: {} },
          ],
        },
      ],
      system: [{ type: "text", text: "You are OpenCode.\n\nKeep me." }],
      tools: [
        { type: "function", name: "bash", input_schema: { type: "object" } },
        { name: "read_file", input_schema: { type: "object", additionalProperties: true } },
        { name: "", input_schema: { type: "object" } },
      ],
      tool_choice: { type: "tool", name: "bash" },
      metadata: { user_id: "untouched" },
      max_tokens: 128000,
      thinking: { type: "enabled", budget_tokens: 1000 },
      context_management: { edits: [{ type: "custom" }] },
    };
    const rewritten = JSON.parse(rewriteExMachinaBody(JSON.stringify(original)));
    expect(rewritten.system[0].text).toContain("cc_version=2.1.87.6ff");
    expect(rewritten.system[1].text).toBe(EX_MACHINA_PROFILE.systemInstruction);
    expect(rewritten.system[2].text).toBe("Keep me.");
    expect(rewritten.tools[0].name).toBe("mcp_Bash");
    expect(rewritten.tools[1].name).toBe("mcp_Read_file");
    expect(rewritten.tools[2].name).toBe("");
    expect(rewritten.messages[1].content[0].name).toBe("mcp_Read_file");
    expect(rewritten.messages[1].content[1].name).toBe("");
    expect(rewritten.tool_choice).toEqual(original.tool_choice);
    expect(rewritten.metadata).toEqual(original.metadata);
    expect(rewritten.max_tokens).toBe(128000);
    expect(rewritten.thinking).toEqual(original.thinking);
    expect(rewritten.context_management).toEqual(original.context_management);
    expect(rewritten.tools[1].input_schema.additionalProperties).toBe(true);
  });

  test("normalizes source system shapes and avoids duplicate identity at the front", () => {
    expect(JSON.parse(rewriteExMachinaBody(JSON.stringify({ messages: [] }))).system).toEqual([
      { type: "text", text: EX_MACHINA_PROFILE.systemInstruction },
    ]);
    expect(
      JSON.parse(
        rewriteExMachinaBody(
          JSON.stringify({
            messages: [],
            system: [
              EX_MACHINA_PROFILE.systemInstruction,
              { type: "image", source: "x" },
              7,
            ],
          }),
        ),
      ).system,
    ).toEqual([
      { type: "text", text: EX_MACHINA_PROFILE.systemInstruction },
      { type: "text", text: "[object Object]" },
      { type: "text", text: "7" },
    ]);
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

  test("invalid JSON passes through unchanged", () => {
    expect(rewriteExMachinaBody("not-json")).toBe("not-json");
  });

  test("only messages gains a missing beta query", () => {
    expect(rewriteExMachinaUrl(new URL("https://api.anthropic.com/v1/messages")).search).toBe("?beta=true");
    expect(rewriteExMachinaUrl(new URL("https://api.anthropic.com/v1/messages?beta=false")).search).toBe(
      "?beta=false",
    );
    expect(rewriteExMachinaUrl(new URL("https://api.anthropic.com/v1/messages/count_tokens")).search).toBe("");
  });

  test("strict headers retain only the safe allowlist and pin OAuth values", () => {
    const headers = buildExMachinaHeaders(
      "https://api.anthropic.com/v1/messages",
      {
        Accept: "application/json",
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "anthropic-beta": "caller-beta,oauth-2025-04-20",
        "x-app": "cli",
        "x-stainless-lang": "js",
        Authorization: "Bearer stale",
        "x-api-key": "stale",
        Cookie: "secret",
        "x-client-request-id": "private",
        "x-claude-code-session-id": "private",
        "x-unknown": "drop",
      },
      "access-token",
    );
    expect(Object.fromEntries(headers)).toEqual({
      accept: "application/json",
      authorization: "Bearer access-token",
      "content-type": "application/json",
      "anthropic-beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14,caller-beta",
      "anthropic-dangerous-direct-browser-access": "true",
      "anthropic-version": "2023-06-01",
      "user-agent": EX_MACHINA_PROFILE.userAgent,
      "x-app": "cli",
      "x-stainless-lang": "js",
    });
  });
});

describe("ex-machina response transforms", () => {
  test("recursively uncloaks JSON name properties including StructuredOutput", () => {
    const body = JSON.stringify({
      name: "mcp_Bash",
      nested: [{ name: "mcp_Read_file" }, { input: { name: "mcp_StructuredOutput" } }],
      untouched: { name: "ordinary" },
    });
    expect(JSON.parse(transformJsonToolUseNames(body, "mcp_", unprefixExMachinaName))).toEqual({
      name: "bash",
      nested: [{ name: "read_file" }, { input: { name: "StructuredOutput" } }],
      untouched: { name: "ordinary" },
    });
  });

  test("handles arbitrary fragmented SSE and removes stale transformed-response headers", async () => {
    const source = 'event: custom\ndata: {"outer":{"name":"mcp_Bash"},"items":[{"name":"mcp_StructuredOutput"}]}\n\n';
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const char of source) controller.enqueue(new TextEncoder().encode(char));
        controller.close();
      },
    });
    const text = await new Response(
      input.pipeThrough(createSseToolNameTransform("mcp_", unprefixExMachinaName)),
    ).text();
    expect(text).toContain('"name":"bash"');
    expect(text).toContain('"name":"StructuredOutput"');

    const response = new Response("{}", {
      headers: { "content-type": "application/json", "content-length": "2", etag: "old", "x-safe": "yes" },
    });
    const bounded = await readBoundedJsonText(response.clone());
    expect(bounded).toBe("{}");
    const headers = uncloakedResponseHeaders(response);
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("etag")).toBeNull();
    expect(headers.get("x-safe")).toBe("yes");
  });
});

describe("ex-machina integration dispatch", () => {
  test("uses global fetch, never coworkTransport, and recursively transforms JSON", async () => {
    const originalFetch = globalThis.fetch;
    const originalTransport = coworkTransport.impl;
    let captured: { url: string; init?: RequestInit } | undefined;
    let coworkCalls = 0;
    coworkTransport.impl = async () => {
      coworkCalls++;
      throw new Error("cowork transport must not run");
    };
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ nested: { name: "mcp_Read_file" } }), {
        headers: { "content-type": "application/json", etag: "stale" },
      });
    }) as typeof fetch;
    try {
      const plugin = await ClaudeOAuthPlugin(
        { client: { auth: { set: async () => {} } } } as never,
        { spoofingProfile: "ex-machina" },
      );
      const loader = await plugin.auth!.loader!(
        async () => ({
          type: "oauth",
          access: "access-token",
          refresh: "refresh-token",
          expires: Date.now() + 60_000,
        }) as never,
        {} as never,
      );
      const response = await loader.fetch!("https://api.anthropic.com/v1/messages?beta=false", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-claude-code-session-id": "drop",
          "x-client-request-id": "drop",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello world test message" }],
          max_tokens: 100000,
        }),
      });
      expect(coworkCalls).toBe(0);
      expect(captured!.url).toBe("https://api.anthropic.com/v1/messages?beta=false");
      expect(new Headers(captured!.init!.headers).get("x-claude-code-session-id")).toBeNull();
      expect(new Headers(captured!.init!.headers).get("x-client-request-id")).toBeNull();
      expect(JSON.parse(captured!.init!.body as string).max_tokens).toBe(100000);
      expect(await response.json()).toEqual({ nested: { name: "read_file" } });
      expect(response.headers.get("etag")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      coworkTransport.impl = originalTransport;
    }
  });
});
