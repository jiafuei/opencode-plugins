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
    .update(`59cf53e54c78${k}2.1.228`)
    .digest("hex")
    .slice(0, 3);
}

describe("rewriteBody", () => {
  test("injects billing header and SDK instruction as system[0]/system[1]", () => {
    const firstUserText = "hello world, this is the first user message";
    const out = parse(rewriteBody(baseBody, {}).json);
    expect(Array.isArray(out.system)).toBe(true);
    expect(out.system[0].text).toContain(BILLING_PREFIX);
    expect(out.system[0].text).toContain(`cc_version=2.1.228.${expectedVersionSuffix(firstUserText)}`);
    expect(out.system[1].text).toBe("You are Claude Code, Anthropic's official CLI for Claude.");
    expect(out.system[2].text).toBe("You are a coding agent.");
  });

  test("skips billing header and SDK instruction for claude-3-5-haiku", () => {
    const body = baseBody.replace("claude-sonnet-4-6", "claude-3-5-haiku-20241022");
    const out = parse(rewriteBody(body, {}).json);
    expect(JSON.stringify(out.system)).not.toContain(BILLING_PREFIX);
    expect(JSON.stringify(out.system)).not.toContain("Claude Code, Anthropic's official CLI");
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

  test("billing fingerprint uses only the first text block of the first user message", () => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-6",
      messages: [
        { role: "assistant", content: "earlier" },
        {
          role: "user",
          content: [{ type: "text", text: "abcdefgh" }, { type: "text", text: "XYZXYZXYZXYZXYZ" }],
        },
      ],
      max_tokens: 100,
    });
    const out = parse(rewriteBody(body, {}).json);
    // Fingerprint chars come from "abcdefgh" only ('e','h', pad '0'), not the
    // joined multi-block text.
    expect(out.system[0].text).toContain(`cc_version=2.1.228.${expectedVersionSuffix("abcdefgh")}`);
  });

  test("does not duplicate an existing billing block", () => {
    const existing = `${BILLING_PREFIX} cc_version=2.1.228.abc; cc_entrypoint=cli; cch=00000;`;
    const body = JSON.stringify({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "hi" }],
      system: [{ type: "text", text: existing }, { type: "text", text: "You are a coding agent." }],
      max_tokens: 100,
    });
    const out = parse(rewriteBody(body, {}).json);
    expect(out.system).toHaveLength(3);
    expect(out.system.filter((b: any) => b.text.startsWith(BILLING_PREFIX))).toHaveLength(1);
    expect(out.system[0].text).toBe("You are Claude Code, Anthropic's official CLI for Claude.");
  });

  test("attributionHeader false removes billing metadata but keeps the CLI identity", () => {
    const body = JSON.stringify({
      ...parse(baseBody),
      system: [{ type: "text", text: `${BILLING_PREFIX} cc_version=old; cch=abcde;` }],
    });
    const out = parse(rewriteBody(body, { attributionHeader: false }).json);
    expect(JSON.stringify(out.system)).not.toContain(BILLING_PREFIX);
    expect(out.system[0].text).toBe("You are Claude Code, Anthropic's official CLI for Claude.");
  });

  test("inserts an empty tools array for OAuth when the SDK omits tools", () => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 100,
    });
    const out = parse(rewriteBody(body, {}).json);
    expect(out.tools).toEqual([]);
  });

  test("sets metadata.user_id in the CC attribution envelope", () => {
    const out = parse(rewriteBody(baseBody, { sessionId: "ses-123", accountId: "acct-456" }).json);
    const userId = JSON.parse(out.metadata.user_id);
    expect(userId.session_id).toBe("ses-123");
    expect(userId.account_uuid).toBe("acct-456");
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

  test("preserves a JSON user_id envelope with a nonempty session_id", () => {
    const envelope = JSON.stringify({ device_id: "dev", session_id: "body-session" });
    const body = JSON.stringify({ ...parse(baseBody), metadata: { user_id: envelope } });
    const result = rewriteBody(body, { sessionId: "hdr-session", accountId: "acct" });
    expect(parse(result.json).metadata.user_id).toBe(envelope);
    expect(result.sessionId).toBe("body-session");
  });

  test("synthesizes a session when no hook ran and no valid user_id exists", () => {
    const result = rewriteBody(baseBody, {});
    expect(result.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // The synthesized session is the body's metadata session, so the header
    // derived from it cannot diverge from the body.
    expect(JSON.parse(parse(result.json).metadata.user_id).session_id).toBe(result.sessionId);
  });

  test("prefers the preserved user_id session over the hook-provided one (single source of truth)", () => {
    const body = JSON.stringify({ ...parse(baseBody), metadata: { user_id: CLOAKING_USER_ID } });
    const result = rewriteBody(body, { sessionId: "hdr-session", accountId: "acct" });
    expect(result.sessionId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  test("regenerates invalid user_id, preferring the metadata account over the auth account", () => {
    for (const key of ["account_uuid", "accountId", "account_id"]) {
      const body = JSON.stringify({
        ...parse(baseBody),
        metadata: { user_id: "not-a-cc-id", [key]: "meta-acct" },
      });
      const result = rewriteBody(body, { sessionId: "ses-1", accountId: "auth-acct" });
      const userId = JSON.parse(parse(result.json).metadata.user_id);
      expect(userId.session_id).toBe("ses-1");
      expect(userId.account_uuid).toBe("meta-acct");
      expect(result.sessionId).toBe("ses-1");
    }
    // Falls back to the auth account when metadata has none.
    const result = rewriteBody(baseBody, { sessionId: "ses-1", accountId: "auth-acct" });
    expect(JSON.parse(parse(result.json).metadata.user_id).account_uuid).toBe("auth-acct");
  });

  test("adds context_management when thinking is enabled", () => {
    const body = JSON.stringify({ ...parse(baseBody), thinking: { type: "enabled", budget_tokens: 1024 } });
    const out = parse(rewriteBody(body, {}).json);
    expect(out.context_management).toEqual({ edits: [{ type: "clear_thinking_20251015", keep: "all" }] });
  });

  test("adds context_management when thinking is adaptive", () => {
    const body = JSON.stringify({ ...parse(baseBody), thinking: { type: "adaptive" } });
    const out = parse(rewriteBody(body, {}).json);
    expect(out.context_management).toEqual({ edits: [{ type: "clear_thinking_20251015", keep: "all" }] });
  });

  test("omits context_management without thinking", () => {
    const out = parse(rewriteBody(baseBody, {}).json);
    expect(out.context_management).toBeUndefined();
  });

  test("merges the clear-thinking edit into incoming context_management and deduplicates it", () => {
    const incomingCm = {
      edits: [
        { type: "compact_20260112", trigger: { type: "input_tokens", value: 100000 } },
        { type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: 2 } },
        { type: "clear_tool_uses_20250919", trigger: { type: "tool_uses", value: 20 } },
        { type: "some_future_edit_20270101" },
      ],
      custom_field: { passthrough: true },
    };
    const body = JSON.stringify({ ...parse(baseBody), thinking: { type: "enabled", budget_tokens: 1024 }, context_management: incomingCm });
    const out = parse(rewriteBody(body, {}).json);
    // Exactly one canonical clear-thinking edit (incoming variant dropped),
    // all other edits preserved in their original order, extra fields kept.
    expect(out.context_management).toEqual({
      edits: [
        { type: "clear_thinking_20251015", keep: "all" },
        { type: "compact_20260112", trigger: { type: "input_tokens", value: 100000 } },
        { type: "clear_tool_uses_20250919", trigger: { type: "tool_uses", value: 20 } },
        { type: "some_future_edit_20270101" },
      ],
      custom_field: { passthrough: true },
    });
    // The parsed input object must not be mutated.
    expect(incomingCm.edits).toHaveLength(4);
    expect(incomingCm.edits[1]).toEqual({ type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: 2 } });
  });

  test("passes context_management through unchanged without active thinking", () => {
    const cm = { edits: [{ type: "compact_20260112" }, { type: "clear_tool_uses_20250919" }] };
    for (const thinking of [undefined, { type: "disabled" }]) {
      const body = JSON.stringify({ ...parse(baseBody), ...(thinking && { thinking }), context_management: cm });
      const out = parse(rewriteBody(body, {}).json);
      expect(out.context_management).toEqual(cm);
    }
  });

  test("strips thinking display while preserving the active thinking configuration", () => {
    const body = JSON.stringify({
      ...parse(baseBody),
      thinking: { type: "adaptive", display: "summarized", budget_tokens: 2048 },
    });
    expect(parse(rewriteBody(body, {}).json).thinking).toEqual({ type: "adaptive", budget_tokens: 2048 });
  });

  test("rebuilds known keys in canonical order, then extras in original relative order", () => {
    const body = JSON.stringify({
      stream: true,
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      temperature: 1,
      max_tokens: 100,
      fallbacks: [{ model: "claude-sonnet-4-6" }],
      output_config: { effort: "low" },
      model: "claude-sonnet-4-6",
      tools: [],
      messages: [{ role: "user", content: "hi" }],
      metadata: {},
      thinking: { type: "disabled" },
    });
    const keys = Object.keys(parse(rewriteBody(body, {}).json));
    expect(keys).toEqual([
      "model",
      "messages",
      "system",
      "tools",
      "metadata",
      "max_tokens",
      "thinking",
      "temperature",
      "output_config",
      "fallbacks",
      // Known keys first (stream last of them), then remaining keys in their
      // original relative order.
      "stream",
      "tool_choice",
    ]);
  });

  test("string system prompt becomes a text block after the fingerprint blocks", () => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "hi" }],
      system: "Be terse.",
      max_tokens: 1000,
    });
    const out = parse(rewriteBody(body, {}).json);
    expect(out.system.map((b: any) => b.text)).toEqual([
      expect.stringContaining(BILLING_PREFIX),
      "You are Claude Code, Anthropic's official CLI for Claude.",
      "Be terse.",
    ]);
  });

  test("upgrades existing cache breakpoints to Claude Code's one-hour shape", () => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-6",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }],
        },
      ],
      system: [
        { type: "text", text: "Primary", cache_control: { type: "ephemeral" } },
        { type: "text", text: "Project", cache_control: { type: "ephemeral", ttl: "5m" } },
      ],
      tools: [
        {
          name: "lookup",
          description: "Lookup",
          input_schema: { type: "object" },
          cache_control: { type: "ephemeral" },
        },
      ],
      max_tokens: 100,
    });

    const result = rewriteBody(body, {});
    const out = parse(result.json);
    expect(result.hasLongCache).toBe(true);
    expect(out.system[2].cache_control).toEqual({ type: "ephemeral", ttl: "1h", scope: "global" });
    expect(out.system[3].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(out.messages[0].content[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(out.tools[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  test("reports no long cache when the request has no cache breakpoints", () => {
    expect(rewriteBody(baseBody, {}).hasLongCache).toBe(false);
  });
});

describe("buildBetas", () => {
  const UTILITY = [
    "oauth-2025-04-20",
    "interleaved-thinking-2025-05-14",
    "redact-thinking-2026-02-12",
    "thinking-token-count-2026-05-13",
    "context-management-2025-06-27",
    "prompt-caching-scope-2026-01-05",
    "structured-outputs-2025-12-15",
    "fallback-credit-2026-06-01",
  ];
  const AGENT_BASE = [
    "claude-code-20250219",
    "oauth-2025-04-20",
    "interleaved-thinking-2025-05-14",
    "redact-thinking-2026-02-12",
    "thinking-token-count-2026-05-13",
    "context-management-2025-06-27",
    "prompt-caching-scope-2026-01-05",
    "mid-conversation-system-2026-04-07",
  ];

  test("utility profile when there are no tools and no thinking", () => {
    expect(buildBetas(undefined, false, false, null)).toEqual(UTILITY.join(","));
  });

  test("utility profile for explicitly disabled thinking has no effort", () => {
    const betas = buildBetas({ type: "disabled" }, false, false, null).split(",");
    expect(betas).toEqual(UTILITY);
    expect(betas).not.toContain("effort-2025-11-24");
  });

  test("agent profile for tools without thinking: fallback credit but no effort", () => {
    const betas = buildBetas({ type: "disabled" }, true, false, null).split(",");
    expect(betas).toEqual([...AGENT_BASE, "fallback-credit-2026-06-01"]);
    expect(betas).not.toContain("effort-2025-11-24");
  });

  test("agent profile with effort + fallback credit for enabled thinking", () => {
    expect(buildBetas({ type: "enabled", budget_tokens: 1024 }, false, false, null)).toEqual(
      [...AGENT_BASE, "effort-2025-11-24", "fallback-credit-2026-06-01"].join(","),
    );
  });

  test("adaptive thinking counts as active thinking", () => {
    const betas = buildBetas({ type: "adaptive" }, false, false, null).split(",");
    expect(betas).toContain("effort-2025-11-24");
    expect(betas).toContain("fallback-credit-2026-06-01");
  });

  test("adds advanced tool use only when the SDK requested it", () => {
    const withoutAdvanced = buildBetas(undefined, true, false, null).split(",");
    expect(withoutAdvanced).not.toContain("advanced-tool-use-2025-11-20");

    const withAdvanced = buildBetas(undefined, true, false, "advanced-tool-use-2025-11-20").split(",");
    expect(withAdvanced).toEqual([
      ...AGENT_BASE,
      "advanced-tool-use-2025-11-20",
      "fallback-credit-2026-06-01",
    ]);
  });

  test("adds the extended-cache beta when the rewritten body has a one-hour cache", () => {
    const betas = buildBetas(undefined, false, true, null).split(",");
    expect(betas).toEqual([...UTILITY, "extended-cache-ttl-2025-04-11"]);
  });

  test("preserves and deduplicates SDK/caller betas after the profile", () => {
    const incoming = [
      "compact-2026-01-01",
      "fast-mode-2026-02-01",
      // duplicate of a profile entry must not be re-appended
      "prompt-caching-scope-2026-01-05",
      "task-budgets-2026-03-13",
      "fallback-credit-2026-06-01",
    ].join(",");
    const betas = buildBetas({ type: "enabled", budget_tokens: 1024 }, true, false, incoming).split(",");
    expect(betas.slice(0, AGENT_BASE.length + 1)).toEqual([...AGENT_BASE, "effort-2025-11-24"]);
    expect(betas.slice(AGENT_BASE.length + 1)).toEqual([
      "fallback-credit-2026-06-01",
      "compact-2026-01-01",
      "fast-mode-2026-02-01",
      "task-budgets-2026-03-13",
    ]);
  });

  test("strips context-1m even when the caller supplies it", () => {
    const betas = buildBetas(undefined, false, false, "context-1m-2025-08-07,pdfs-2024-09-25").split(",");
    expect(betas).not.toContain("context-1m-2025-08-07");
    expect(betas.slice(UTILITY.length)).toEqual(["pdfs-2024-09-25"]);
  });

  test("strips fine-grained tool streaming while preserving unrelated caller betas", () => {
    const betas = buildBetas(
      undefined,
      false,
      false,
      "fine-grained-tool-streaming-2025-05-14,fast-mode-2026-02-01",
    ).split(",");
    expect(betas).not.toContain("fine-grained-tool-streaming-2025-05-14");
    expect(betas.slice(UTILITY.length)).toEqual(["fast-mode-2026-02-01"]);
  });

  test("strips the SDK's obsolete structured-output beta", () => {
    const betas = buildBetas(undefined, true, false, "structured-outputs-2025-11-13").split(",");
    expect(betas).not.toContain("structured-outputs-2025-11-13");
  });
});

describe("mapStainlessArch", () => {
  test("maps Stainless arch values", () => {
    expect(mapStainlessArch("x64")).toBe("x64");
    expect(mapStainlessArch("amd64")).toBe("x64");
    expect(mapStainlessArch("arm64")).toBe("arm64");
    expect(mapStainlessArch("aarch64")).toBe("arm64");
    expect(mapStainlessArch("386")).toBe("x86");
    expect(mapStainlessArch("x86")).toBe("x86");
    expect(mapStainlessArch("ia32")).toBe("x86");
    expect(mapStainlessArch("sparc64")).toBe("other::sparc64");
    expect(mapStainlessArch("riscv64")).toBe("other::riscv64");
  });

  test("is case-insensitive", () => {
    expect(mapStainlessArch("ARM64")).toBe("arm64");
    expect(mapStainlessArch("AMD64")).toBe("x64");
    expect(mapStainlessArch("Sparc64")).toBe("other::sparc64");
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

  function cch(input: Record<string, any>): string {
    const out = parse(rewriteBody(JSON.stringify(input), {}).json);
    const text = out.system.find((block: any) => block.text?.startsWith(BILLING_PREFIX)).text;
    return text.match(/cch=([0-9a-f]{5})/)![1]!;
  }

  test("matches the canonical normalized-body reference vector", () => {
    expect(cch(body)).toBe("07e75");
  });

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
    expect(applyClaudeToolPrefix("_secret_tool")).toBe("__secret_tool");
    expect(stripClaudeToolPrefix("__secret_tool")).toBe("_secret_tool");
    expect(stripClaudeToolPrefix("plain")).toBe("plain");
    expect(stripClaudeToolPrefix("_plain")).toBe("plain");
  });

  test("never prefixes Anthropic built-in tool names", () => {
    for (const name of ["web_search", "code_execution", "text_editor", "computer"]) {
      expect(applyClaudeToolPrefix(name)).toBe(name);
      expect(stripClaudeToolPrefix(name)).toBe(name);
    }
    expect(applyClaudeToolPrefix("WEB_SEARCH")).toBe("WEB_SEARCH");
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
    expect(out.tools.map((t: any) => t.name)).toEqual([
      "_get_weather",
      "__secret",
      "web_search",
      // Versioned server tools keep their SDK-assigned names.
      "web_search",
      "code_execution",
      "str_replace_based_edit_tool",
      "computer",
      "bash",
    ]);
    expect(out.tool_choice).toEqual({ type: "tool", name: "_get_weather" });
    expect(out.tools.every((tool: any) => tool.eager_input_streaming === undefined)).toBe(true);
    expect(out.tools.slice(0, 3).every((tool: any) => tool.input_schema.additionalProperties === false)).toBe(true);
    const assistant = out.messages[1].content;
    expect(assistant[1]).toEqual({
      type: "tool_use",
      id: "toolu_01",
      name: "_get_weather",
      input: { city: "SF" },
    });
    // Server/MCP tool_use blocks keep their names.
    expect(assistant[2].name).toBe("web_search");
    expect(assistant[3].name).toBe("mcp_tool");
    // tool_result blocks and IDs untouched.
    expect(out.messages[2].content).toEqual([
      { type: "tool_result", tool_use_id: "toolu_01", content: "sunny" },
      { type: "tool_result", tool_use_id: "srv_01", content: "results" },
    ]);
    // Leading-underscore names gain exactly one prefix and round-trip.
    expect(stripClaudeToolPrefix(out.tools[1].name)).toBe("_secret");
  });

  test("omits the default auto tool_choice", () => {
    const body = JSON.stringify({ ...parse(toolBody), tool_choice: { type: "auto" } });
    expect(parse(rewriteBody(body, {}).json).tool_choice).toBeUndefined();
  });

  test("preserves auto tool_choice with non-default behavior", () => {
    const body = JSON.stringify({ ...parse(toolBody), tool_choice: { type: "auto", disable_parallel_tool_use: true } });
    expect(parse(rewriteBody(body, {}).json).tool_choice).toEqual({
      type: "auto",
      disable_parallel_tool_use: true,
    });
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

  test("preserves unrelated event bytes exactly (headers/status are the Response's)", async () => {
    const bytes = new TextEncoder().encode(SSE_PAYLOAD);
    const output = await collect(fragmentedStream(bytes, [5, 29]).pipeThrough(createSseToolNameTransform()));
    const decoded = new TextDecoder().decode(output);
    // Every non-rewritten line is byte-identical to the input.
    for (const line of decoded.split("\n")) {
      if (!line.includes('"content_block_start"')) continue;
      if (!line.includes('"tool_use"')) expect(SSE_PAYLOAD).toContain(line + "\n");
    }
    expect(decoded).toContain('event: ping\ndata: {"type":"ping"}\r\n');
    expect(decoded).toContain('"partial_json":"\\"content_block_start\\""');
  });

  test("emits complete events incrementally without buffering the whole response", async () => {
    const transform = createSseToolNameTransform();
    const reader = transform.readable.getReader();
    const writer = transform.writable.getWriter();
    const bytes = new TextEncoder().encode(SSE_PAYLOAD);
    // The first event (through its blank line) is readable as soon as it has
    // been fed — nothing beyond the current event is buffered.
    const firstBreak = SSE_PAYLOAD.indexOf("\n\n") + 2;
    // The write is not awaited first: TransformStream writes stall until the
    // readable side is being consumed.
    const writeFirst = writer.write(bytes.subarray(0, firstBreak));
    const first = await reader.read();
    await writeFirst;
    expect(new TextDecoder().decode(first.value)).toBe(SSE_PAYLOAD.slice(0, firstBreak));
    // The rest flows through; drain without awaiting writes (backpressure
    // holds them until the readable side consumes).
    const writeRest = writer.write(bytes.subarray(firstBreak));
    writer.close();
    const rest: Uint8Array[] = [first.value!];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      rest.push(value!);
    }
    await writeRest;
    const total = rest.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of rest) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    expect(new TextDecoder().decode(out)).toBe(SSE_EXPECTED);
  });

  test("flushes a final line without a trailing newline", async () => {
    const bytes = new TextEncoder().encode('data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t","name":"_x","input":{}}}');
    const output = await collect(fragmentedStream(bytes, [4]).pipeThrough(createSseToolNameTransform()));
    expect(new TextDecoder().decode(output)).toBe(
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t","name":"x","input":{}}}',
    );
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
    expect(dataLines).toHaveLength(1);
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
    expect(event.message.content[0]).toEqual({ type: "text", text: "hi" });
    expect(event.message.content[1].name).toBe("prefixed");
    expect(event.message.content[1].id).toBe("toolu_10");
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
    expect(error).toBeInstanceOf(Error);
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
    expect(out.content[1].id).toBe("toolu_01");
    expect(out.content[2].name).toBe("_secret");
    expect(out.content[3].name).toBe("web_search");
  });

  test("passes through non-JSON and bodies without content", () => {
    expect(transformJsonToolUseNames('{"type":"error","error":{"type":"overloaded_error"}}')).toBe(
      '{"type":"error","error":{"type":"overloaded_error"}}',
    );
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
      // Streamed names are restored to the logical OpenCode names.
      expect(toolCalls.map((t) => t.toolName)).toEqual(["get_weather", "_secret", "web_search"]);
      expect(toolCalls[0]!.toolCallId).toBe("toolu_01");

      // First request: custom definitions and tool_choice are prefixed; the
      // builtin-named custom tool stays unprefixed; server tools absent here
      // but custom names carry exactly one prefix.
      const first = JSON.parse(captured[0]!.body);
      expect(first.tools.map((t: any) => t.name)).toEqual([
        "_get_weather",
        "__secret",
        "web_search",
      ]);
      expect(first.tools.every((tool: any) => tool.eager_input_streaming === undefined)).toBe(true);
      expect(first.tools.every((tool: any) => tool.input_schema.additionalProperties === false)).toBe(true);
      expect(first.tool_choice).toEqual({ type: "tool", name: "_get_weather" });
      expect(captured[0]!.url).toContain("beta=true");

      // Follow-up request: historical assistant tool_use names are re-prefixed,
      // tool_result blocks and IDs preserved verbatim.
      const second = JSON.parse(captured[1]!.body);
      const assistant = second.messages.find((m: any) => m.role === "assistant");
      const toolUses = assistant.content.filter((b: any) => b.type === "tool_use");
      expect(toolUses.map((b: any) => b.name)).toEqual([
        "_get_weather",
        "__secret",
        "web_search",
      ]);
      expect(toolUses.map((b: any) => b.id)).toEqual(["toolu_01", "toolu_02", "toolu_03"]);
      const toolUser = second.messages.find((m: any) =>
        Array.isArray(m.content) && m.content.some((b: any) => b.type === "tool_result"),
      );
      expect(toolUser.content.filter((b: any) => b.type === "tool_result").map((b: any) => b.tool_use_id)).toEqual([
        "toolu_01",
        "toolu_02",
        "toolu_03",
      ]);
      // cch was patched over the prefixed body (placeholder gone).
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
      expect(result.toolCalls[0]!.toolCallId).toBe("toolu_01");
      expect(result.text).toBe("It is sunny.");
      // Request side was prefixed.
      expect(JSON.parse(captured[0]!.body).tools.map((t: any) => t.name)).toEqual([
        "_get_weather",
        "__secret",
      ]);
      // Non-streaming request keeps stream absent; response JSON was transformed.
      expect(JSON.parse(captured[0]!.body).stream).toBeUndefined();
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

  test("exposes auth methods for anthropic", async () => {
    const plugin = await ClaudeOAuthPlugin({} as never);
    expect(plugin.auth?.provider).toBe("anthropic");
    expect(plugin.auth?.methods.map((m) => m.type)).toEqual(["oauth", "api"]);
    expect(plugin.provider?.id).toBe("anthropic");
  });

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
