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
    expect(Object.values(out.system[0].cache_control ?? {})).not.toContain("global");
    expect(out.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
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
});
