import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  applyClaudeToolPrefix,
  buildBetas,
  countTokensBetas,
  createSseToolNameTransform,
  COWORK_PROFILE,
  mapStainlessArch,
  rewriteBody,
  resolveSpoofingProfile,
  SDK_CLI_PROFILE,
  stripClaudeToolPrefix,
  transformJsonToolUseNames,
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

/** Expected version fingerprint suffix for the Cowork version. */
function expectedVersionSuffix(text: string, version = COWORK_PROFILE.version): string {
  const k = [4, 7, 20]
    .map((i) => text[i] ?? "0")
    .join("");
  return createHash("sha256")
    .update(`59cf53e54c78${k}${version}`)
    .digest("hex")
    .slice(0, 3);
}

describe("resolveSpoofingProfile", () => {
  test("defaults to SDK CLI and accepts only cowork/sdk-cli", () => {
    expect(resolveSpoofingProfile(undefined)).toBe(SDK_CLI_PROFILE);
    expect(resolveSpoofingProfile("cowork")).toBe(COWORK_PROFILE);
    expect(resolveSpoofingProfile("sdk-cli")).toBe(SDK_CLI_PROFILE);
  });

  test("throws for the removed cli/cli-meka profiles and any unsupported value", () => {
    for (const value of ["cli", "cli-meka", "deskmate", "", null, 42, true]) {
      expect(() => resolveSpoofingProfile(value)).toThrow(/spoofingProfile/);
    }
  });

  test("the unsupported-profile error lists only cowork/sdk-cli", () => {
    expect(() => resolveSpoofingProfile("cli")).toThrow(/expected "cowork" or "sdk-cli"/);
  });
});

describe("Cowork profile constants", () => {
  test("mirror OMP's current Cowork fingerprint", () => {
    expect(COWORK_PROFILE.version).toBe("2.1.220");
    expect(COWORK_PROFILE.userAgent).toBe("claude-cli/2.1.220 (external, claude-desktop)");
    expect(COWORK_PROFILE.billingEntrypoint).toBe("claude-desktop");
    expect(COWORK_PROFILE.systemInstruction).toBe("You are a Claude agent, built on Anthropic's Claude Agent SDK.");
    expect(COWORK_PROFILE.toolPrefix).toBe("_");
    expect(COWORK_PROFILE.stainlessPackageVersion).toBe("0.94.0");
    expect(COWORK_PROFILE.cchMode).toBe("raw");
    // OMP's Cowork betas omit oauth/redact entirely.
    expect(COWORK_PROFILE.utilityBetas).toEqual([
      "interleaved-thinking-2025-05-14",
      "thinking-token-count-2026-05-13",
      "context-management-2025-06-27",
      "prompt-caching-scope-2026-01-05",
      "structured-outputs-2025-12-15",
    ]);
    expect(COWORK_PROFILE.agentBetas).toEqual([
      "claude-code-20250219",
      "interleaved-thinking-2025-05-14",
      "thinking-token-count-2026-05-13",
      "context-management-2025-06-27",
      "prompt-caching-scope-2026-01-05",
      "mid-conversation-system-2026-04-07",
      "advanced-tool-use-2025-11-20",
    ]);
  });

  test("mirrors pi-black's SDK CLI identity without Claude config discovery", () => {
    expect(SDK_CLI_PROFILE.version).toBe("2.1.224");
    expect(SDK_CLI_PROFILE.userAgent).toBe("claude-cli/2.1.224 (external, sdk-cli)");
    expect(SDK_CLI_PROFILE.billingEntrypoint).toBe("sdk-cli");
    expect(SDK_CLI_PROFILE.systemInstruction).toBe("You are a Claude agent, built on Anthropic's Claude Agent SDK.");
    expect(SDK_CLI_PROFILE.toolPrefix).toBe("_");
    expect(SDK_CLI_PROFILE.cchMode).toBe("sdk-normalized");
  });
});

describe("buildBetas with the Cowork profile", () => {
  test("utility requests get exactly the utility list — no effort/fallback/oauth/redact", () => {
    expect(buildBetas(undefined, false, null, COWORK_PROFILE)).toEqual(COWORK_PROFILE.utilityBetas.join(","));
  });

  test("agent requests append fallback credit; thinking adds effort", () => {
    expect(buildBetas({ type: "disabled" }, true, null, COWORK_PROFILE)).toEqual(
      [...COWORK_PROFILE.agentBetas, "fallback-credit-2026-06-01"].join(","),
    );
    expect(buildBetas({ type: "enabled", budget_tokens: 1024 }, false, null, COWORK_PROFILE)).toEqual(
      [...COWORK_PROFILE.agentBetas, "effort-2025-11-24", "fallback-credit-2026-06-01"].join(","),
    );
  });

  test("advanced-tool-use arrives via the agent base and is never duplicated", () => {
    const betas = buildBetas(undefined, true, "advanced-tool-use-2025-11-20", COWORK_PROFILE).split(",");
    expect(betas.filter((beta) => beta === "advanced-tool-use-2025-11-20")).toHaveLength(1);
  });

  test("long cache never advertises the extended-cache beta", () => {
    const betas = buildBetas(undefined, false, null, COWORK_PROFILE).split(",");
    expect(betas).not.toContain("extended-cache-ttl-2025-04-11");
  });

  test("caller betas still dedupe after the profile and stripped betas stay stripped", () => {
    const incoming = "fast-mode-2026-02-01,context-1m-2025-08-07,prompt-caching-scope-2026-01-05";
    expect(buildBetas(undefined, false, incoming, COWORK_PROFILE)).toEqual(
      [...COWORK_PROFILE.utilityBetas, "fast-mode-2026-02-01"].join(","),
    );
  });
});

describe("countTokensBetas", () => {
  test("defaults to the SDK CLI utility profile plus token counting", () => {
    expect(countTokensBetas()).toBe(
      [...SDK_CLI_PROFILE.utilityBetas, "token-counting-2024-11-01"].join(","),
    );
  });

  test("Cowork uses its utility profile plus token counting", () => {
    expect(countTokensBetas(COWORK_PROFILE)).toBe(
      [...COWORK_PROFILE.utilityBetas, "token-counting-2024-11-01"].join(","),
    );
  });

  test("SDK CLI includes its Claude Code/OAuth utility profile plus token counting", () => {
    expect(countTokensBetas(SDK_CLI_PROFILE)).toBe(
      [...SDK_CLI_PROFILE.utilityBetas, "token-counting-2024-11-01"].join(","),
    );
    expect(SDK_CLI_PROFILE.utilityBetas.slice(0, 2)).toEqual([
      "claude-code-20250219",
      "oauth-2025-04-20",
    ]);
  });
});

describe("rewriteBody with the SDK CLI profile", () => {
  test("injects pi-black billing and Agent SDK identity for every model", () => {
    for (const model of ["claude-sonnet-4-6", "claude-3-5-haiku-latest"]) {
      const out = parse(rewriteBody(JSON.stringify({ ...parse(baseBody), model }), { profile: SDK_CLI_PROFILE }).json);
      expect(out.system[0].text).toContain("cc_version=2.1.224.");
      expect(out.system[0].text).toContain("cc_entrypoint=sdk-cli;");
      expect(out.system[0].text).not.toContain("cc_prev_req=");
      expect(out.system[0].text).not.toContain("cc_prompt_id=");
      expect(out.system[1].text).toBe("You are a Claude agent, built on Anthropic's Claude Agent SDK.");
    }
  });

  test("attributionHeader false keeps SDK CLI identity without billing", () => {
    const out = parse(rewriteBody(baseBody, { attributionHeader: false, profile: SDK_CLI_PROFILE }).json);
    expect(JSON.stringify(out.system)).not.toContain("x-anthropic-billing-header:");
    expect(out.system[0].text).toBe("You are a Claude agent, built on Anthropic's Claude Agent SDK.");
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
    expect(result.json).toContain('"fallbacks":["claude-fallback"]');
    expect(result.json).toContain('"fallback_credit_token":"credit"');
  });

  test("uses plugin-derived identity and preserves SDK fields", () => {
    const body = JSON.stringify({
      ...parse(baseBody),
      metadata: {},
      thinking: { type: "adaptive", display: "summarized" },
      tools: [{ name: "lookup", input_schema: { type: "object" }, eager_input_streaming: true }],
    });
    const out = parse(rewriteBody(body, {
      accountId: "acct-sdk",
      sessionId: "session-sdk",
      profile: SDK_CLI_PROFILE,
    }).json);
    expect(out.thinking.display).toBe("summarized");
    expect(out.tools[0]).toMatchObject({ name: "_lookup", eager_input_streaming: true });
    expect(JSON.parse(out.metadata.user_id)).toEqual({
      device_id: deriveDeviceId("acct-sdk"),
      account_uuid: "acct-sdk",
      session_id: "session-sdk",
    });
  });
});

describe("rewriteBody with the Cowork profile", () => {
  test("injects the Agent SDK identity and claude-desktop billing entrypoint", () => {
    const firstUserText = "hello world, this is the first user message";
    const out = parse(rewriteBody(baseBody, { profile: COWORK_PROFILE }).json);
    expect(out.system[0].text).toContain(`cc_version=2.1.220.${expectedVersionSuffix(firstUserText)}`);
    expect(out.system[0].text).toContain("cc_entrypoint=claude-desktop;");
    expect(out.system[1].text).toBe("You are a Claude agent, built on Anthropic's Claude Agent SDK.");
    expect(out.system[2].text).toBe("You are a coding agent.");
  });

  test("attributionHeader false suppresses billing/CCH but keeps the Cowork identity", () => {
    const body = JSON.stringify({
      ...parse(baseBody),
      system: [{ type: "text", text: "x-anthropic-billing-header: cc_version=old; cch=abcde;" }],
    });
    const out = parse(rewriteBody(body, { attributionHeader: false, profile: COWORK_PROFILE }).json);
    expect(JSON.stringify(out.system)).not.toContain("x-anthropic-billing-header:");
    expect(out.system[0].text).toBe("You are a Claude agent, built on Anthropic's Claude Agent SDK.");
    expect(out.system[0].text).not.toMatch(/cch=[0-9a-f]{5}/);
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

  test("uses the `_` tool prefix and round-trips through response uncloaking", async () => {
    const toolBody = JSON.stringify({
      model: "claude-sonnet-4-6",
      messages: [
        { role: "user", content: "weather?" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_01", name: "get_weather", input: { city: "SF" } },
            { type: "tool_use", id: "toolu_02", name: "_secret", input: {} },
          ],
        },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "sunny" }] },
      ],
      tools: [
        {
          name: "get_weather",
          description: "d",
          input_schema: { type: "object" },
          eager_input_streaming: true,
        },
        { name: "_secret", description: "d", input_schema: { type: "object" } },
      ],
      tool_choice: { type: "tool", name: "get_weather" },
      max_tokens: 100,
    });
    const out = parse(rewriteBody(toolBody, { profile: COWORK_PROFILE }).json);
    expect(out.tools.map((t: any) => t.name)).toEqual(["_get_weather", "__secret"]);
    expect(out.tools[0].eager_input_streaming).toBe(true); // SDK field preserved
    expect(out.tools.every((t: any) => t.input_schema.additionalProperties === false)).toBe(true);
    expect(out.tool_choice).toEqual({ type: "tool", name: "_get_weather" });
    expect(out.messages[1].content[0].name).toBe("_get_weather");

    // Response side strips exactly one `_`.
    const json = JSON.stringify({
      type: "message",
      content: [
        { type: "tool_use", id: "toolu_01", name: "_get_weather", input: {} },
        { type: "tool_use", id: "toolu_02", name: "__secret", input: {} },
        { type: "tool_use", id: "toolu_03", name: "web_search", input: {} },
      ],
    });
    const restored = JSON.parse(transformJsonToolUseNames(json, COWORK_PROFILE.toolPrefix));
    expect(restored.content.map((b: any) => b.name)).toEqual(["get_weather", "_secret", "web_search"]);

    // SSE path likewise, across fragmented chunks.
    const payload =
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t","name":"_get_weather","input":{}}}\n\n';
    const chunks = payload.match(/.{1,7}/gs)!.map((chunk) => new TextEncoder().encode(chunk));
    const fragmented = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const output = await new Response(fragmented.pipeThrough(createSseToolNameTransform(COWORK_PROFILE.toolPrefix))).text();
    expect(output).toContain('"name":"get_weather"');
    // Prefix helpers agree.
    expect(stripClaudeToolPrefix(applyClaudeToolPrefix("lookup", "_"), "_")).toBe("lookup");
    expect(stripClaudeToolPrefix("plain", "_")).toBe("plain");
  });

  test("preserves thinking.display instead of stripping it", () => {
    const body = JSON.stringify({
      ...parse(baseBody),
      thinking: { type: "adaptive", display: "summarized" },
    });
    expect(parse(rewriteBody(body, { profile: COWORK_PROFILE }).json).thinking).toEqual({
      type: "adaptive",
      display: "summarized",
    });
  });

  test("does not upgrade cache breakpoints or globally scope the first system block", () => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }] }],
      system: [{ type: "text", text: "Cached", cache_control: { type: "ephemeral" } }],
      tools: [{ name: "t", description: "d", input_schema: { type: "object" }, cache_control: { type: "ephemeral" } }],
      max_tokens: 100,
    });
    const result = rewriteBody(body, { profile: COWORK_PROFILE });
    const out = parse(result.json);
    expect(out.system[0].cache_control ?? out.system.find((b: any) => b.text === "Cached").cache_control).toEqual(
      out.system.find((b: any) => b.text === "Cached").cache_control,
    );
    expect(Object.values(out.system[0].cache_control ?? {})).not.toContain("global");
    expect(out.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(out.tools[0].cache_control).toEqual({ type: "ephemeral" });
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
    // Incoming object not mutated.
    expect(incoming.edits).toHaveLength(2);

    // Without active thinking, an incoming context_management passes through.
    const passive = JSON.stringify({ ...parse(baseBody), context_management: incoming });
    expect(parse(rewriteBody(passive, { profile: COWORK_PROFILE }).json).context_management).toEqual(incoming);
  });

  test("derives device IDs under OMP's domains, deterministically and distinct from sdk-cli", () => {
    const body = JSON.stringify({ ...parse(baseBody), metadata: {} });
    const out = parse(rewriteBody(body, { accountId: "acct-1", sessionId: "ses-1", profile: COWORK_PROFILE }).json);
    const userId = JSON.parse(out.metadata.user_id);
    expect(userId.device_id).toBe(
      deriveDeviceId("acct-1", "omp-claude-device-id-v1:", "omp-claude-device-id-v2"),
    );
    expect(userId.device_id).not.toBe(deriveDeviceId("acct-1")); // sdk-cli domain
    // Deterministic per account/install domain.
    const again = parse(rewriteBody(body, { accountId: "acct-1", sessionId: "ses-2", profile: COWORK_PROFILE }).json);
    expect(JSON.parse(again.metadata.user_id).device_id).toBe(userId.device_id);
    // No-account variant uses the install-hash domain.
    const anon = parse(rewriteBody(baseBody, { profile: COWORK_PROFILE }).json);
    expect(JSON.parse(anon.metadata.user_id).device_id).toBe(
      deriveDeviceId(undefined, "omp-claude-device-id-v1:", "omp-claude-device-id-v2"),
    );
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

      expect(captured).toHaveLength(1);
      const req = captured[0]!;

      // The transport was actually engaged (record headers, official URL).
      expect(req.isHeaderRecord).toBe(true);
      expect(req.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
      expect(req.method).toBe("POST");

      // Exact OMP-ordered header construction.
      expect(Object.keys(req.headers)).toEqual([
        "Accept",
        "Content-Type",
        "User-Agent",
        "X-Claude-Code-Session-Id",
        "X-Stainless-Arch",
        "X-Stainless-Lang",
        "X-Stainless-OS",
        "X-Stainless-Package-Version",
        "X-Stainless-Retry-Count",
        "X-Stainless-Runtime",
        "X-Stainless-Runtime-Version",
        "X-Stainless-Timeout",
        "anthropic-beta",
        "anthropic-dangerous-direct-browser-access",
        "anthropic-version",
        "Authorization",
        "x-app",
        "x-client-request-id",
        "Connection",
        "Accept-Encoding",
      ]);
      expect(req.headers["User-Agent"]).toBe("claude-cli/2.1.220 (external, claude-desktop)");
      expect(req.headers["X-Stainless-Package-Version"]).toBe("0.94.0");
      expect(req.headers["X-Stainless-Arch"]).toBe(mapStainlessArch(process.arch));
      expect(req.headers["Authorization"]).toBe("Bearer test-access-token");
      expect(req.headers["x-app"]).toBe("cli");
      expect(req.headers["x-client-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(req.headers["anthropic-beta"]).toBe(COWORK_PROFILE.utilityBetas.join(","));
      expect(req.headers["X-Claude-Code-Session-Id"]).toBe("session-cowork-1");
      // Internal routing and private markers never reach the wire.
      for (const absent of ["x-api-key", "x-session-affinity", "x-session-id", "x-parent-session-id", "x-claude-oauth-request-id"]) {
        expect(req.headers[absent]).toBeUndefined();
      }

      const body = JSON.parse(req.bodyText);
      expect(body.max_tokens).toBe(64000);
      expect(body.stream).toBe(true);
      expect(body.system[0].text).toContain("cc_version=2.1.220.");
      expect(body.system[0].text).toContain("cc_entrypoint=claude-desktop;");
      expect(body.system[0].text).toMatch(/cch=[0-9a-f]{5};$/);
      expect(body.system[0].text).not.toContain("cch=00000");
      expect(body.system[1].text).toBe("You are a Claude agent, built on Anthropic's Claude Agent SDK.");
      expect(body.system[2].text).toBe("You are a coding agent.");
      // No CLI billing-chain state anywhere in the cowork body.
      expect(req.bodyText).not.toContain("cc_prev_req=");
      expect(req.bodyText).not.toContain("cc_prompt_id=");

      const userId = JSON.parse(body.metadata.user_id);
      expect(userId.account_uuid).toBe("acct-test-123");
      expect(userId.session_id).toBe("session-cowork-1");
      expect(userId.device_id).toBe(deriveDeviceId("acct-test-123", "omp-claude-device-id-v1:", "omp-claude-device-id-v2"));
    } finally {
      restore();
    }
  });

  test("sequential successful responses never create cc_prev_req state", async () => {
    const { plugin, rawLoaderOptions, captured, restore } = await setupProfileHarness();
    try {
      for (let index = 0; index < 2; index++) {
        await rawLoaderOptions.fetch!("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "X-Claude-Code-Session-Id": "ses_cowork_chain" },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1,
            stream: false,
          }),
        });
      }
      expect(captured).toHaveLength(2);
      for (const req of captured) {
        const body = JSON.parse(req.bodyText);
        const billing = body.system.find((block: { text?: string }) =>
          block.text?.startsWith("x-anthropic-billing-header:"),
        );
        expect(billing.text).not.toContain("cc_prev_req=");
        expect(billing.text).toContain("cc_entrypoint=claude-desktop;");
      }

      // And chat.headers allocates session/request markers but no prompt id.
      const output = { headers: {} as Record<string, string> };
      await plugin["chat.headers"]!(
        {
          model: { providerID: "anthropic" },
          provider: { options: { claudeOAuth: true } },
          sessionID: "ses_cowook_headers",
          message: { id: "msg_1" },
        } as never,
        output as never,
      );
      expect(output.headers["X-Claude-Code-Session-Id"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(output.headers["x-claude-oauth-session-id"]).toBe("ses_cowook_headers");
      expect(output.headers["x-claude-oauth-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(output.headers["x-claude-oauth-prompt-id"]).toBeUndefined();
    } finally {
      restore();
      await plugin.dispose!();
    }
  });

  test("rejects unsupported spoofingProfile option values at the boundary", async () => {
    await expect(
      ClaudeOAuthPlugin({} as never, { spoofingProfile: "deskmate" } as never),
    ).rejects.toThrow(/spoofingProfile/);
  });
});

describe("request capture: shared ordered transport", () => {
  test("routes SDK CLI through the custom transport with its exact identity", async () => {
    const selected = SDK_CLI_PROFILE;
    const { plugin, rawLoaderOptions, captured, restore } = await setupProfileHarness(selected.id);
    try {
      await rawLoaderOptions.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "claude-cli/9.9.9 (external, wrong-profile)",
          "X-Claude-Code-Session-Id": `session-${selected.id}`,
          "x-unknown-outbound": "profile-specific",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          messages: [{ role: "user", content: "hello" }],
          max_tokens: 1,
          stream: false,
        }),
      });
      const request = captured[0]!;
      expect(request.isHeaderRecord).toBe(true);
      expect(Object.keys(request.headers)).toEqual([
        "Accept",
        "Authorization",
        "Content-Type",
        "User-Agent",
        "X-Claude-Code-Session-Id",
        "X-Stainless-Arch",
        "X-Stainless-Lang",
        "X-Stainless-OS",
        "X-Stainless-Package-Version",
        "X-Stainless-Retry-Count",
        "X-Stainless-Runtime",
        "X-Stainless-Runtime-Version",
        "X-Stainless-Timeout",
        "anthropic-beta",
        "anthropic-dangerous-direct-browser-access",
        "anthropic-version",
        "x-app",
        "x-client-request-id",
        "x-unknown-outbound",
        "Connection",
        "Accept-Encoding",
      ]);
      expect(request.headers["User-Agent"]).toBe(selected.userAgent);
      expect(request.headers.Authorization).toBe("Bearer test-access-token");
      expect(request.headers["X-Stainless-Package-Version"]).toBe(selected.stainlessPackageVersion);
      const body = JSON.parse(request.bodyText);
      expect(body.system[0].text).toContain(`cc_entrypoint=${selected.billingEntrypoint};`);
      expect(body.system[1].text).toBe(selected.systemInstruction);
    } finally {
      restore();
      await plugin.dispose!();
    }
  });

});
