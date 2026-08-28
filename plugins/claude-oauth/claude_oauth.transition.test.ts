import { afterEach, describe, expect, test } from "bun:test";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { ClaudeOAuthPlugin } from "./claude_oauth.ts";
import { coworkTransport } from "./cowork_fetch.ts";

coworkTransport.impl = (input, init) => globalThis.fetch(input, init);

// Auth-transition safety: the OAuth loader installs a custom fetch that stays
// cached inside the Anthropic SDK client. These tests cover what happens when
// the underlying auth disappears or changes type while that closure is live.

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

/** Harness with a mutable auth holder so tests can flip auth mid-flight. */
async function setupHarness() {
  const plugin = await ClaudeOAuthPlugin({
    client: { auth: { set: async () => {} } },
  } as never);

  const authState: { value: unknown } = { value: OAUTH_AUTH };
  const rawLoaderOptions = await plugin.auth!.loader!(async () => authState.value as never, {} as never);

  const captured: CapturedRequest[] = [];
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    networkCalls++;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    let bodyText = "";
    if (typeof init?.body === "string") bodyText = init.body;
    else if (init?.body instanceof Uint8Array) bodyText = new TextDecoder().decode(init.body);
    captured.push({ url: String(input), method: init?.method, headers, bodyText });
    return jsonResponse();
  }) as typeof fetch;
  cleanupFetch = () => {
    globalThis.fetch = originalFetch;
  };

  // Same wiring as OpenCode's provider.ts resolveSDK: the loader's options
  // feed straight into createAnthropic.
  const anthropic = createAnthropic({
    name: "anthropic",
    apiKey: rawLoaderOptions.apiKey!,
    fetch: rawLoaderOptions.fetch as typeof fetch,
  });
  return { plugin, anthropic, captured, authState, rawLoaderOptions, networkCalls: () => networkCalls };
}

describe("auth transitions", () => {
  test("logout after loader creation: cached fetch fails with authentication-required error before any network call", async () => {
    const { authState, rawLoaderOptions, networkCalls } = await setupHarness();

    // The closure is already cached by the SDK client; logout removes auth.
    authState.value = undefined;

    let error: unknown;
    try {
      await rawLoaderOptions.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": "opencode-oauth-dummy-key" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }], max_tokens: 10 }),
      });
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toMatch(/missing.*opencode auth login/i);
    expect(networkCalls()).toBe(0);
  });

  test("API-key transition: ordinary API request via the real capture fetch — only x-api-key, no OAuth/spoof/body rewrite", async () => {
    const { anthropic, captured, authState } = await setupHarness();

    // Auth switched to an API key while the OAuth fetch stayed cached.
    authState.value = { type: "api", key: "sk-ant-real-key" };

    await generateText({
      model: anthropic("claude-sonnet-4-6"),
      prompt: "hello world, this is the first user message",
      maxOutputTokens: 1000,
    });
    expect(captured).toHaveLength(1);
    const req = captured[0]!;

    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers["x-api-key"]).toBe("sk-ant-real-key");
    expect(req.headers["authorization"]).toBeUndefined();

    const body = JSON.parse(req.bodyText);
    expect(JSON.stringify(body)).not.toContain("x-anthropic-billing-header");
    expect(body.max_tokens).toBe(1000);
  });

  test("unsupported auth type: clear failure naming the type", async () => {
    const { authState, rawLoaderOptions, networkCalls } = await setupHarness();
    authState.value = { type: "workspace", key: "whatever" };

    let error: unknown;
    try {
      await rawLoaderOptions.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [], max_tokens: 1 }),
      });
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toContain('Unsupported Anthropic auth type "workspace"');
    expect(networkCalls()).toBe(0);
  });
});

describe("chat.headers claudeOAuth marker", () => {
  async function runHeaders(providerOptions: Record<string, unknown>) {
    const plugin = await ClaudeOAuthPlugin({} as never);
    const output = { headers: {} as Record<string, string> };
    await plugin["chat.headers"]!(
      {
        model: { providerID: "anthropic" },
        provider: { options: providerOptions },
        sessionID: "ses_transition-test",
        message: { id: "msg_transition-test" },
      } as never,
      output as never,
    );
    await plugin.dispose!();
    return output.headers;
  }

  test("marker maps the OpenCode session to a UUIDv4 and emits a fresh per-invocation request id", async () => {
    const headers = await runHeaders({ apiKey: "sk-user-configured-key", claudeOAuth: true });
    expect(headers["X-Claude-Code-Session-Id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(headers["x-claude-oauth-request-id"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("dummy apiKey alone does NOT enable session propagation without the marker", async () => {
    const headers = await runHeaders({ apiKey: "opencode-oauth-dummy-key" });
    expect(headers["X-Claude-Code-Session-Id"]).toBeUndefined();
  });

  test("the OAuth loader emits the marker alongside the dummy key", async () => {
    const plugin = await ClaudeOAuthPlugin({} as never);
    const options = await plugin.auth!.loader!(async () => OAUTH_AUTH as never, {} as never);
    expect(options.claudeOAuth).toBe(true);
    expect(options.apiKey).toBe("opencode-oauth-dummy-key");
  });
});
