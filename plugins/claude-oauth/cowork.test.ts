import { describe, expect, test } from "bun:test";
import {
  buildBetas,
  COWORK_PROFILE,
  rewriteBody,
} from "./wire_format.ts";
import { rewriteCliBody, SDK_CLI_PROFILE } from "./cli_wire.ts";

const baseBody = JSON.stringify({
  model: "claude-sonnet-4-6",
  messages: [
    { role: "user", content: [{ type: "text", text: "hello world, this is the first user message" }] },
  ],
  system: [{ type: "text", text: "You are a coding agent." }],
  max_tokens: 128000,
});

function parse(json: string) {
  return JSON.parse(json) as Record<string, any>;
}

describe("buildBetas with the Cowork profile", () => {
  test("active agents add effort/fallback while caller betas are filtered and deduplicated", () => {
    const betas = buildBetas(
      { type: "enabled", budget_tokens: 1024 },
      true,
      "context-1m-2025-08-07,fast-mode-2026-02-01,oauth-2025-04-20,fast-mode-2026-02-01",
    ).split(",");
    expect(betas).toContain("effort-2025-11-24");
    expect(betas).toContain("fallback-credit-2026-06-01");
    expect(betas).toContain("fast-mode-2026-02-01");
    expect(betas).not.toContain("context-1m-2025-08-07");
    expect(betas.filter((beta) => beta === "oauth-2025-04-20")).toHaveLength(1);
    expect(betas.filter((beta) => beta === "fast-mode-2026-02-01")).toHaveLength(1);
  });
});

describe("rewriteBody with the Cowork profile", () => {
  test("sanitizes only caller system blocks and keeps deterministic fingerprint ordering", () => {
    const userText = "I use OpenCode in my own message; keep https://opencode.ai/docs";
    const out = parse(rewriteBody(JSON.stringify({
      ...parse(baseBody),
      messages: [{ role: "user", content: userText }],
      system: [
        { type: "text", text: "You are OpenCode, an interactive CLI.\n\nFollow repository instructions.\n\n## OpenCode Docs\nhttps://github.com/anomalyco/opencode\n\nUse tools carefully." },
        { type: "text", text: "You are a coding agent operating in the user's workspace." },
      ],
    }), { profile: COWORK_PROFILE }).json);
    expect(out.system.slice(0, 2).map((block: any) => block.text)).toEqual([
      expect.stringContaining("x-anthropic-billing-header:"),
      COWORK_PROFILE.systemInstruction,
    ]);
    expect(out.system.slice(2)).toEqual([{ type: "text", text: "You are a coding agent operating in the user's workspace.\n\nFollow repository instructions.\n\nUse tools carefully." }]);
    expect(out.messages[0].content[0].text).toBe(userText);
    expect(out.max_tokens).toBe(64000);
  });

  test("uses OMP top-level order, emits only user_id metadata, and orders generated user_id fields", () => {
    const input = {
      z_unknown: 1,
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      speed: "fast",
      stop_sequences: ["stop"],
      top_k: 4,
      top_p: 0.9,
      temperature: 0.2,
      stream: true,
      fallbacks: [{ model: "claude-opus-4-8" }],
      output_config: { effort: "high", extra: true },
      context_management: { edits: [] },
      thinking: { type: "disabled" },
      max_tokens: 100,
      metadata: { trace: "drop", account_uuid: "acct" },
      tools: [],
      system: "Useful system text",
      messages: [{ role: "user", content: "hello" }],
      model: "claude-haiku-4-6",
    };
    const out = parse(rewriteBody(JSON.stringify(input), { sessionId: "session", profile: COWORK_PROFILE }).json);
    expect(Object.keys(out)).toEqual([
      "model", "messages", "system", "tools", "metadata", "max_tokens", "thinking", "output_config",
      "fallbacks", "stream", "temperature", "top_p", "top_k", "stop_sequences", "speed", "tool_choice", "z_unknown",
    ]);
    expect(Object.keys(out.metadata)).toEqual(["user_id"]);
    expect(Object.keys(JSON.parse(out.metadata.user_id))).toEqual(["device_id", "session_id", "account_uuid"]);
  });

  test("uses the first user text for Cowork billing even when it is a system reminder", () => {
    const reminder = "<system-reminder>first seed</system-reminder>";
    const out = parse(rewriteBody(JSON.stringify({
      ...parse(baseBody),
      messages: [{ role: "user", content: [{ type: "text", text: reminder }, { type: "text", text: "later" }] }],
    }), { profile: COWORK_PROFILE }).json);
    expect(out.system[0].text).toContain("cc_version=2.1.246.414;");
  });

  test("attributionHeader false suppresses billing/CCH but keeps the Cowork identity", () => {
    const body = JSON.stringify({
      ...parse(baseBody),
      system: [{ type: "text", text: "x-anthropic-billing-header: cc_version=old; cch=abcde;" }],
    });
    const out = parse(rewriteBody(body, { attributionHeader: false, profile: COWORK_PROFILE }).json);
    expect(JSON.stringify(out.system)).not.toContain("x-anthropic-billing-header:");
    expect(out.system[0].text).toBe(COWORK_PROFILE.systemInstruction);
  });

  test("preserves existing billing blocks and patches only their first checksum placeholder", () => {
    for (const checksum of ["cch=abcde;", "cch=00000 cch=00000;"]) {
      const existing = `x-anthropic-billing-header: cc_version=2.1.224.abc; cc_entrypoint=cli; ${checksum}`;
      const out = parse(rewriteBody(JSON.stringify({
        ...parse(baseBody),
        system: [{ type: "text", text: existing }],
      }), {}).json);
      const billing = out.system.filter((block: any) => block.text.startsWith("x-anthropic-billing-header:"));
      expect(billing).toHaveLength(1);
      if (checksum === "cch=abcde;") expect(billing[0].text).toBe(existing);
      else expect(billing[0].text).toMatch(/cc_version=2\.1\.224\.abc; cc_entrypoint=cli; cch=[0-9a-f]{5} cch=00000;/);
    }
  });

  test("preserves the requested streaming mode, including an omitted stream field", () => {
    for (const stream of [true, false, undefined]) {
      const out = parse(rewriteBody(JSON.stringify({ ...parse(baseBody), stream }), {}).json);
      expect(out.stream).toBe(stream);
    }
  });

  test("preserves legacy attribution and surfaces the body session for header alignment", () => {
    const userId = `user_${"a".repeat(64)}_account_11111111-2222-3333-4444-555555555555_session_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`;
    const result = rewriteBody(JSON.stringify({ ...parse(baseBody), metadata: { user_id: userId } }), {
      sessionId: "hdr-session", accountId: "acct",
    });
    expect(parse(result.json).metadata.user_id).toBe(userId);
    expect(result.sessionId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  test("synthesizes a matching body/header session when no hook ran", () => {
    const result = rewriteBody(baseBody, {});
    expect(result.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(JSON.parse(parse(result.json).metadata.user_id).session_id).toBe(result.sessionId);
  });

  test("cloaks custom tools, choice, and history before hashing the final raw body", () => {
    const result = rewriteBody(JSON.stringify({
      ...parse(baseBody),
      messages: [
        { role: "user", content: "weather?" },
        { role: "assistant", content: [
          { type: "tool_use", id: "toolu_01", name: "get_weather", input: { city: "SF" } },
          { type: "server_tool_use", id: "srv_01", name: "web_search", input: {} },
          { type: "mcp_tool_use", id: "mcp_01", name: "mcp_tool", input: {}, server_name: "srv" },
        ] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "sunny" }] },
      ],
      tools: [
        { name: "get_weather", input_schema: { type: "object" }, eager_input_streaming: true },
        { name: "_secret", input_schema: { type: "object" } },
        { name: "web_search", input_schema: { type: "object" } },
        { type: "web_search_20250305", name: "web_search", max_uses: 3 },
        { type: "code_execution_20250522", name: "code_execution" },
        { type: "text_editor_20250429", name: "str_replace_based_edit_tool" },
        { type: "computer_20250124", name: "computer", display_width_px: 1024 },
        { type: "bash_20250124", name: "bash" },
      ],
      tool_choice: { type: "tool", name: "get_weather" },
      metadata: { user_id: JSON.stringify({ device_id: "dev", session_id: "tool-session" }) },
    }), {});
    const out = parse(result.json);
    expect(out.tools.map((tool: any) => tool.name)).toEqual(["_get_weather", "__secret", "web_search", "web_search", "code_execution", "str_replace_based_edit_tool", "computer", "bash"]);
    expect(out.tool_choice).toEqual({ type: "tool", name: "_get_weather" });
    expect(out.messages[1].content.map((block: any) => block.name)).toEqual(["_get_weather", "web_search", "mcp_tool"]);
    const cch = result.json.match(/cch=([0-9a-f]{5})/)![1]!;
    const withPlaceholder = result.json.replace(`cch=${cch}`, "cch=00000");
    const hash = Bun.hash.xxHash64(new TextEncoder().encode(withPlaceholder), 0x4d659218e32a3268n);
    expect((hash & 0xfffffn).toString(16).padStart(5, "0")).toBe(cch);
  });

  test("adds short-cache breakpoints to the last two real messages without touching system/tools or the Continue pad", () => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-6",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "text", text: "answer" }, { type: "thinking", thinking: "reason" }] },
        { role: "user", content: "Continue." },
      ],
      system: [{ type: "text", text: "Cached", cache_control: { type: "ephemeral" } }],
      tools: [{ name: "t", description: "d", input_schema: { type: "object" }, cache_control: { type: "ephemeral" } }],
      max_tokens: 100,
    });
    const result = rewriteBody(body, { profile: COWORK_PROFILE });
    const out = parse(result.json);
    expect(out.system.find((block: any) => block.text === "Cached")).toEqual({
      type: "text", text: "Cached", cache_control: { type: "ephemeral" },
    });
    expect(out.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(out.messages[1].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(out.messages[1].content[1].cache_control).toBeUndefined();
    expect(out.messages[2].content).toBe("Continue.");
    expect(out.tools[0].cache_control).toEqual({ type: "ephemeral" });
  });

  test("recursively normalizes custom schemas, selects strict logical tools, and preserves provider tools", () => {
    const sourceSchema = {
      type: "object",
      properties: {
        path: { type: "string", minLength: 2, format: "regex" },
        rows: { type: "array", minItems: 3, items: { type: "object", properties: { id: { type: "integer", minimum: 1 } } } },
      },
      required: ["path"],
    };
    const providerTool = { type: "web_search_20250305", name: "web_search", input_schema: { unsupported: true } };
    const out = parse(rewriteBody(JSON.stringify({
      ...parse(baseBody),
      tools: [
        { name: "bash", input_schema: sourceSchema },
        { name: "edit", input_schema: { type: "object", properties: {}, oneOf: [{ type: "object" }] } },
        { name: "resolve", input_schema: { type: "object", additionalProperties: { type: "string" } } },
        providerTool,
      ],
    }), { profile: COWORK_PROFILE }).json);
    expect(out.tools[0].strict).toBe(true);
    expect(out.tools[0].input_schema.properties.rows.items.additionalProperties).toBe(false);
    expect(out.tools[0].input_schema.properties.path.description).toContain("minLength: 2");
    expect(out.tools[0].input_schema.properties.rows.description).toContain("minItems: 3");
    expect(out.tools[1].strict).toBeUndefined();
    expect(out.tools[2].input_schema.additionalProperties).toEqual({ type: "string" });
    expect(out.tools[3]).toEqual(providerTool);
  });

  test("applies official Claude model compatibility without confusing release dates", () => {
    const shape = (model: string, extra: Record<string, unknown>) => parse(rewriteBody(JSON.stringify({
      model,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 100,
      temperature: 0.2,
      top_p: 0.8,
      ...extra,
    }), { profile: COWORK_PROFILE }).json);
    const sonnet = shape("claude-sonnet-4-6-20260801", { thinking: { type: "adaptive", display: "summarized" } });
    expect(sonnet.thinking).toEqual({ type: "adaptive" });
    expect(sonnet.context_management).toBeDefined();
    const opus = shape("claude-4-7-opus-20260801", { thinking: { type: "adaptive", display: "summarized" } });
    expect(opus.thinking.display).toBe("summarized");
    expect(opus.temperature).toBeUndefined();
    for (const family of ["fable", "mythos"]) {
      expect(shape(`claude-${family}-5-0`, { tool_choice: { type: "tool", name: "bash" } }).tool_choice).toEqual({ type: "auto" });
    }
    const haiku = shape("claude-haiku-4-6", { thinking: { type: "disabled" } });
    expect(haiku.thinking).toEqual({ type: "disabled" });
    expect(haiku.output_config).toBeUndefined();
    const datedOpus4 = shape("claude-opus-4-20250514", { thinking: { type: "adaptive", display: "summarized" } });
    expect(datedOpus4.thinking).toEqual({ type: "adaptive" });
    const opus5 = shape("claude-opus-5", { thinking: { type: "adaptive", display: "summarized" } });
    expect(opus5.thinking.display).toBe("summarized");
  });

  test("pins adaptive-only thinking off, enforces the thinking budget, and sanitizes lone surrogates", () => {
    const out = parse(rewriteBody(JSON.stringify({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "bad\ud800text" }],
      thinking: { type: "disabled" },
      output_config: { task_budget: 7 },
      max_tokens: 10,
    }), { profile: COWORK_PROFILE }).json);
    expect(out.thinking).toBeUndefined();
    expect(out.output_config).toEqual({ task_budget: 7, effort: "low" });
    expect(out.messages[0].content[0].text).toBe("bad\ufffdtext");

    const budgeted = parse(rewriteBody(JSON.stringify({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled", budget_tokens: 70000 },
      max_tokens: 100,
    }), { profile: COWORK_PROFILE }).json);
    expect(budgeted.max_tokens).toBe(64000);
    expect(budgeted.thinking.budget_tokens).toBe(60000);
  });

  test("active thinking emits OMP's exact single keep-all clear-thinking edit, replacing incoming edits", () => {
    const incoming = {
      edits: [
        { type: "compact_20260112", trigger: { type: "input_tokens", value: 100000 } },
        { type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: 2 } },
      ],
    };
    const body = JSON.stringify({
      ...parse(baseBody),
      thinking: { type: "enabled", budget_tokens: 1024 },
      context_management: incoming,
    });
    const out = parse(rewriteBody(body, { profile: COWORK_PROFILE }).json);
    expect(out.context_management).toEqual({ edits: [{ type: "clear_thinking_20251015", keep: "all" }] });
  });

  test("Cowork device IDs are stable and distinct from sdk-cli for the same account", () => {
    const body = JSON.stringify({ ...parse(baseBody), metadata: {} });
    const out = parse(rewriteBody(body, { accountId: "acct-1", sessionId: "ses-1", profile: COWORK_PROFILE }).json);
    const again = parse(rewriteBody(body, { accountId: "acct-1", sessionId: "ses-2", profile: COWORK_PROFILE }).json);
    const sdk = parse(rewriteCliBody(body, { accountId: "acct-1", sessionId: "ses-1", requestClass: "main" }, true, SDK_CLI_PROFILE).json);
    expect(JSON.parse(out.metadata.user_id).device_id).toBe(JSON.parse(again.metadata.user_id).device_id);
    expect(JSON.parse(out.metadata.user_id).device_id).not.toBe(JSON.parse(sdk.metadata.user_id).device_id);
  });
});
