import { describe, expect, test } from "bun:test";
import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  buildBetas,
  countTokensBetas,
  COWORK_PROFILE,
  rewriteBody,
  resolveSpoofingProfile,
  SDK_CLI_PROFILE,
} from "./wire_format.ts";
import { ClaudeOAuthPlugin } from "./claude_oauth.ts";
import { deriveDeviceId } from "./local_storage.ts";
import { coworkTransport } from "./cowork_fetch.ts";

const OAUTH_AUTH = {
  type: "oauth" as const,
  access: "test-access-token",
  refresh: "test-refresh-token",
  expires: Date.now() + 60 * 60 * 1000,
  accountId: "acct-test-123",
};

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

describe("resolveSpoofingProfile", () => {
  test("defaults to SDK CLI and accepts the legacy profiles", () => {
    expect(resolveSpoofingProfile(undefined)).toBe(SDK_CLI_PROFILE);
    expect(resolveSpoofingProfile("cowork")).toBe(COWORK_PROFILE);
    expect(resolveSpoofingProfile("sdk-cli")).toBe(SDK_CLI_PROFILE);
  });

  test("throws for the removed cli/cli-meka profiles and any unsupported value", () => {
    for (const value of ["cli", "cli-meka", "deskmate", "", null, 42, true]) {
      expect(() => resolveSpoofingProfile(value)).toThrow(/spoofingProfile/);
    }
  });

  test("the unsupported-profile error lists all supported profiles", () => {
    expect(() => resolveSpoofingProfile("cli")).toThrow(/expected "cowork", "sdk-cli", or "ex-machina"/);
  });
});

describe("buildBetas with the Cowork profile", () => {
  test("utility requests get exactly the utility list — no effort/fallback/redact", () => {
    expect(buildBetas(undefined, false, null, COWORK_PROFILE)).toEqual(COWORK_PROFILE.utilityBetas.join(","));
  });

});

describe("countTokensBetas", () => {
  test("Cowork uses its utility profile plus token counting", () => {
    expect(countTokensBetas(COWORK_PROFILE)).toBe(
      [...COWORK_PROFILE.utilityBetas, "token-counting-2024-11-01"].join(","),
    );
  });

});

describe("rewriteBody with the SDK CLI profile", () => {
  test("attributionHeader false keeps SDK CLI identity without billing", () => {
    const out = parse(rewriteBody(baseBody, { attributionHeader: false, profile: SDK_CLI_PROFILE }).json);
    expect(JSON.stringify(out.system)).not.toContain("x-anthropic-billing-header:");
  });

  test("normalizes CCH exactly like pi-black", () => {
    const body = JSON.stringify({
      ...parse(baseBody),
      fallbacks: ["claude-fallback"],
      fallback_credit_token: "credit",
      messages: [{ role: "user", content: [{ type: "text", text: "nested", model: "keep", max_tokens: 7 }] }],
      metadata: { user_id: JSON.stringify({ device_id: "dev", session_id: "sdk-session" }) },
    });
    const result = rewriteBody(body, { profile: SDK_CLI_PROFILE });
    const cch = result.json.match(/cch=([0-9a-f]{5})/)![1]!;
    const withPlaceholder = JSON.parse(result.json.replace(`cch=${cch}`, "cch=00000"));
    withPlaceholder.model = "";
    delete withPlaceholder.max_tokens;
    const hash = Bun.hash.xxHash64(
      new TextEncoder().encode(JSON.stringify(withPlaceholder)),
      BigInt("0x4d659218e32a3268"),
    );
    expect((hash & 0xfffffn).toString(16).padStart(5, "0")).toBe(cch);
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
    const key = [4, 7, 20].map((index) => reminder[index] ?? "0").join("");
    const suffix = new Bun.CryptoHasher("sha256").update(`59cf53e54c78${key}${COWORK_PROFILE.version}`).digest("hex").slice(0, 3);
    expect(out.system[0].text).toContain(`cc_version=${COWORK_PROFILE.version}.${suffix}`);
  });

  test("attributionHeader false suppresses billing/CCH but keeps the Cowork identity", () => {
    const body = JSON.stringify({
      ...parse(baseBody),
      system: [{ type: "text", text: "x-anthropic-billing-header: cc_version=old; cch=abcde;" }],
    });
    const out = parse(rewriteBody(body, { attributionHeader: false, profile: COWORK_PROFILE }).json);
    expect(JSON.stringify(out.system)).not.toContain("x-anthropic-billing-header:");
  });

  test("raw-body CCH hashes the final serialized body with the placeholder in place", () => {
    const body = JSON.stringify({
      ...parse(baseBody),
      temperature: 0.5,
      metadata: { user_id: JSON.stringify({ device_id: "dev", session_id: "s" }) },
    });
    const result = rewriteBody(body, { profile: COWORK_PROFILE });
    const cch = result.json.match(/cch=([0-9a-f]{5})/)![1]!;
    const withPlaceholder = result.json.replace(`cch=${cch}`, "cch=00000");
    const hash = Bun.hash.xxHash64(new TextEncoder().encode(withPlaceholder), BigInt("0x4d659218e32a3268"));
    expect(((hash & 0xfffffn) as bigint).toString(16).padStart(5, "0")).toBe(cch);
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
    expect(Object.values(out.system[0].cache_control ?? {})).not.toContain("global");
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

  test("derives device IDs under OMP's domains, deterministically and distinct from sdk-cli", () => {
    const body = JSON.stringify({ ...parse(baseBody), metadata: {} });
    const out = parse(rewriteBody(body, { accountId: "acct-1", sessionId: "ses-1", profile: COWORK_PROFILE }).json);
    const userId = JSON.parse(out.metadata.user_id);
    expect(userId.device_id).toBe(
      deriveDeviceId("acct-1", "omp-claude-device-id-v1:", "omp-claude-device-id-v2"),
    );
    expect(userId.device_id).not.toBe(deriveDeviceId("acct-1")); // sdk-cli domain
  });
});

// ---------------------------------------------------------------------------
// Integration through the real pinned @ai-sdk/anthropic path
// ---------------------------------------------------------------------------

interface CapturedRequest {
  url: string;
  method?: string;
  /** The exact ordered record handed to the transport. */
  headers: Record<string, string>;
  isHeaderRecord: boolean;
  bodyText: string;
}

function sseResponse(): Response {
  const events: Array<[string, unknown]> = [
    ["message_start", { type: "message_start", message: { id: "msg_test", role: "assistant", content: [], model: "claude-sonnet-4-6", stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello!" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  const payload = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function setupProfileHarness(spoofingProfile: "cowork" | "sdk-cli" = "cowork") {
  const plugin = await ClaudeOAuthPlugin({ client: { auth: { set: async () => {} } } } as never, {
    spoofingProfile,
  });
  const rawLoaderOptions = await plugin.auth!.loader!(async () => OAUTH_AUTH as never, {} as never);

  const captured: CapturedRequest[] = [];
  const originalImpl = coworkTransport.impl;
  coworkTransport.impl = (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(input),
      method: init?.method,
      headers: init?.headers as Record<string, string>,
      isHeaderRecord: !(init?.headers instanceof Headers) && !Array.isArray(init?.headers),
      bodyText: typeof init?.body === "string" ? init.body : new TextDecoder().decode(init?.body as Uint8Array),
    });
    return captured[0]!.bodyText.includes('"stream":true')
      ? sseResponse()
      : new Response(
          JSON.stringify({ id: "msg_test", type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [{ type: "text", text: "Hello!" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
  }) as typeof coworkTransport.impl;

  return {
    plugin,
    rawLoaderOptions,
    captured,
    restore: () => {
      coworkTransport.impl = originalImpl;
    },
  };
}

describe("request capture: cowork profile through the pinned SDK", () => {
  test("reaches the transport with OMP-ordered headers and the Cowork wire shape", async () => {
    const { rawLoaderOptions, captured, restore } = await setupProfileHarness();
    try {
      const anthropic = createAnthropic({
        name: "anthropic",
        apiKey: rawLoaderOptions.apiKey!,
        fetch: rawLoaderOptions.fetch as typeof fetch,
      });
      const result = streamText({
        model: anthropic("claude-sonnet-4-6"),
        system: "You are a coding agent.",
        prompt: "hello world, this is the first user message",
        maxOutputTokens: 128000,
        headers: {
          "X-Claude-Code-Session-Id": "session-cowork-1",
          "x-session-affinity": "ses_opencode",
          "x-session-id": "ses_opencode",
          "x-parent-session-id": "ses_parent",
          "x-api-key": "dummy-must-not-leak",
        },
      });
      expect(await result.text).toBe("Hello!");

      const req = captured[0]!;

      expect(req.isHeaderRecord).toBe(true);
      expect(req.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
      expect(req.headers["User-Agent"]).toBe("claude-cli/2.1.246 (external, claude-desktop)");
      expect(req.headers["Authorization"]).toBe("Bearer test-access-token");
      expect(req.headers["anthropic-beta"]).toBe(COWORK_PROFILE.utilityBetas.join(","));
      for (const absent of ["x-api-key", "x-session-affinity", "x-session-id", "x-parent-session-id", "x-claude-oauth-request-id"]) {
        expect(req.headers[absent]).toBeUndefined();
      }

      const body = JSON.parse(req.bodyText);
      expect(body.max_tokens).toBe(64000);
      expect(body.system[0].text).toContain("cc_entrypoint=claude-desktop;");
      expect(req.bodyText).not.toContain("cc_prev_req=");
    } finally {
      restore();
    }
  });

  test("rejects unsupported spoofingProfile option values at the boundary", async () => {
    await expect(
      ClaudeOAuthPlugin({} as never, { spoofingProfile: "deskmate" } as never),
    ).rejects.toThrow(/spoofingProfile/);
  });

  test("derives restart-stable Cowork UUIDs", async () => {
    const sessionId = async (raw: string) => {
      const plugin = await ClaudeOAuthPlugin({ client: {} } as never, { spoofingProfile: "cowork" });
      const output = { headers: {} as Record<string, string> };
      await plugin["chat.headers"]!({
        model: { providerID: "anthropic" },
        provider: { options: { claudeOAuth: true } },
        sessionID: raw,
      } as never, output as never);
      return { plugin, id: output.headers["X-Claude-Code-Session-Id"]! };
    };
    const coworkA = await sessionId("ses-a");
    const coworkA2 = await sessionId("ses-a");
    const coworkB = await sessionId("ses-b");
    expect(coworkA.id).toBe(coworkA2.id);
    expect(coworkB.id).not.toBe(coworkA.id);
    expect(coworkA.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await coworkA.plugin.event!({ event: { type: "session.deleted", properties: { info: { id: "ses-a" } } } } as never);
    const coworkAfterDelete = await sessionId("ses-a");
    expect(coworkAfterDelete.id).toBe(coworkA.id);
  });
});
