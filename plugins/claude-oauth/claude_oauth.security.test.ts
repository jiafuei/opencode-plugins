import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AnthropicReauthRequiredError, ClaudeOAuthPlugin, refreshTestSeam } from "./claude_oauth.ts";
import { coworkTransport } from "./cowork_fetch.ts";

coworkTransport.impl = (input, init) => globalThis.fetch(input, init);

// Security stage 1: credential-boundary hardening.
//
// - Origin allowlist: OAuth bearer traffic only ever targets the official
//   https://api.anthropic.com endpoint; everything else fails before network.
// - Token envelope validation and error sanitization at the token boundary.
// - API-key transition strips plugin-only transport headers.

const OAUTH_AUTH = {
  type: "oauth" as const,
  access: "test-access-token",
  refresh: "test-refresh-token",
  expires: Date.now() + 60 * 60 * 1000,
  accountId: "acct-test-123",
};

const MESSAGES_BODY = JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }], max_tokens: 1 });

// Bun runs async tests concurrently by default; refresh-path suites mock
// globalThis.fetch and share module-level refresh state, so they are
// serialized by hand through a promise chain.
let serialQueue: Promise<unknown> = Promise.resolve();
function serialTest(name: string, fn: () => Promise<void> | void) {
  test(name, async () => {
    const result = serialQueue.then(fn, fn);
    serialQueue = result.catch(() => {});
    await result;
  });
}

interface Call {
  url: string;
  init?: RequestInit;
}

function mockFetch(responder: (url: string, init?: RequestInit) => Response | Promise<Response>): { calls: Call[]; restore: () => void; count: () => number } {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    return responder(url, init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => (globalThis.fetch = original),
    count: () => calls.length,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Harness with a mutable auth holder; does NOT install a fetch mock. */
async function makeHarness(auth?: Record<string, unknown>) {
  const persisted: Array<Record<string, unknown>> = [];
  const plugin = await ClaudeOAuthPlugin({
    client: {
      auth: {
        set: async ({ body }: { body: Record<string, unknown> }) => {
          persisted.push(structuredClone(body));
        },
      },
    },
  } as never);
  const authState = { value: structuredClone(auth ?? OAUTH_AUTH) as unknown };
  const options = await plugin.auth!.loader!(async () => authState.value as never, {} as never);
  return { authState, options, persisted };
}

function callFetch(options: Record<string, any>, url = "https://api.anthropic.com/v1/messages"): Promise<Response> {
  return options.fetch!(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: MESSAGES_BODY,
  });
}

function useDataDir(): { restore: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "claude-oauth-security-"));
  const prev = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  refreshTestSeam.resetInFlightRefreshes();
  return {
    restore: () => {
      process.env.XDG_DATA_HOME = prev;
      refreshTestSeam.resetInFlightRefreshes();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

let cleanupFetch: (() => void) | undefined;
afterEach(() => {
  cleanupFetch?.();
  cleanupFetch = undefined;
});

// ---------------------------------------------------------------------------
// Origin allowlist
// ---------------------------------------------------------------------------

describe("origin allowlist", () => {
  const REJECTED_TARGETS = [
    ["plain http to official host", "http://api.anthropic.com/v1/messages"],
    ["localhost https", "https://localhost/v1/messages"],
    ["loopback IP", "http://127.0.0.1:8082/v1/messages"],
    ["alternate host", "https://api.anthropic.com.evil.test/v1/messages"],
    ["custom gateway baseURL", "https://gateway.internal/v1/messages"],
    ["credentials in URL (official-looking host)", "https://user:pass@api.anthropic.com/v1/messages"],
    ["non-default port on official host", "https://api.anthropic.com:8443/v1/messages"],
  ] as const;

  for (const [label, target] of REJECTED_TARGETS) {
    serialTest(`rejects ${label} before any network activity`, async () => {
      const { options } = await makeHarness();
      const mock = mockFetch(async () => jsonResponse({ id: "msg" }));
      cleanupFetch = mock.restore;
      try {
        let error: unknown;
        try {
          await callFetch(options, target);
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toMatch(/api\.anthropic\.com/i);
        expect(message).toMatch(/api[- ]key/i);
        // The bearer token must never appear in the refusal.
        expect(message).not.toContain("test-access-token");
        // No request, including token or identity endpoints, was made.
        expect(mock.count()).toBe(0);
      } finally {
        cleanupFetch();
        cleanupFetch = undefined;
      }
    });
  }

  serialTest("default port semantics keep the official origin allowed", async () => {
    const { options } = await makeHarness();
    let capturedHeaders: Headers | undefined;
    let capturedUrl = "";
    const mock = mockFetch(async (url, init) => {
      capturedUrl = url;
      capturedHeaders = new Headers(init?.headers);
      return jsonResponse({ id: "msg" }, 200);
    });
    cleanupFetch = mock.restore;
    try {
      const response = await callFetch(options, "https://api.anthropic.com:443/v1/messages");
      expect(response.status).toBe(200);
      expect(capturedUrl).toBe("https://api.anthropic.com/v1/messages?beta=true");
      expect(capturedHeaders!.get("authorization")).toBe("Bearer test-access-token");
    } finally {
      cleanupFetch();
      cleanupFetch = undefined;
    }
  });

  serialTest("Request input to a malicious origin is rejected without network or token leak", async () => {
    const { options } = await makeHarness();
    const mock = mockFetch(async () => jsonResponse({ id: "msg" }));
    cleanupFetch = mock.restore;
    try {
      let error: unknown;
      try {
        await options.fetch!(new Request("https://evil.test/v1/messages", { method: "POST", body: MESSAGES_BODY }));
      } catch (e) {
        error = e;
      }
      expect((error as Error).message).toMatch(/Refusing to send/);
      expect((error as Error).message).not.toContain("test-access-token");
      expect(mock.count()).toBe(0);
    } finally {
      cleanupFetch();
      cleanupFetch = undefined;
    }
  });

  serialTest("bodyless Request input to the official origin works and derives the URL", async () => {
    const { options } = await makeHarness();
    let capturedUrl = "";
    let capturedHeaders: Headers | undefined;
    const mock = mockFetch(async (url, init) => {
      capturedUrl = url;
      capturedHeaders = new Headers(init?.headers);
      return jsonResponse([{ id: "model-1" }]);
    });
    cleanupFetch = mock.restore;
    try {
      const response = await options.fetch!(new Request("https://api.anthropic.com/v1/models"));
      expect(response.status).toBe(200);
      expect(capturedUrl).toBe("https://api.anthropic.com/v1/models");
      expect(capturedHeaders!.get("authorization")).toBe("Bearer test-access-token");
    } finally {
      cleanupFetch();
      cleanupFetch = undefined;
    }
  });

  serialTest("Request input carrying its own body without an init override is rejected before network", async () => {
    const { options } = await makeHarness();
    const mock = mockFetch(async () => jsonResponse({ id: "msg" }));
    cleanupFetch = mock.restore;
    try {
      let error: unknown;
      try {
        await options.fetch!(
          new Request("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: MESSAGES_BODY,
          }),
        );
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/Unsupported Anthropic request/i);
      expect((error as Error).message).not.toContain("test-access-token");
      expect(mock.count()).toBe(0);
    } finally {
      cleanupFetch();
      cleanupFetch = undefined;
    }
  });
});

// ---------------------------------------------------------------------------
// API-key transition header stripping
// ---------------------------------------------------------------------------

describe("API-key transition header stripping", () => {
  serialTest("transition branch removes private markers, stale bearer, dummy key, and emits no x-client-request-id", async () => {
    const { authState, options } = await makeHarness();
    authState.value = { type: "api", key: "sk-ant-real-key" };

    let capturedHeaders: Headers | undefined;
    const mock = mockFetch(async (_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return jsonResponse({ id: "msg" });
    });
    cleanupFetch = mock.restore;
    try {
      await options.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Claude-Code-Session-Id": "ses-leftover",
          "x-claude-oauth-request-id": "11111111-2222-3333-4444-555555555555",
          "x-claude-oauth-prompt-id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          Authorization: "Bearer stale-oauth-token",
          "x-api-key": "opencode-oauth-dummy-key",
        },
        body: MESSAGES_BODY,
      });

      expect(capturedHeaders!.get("x-claude-code-session-id")).toBeNull();
      expect(capturedHeaders!.get("x-claude-oauth-request-id")).toBeNull();
      expect(capturedHeaders!.get("x-claude-oauth-prompt-id")).toBeNull();
      expect(capturedHeaders!.get("x-client-request-id")).toBeNull();
      expect(capturedHeaders!.get("authorization")).toBeNull();
      expect(capturedHeaders!.get("x-api-key")).toBe("sk-ant-real-key");
    } finally {
      cleanupFetch();
      cleanupFetch = undefined;
    }
  });
});

// ---------------------------------------------------------------------------
// Token envelope validation + error sanitization (refresh path)
// ---------------------------------------------------------------------------

describe("token envelope validation", () => {
  function expiredHarness() {
    return makeHarness({
      type: "oauth",
      access: "stale-access",
      refresh: "stale-refresh",
      expires: Date.now() - 1000,
      accountId: "stored-account",
    });
  }

  serialTest("200 refresh response missing expires_in and refresh_token fails before persist or dispatch", async () => {
    const data = useDataDir();
    const h = await expiredHarness();
    const mock = mockFetch((url) => {
      if (url.includes("/v1/oauth/token")) return jsonResponse({ access_token: "new-access" });
      if (url.includes("/api/oauth/")) throw new Error("identity lookup must not be called");
      throw new Error("/v1/messages must not be reached");
    });
    cleanupFetch = mock.restore;
    try {
      let error: unknown;
      try {
        await callFetch(h.options);
      } catch (e) {
        error = e;
      }
      expect((error as Error).message).toMatch(/missing required fields/i);
      expect((error as Error).message).not.toContain("new-access");
      expect(h.persisted).toHaveLength(0);
      expect(mock.calls.some((c) => c.url.includes("/v1/messages"))).toBe(false);
      expect(mock.calls.some((c) => c.url.includes("/api/oauth/"))).toBe(false);
    } finally {
      cleanupFetch();
      cleanupFetch = undefined;
      data.restore();
    }
  });

  for (const [label, envelope] of [
    ["negative expires_in", { access_token: "a", refresh_token: "r", expires_in: -5 }],
    ["zero expires_in", { access_token: "a", refresh_token: "r", expires_in: 0 }],
    ["string expires_in", { access_token: "a", refresh_token: "r", expires_in: "3600" }],
    ["empty access_token", { access_token: "", refresh_token: "r", expires_in: 3600 }],
  ] as const) {
    serialTest(`refresh rejects ${label}`, async () => {
      const data = useDataDir();
      const h = await expiredHarness();
      const mock = mockFetch((url) => (url.includes("/v1/oauth/token") ? jsonResponse(envelope) : jsonResponse({ id: "msg" })));
      cleanupFetch = mock.restore;
      try {
        await expect(callFetch(h.options)).rejects.toThrow(/missing required fields|invalid JSON/i);
        expect(h.persisted).toHaveLength(0);
        expect(mock.calls.some((c) => c.url.includes("/v1/messages"))).toBe(false);
      } finally {
        cleanupFetch();
        cleanupFetch = undefined;
        data.restore();
      }
    });
  }

  serialTest(
    "login exchange rejects a 200 envelope missing refresh_token/expires_in (paste-code flow reports failure)",
    async () => {
      const mock = mockFetch(() => jsonResponse({ access_token: "only-access" }));
      cleanupFetch = mock.restore;
      try {
        const plugin = await ClaudeOAuthPlugin({ client: { auth: { set: async () => {} } } } as never);
        const pasteMethod = plugin.auth!.methods!.find((method) => method.label === "Claude Pro/Max")!;
        const flow = (await pasteMethod.authorize!()) as { url: string; callback: (code: string) => Promise<{ type: string }> };
        // The pasted `code#state` fragment must carry this login's generated state.
        const state = new URL(flow.url).searchParams.get("state")!;
        const result = await flow.callback("some-code#some-state");
        expect(result.type).toBe("failed");
        // A mismatched state is rejected locally: no token endpoint contact at all.
        expect(mock.calls.length).toBe(0);

        // With the correct state, the exchange runs and the bad envelope fails
        // the login. Only the token endpoint was contacted; no identity follow-up.
        expect(await flow.callback(`some-code#${state}`)).toMatchObject({ type: "failed" });
        expect(mock.calls.length).toBe(1);
        expect(mock.calls[0]!.url).toContain("/v1/oauth/token");
      } finally {
        cleanupFetch();
        cleanupFetch = undefined;
      }
    },
  );

  serialTest("login exchange succeeds with a complete envelope", async () => {
    const data = useDataDir();
    const mock = mockFetch((url) => {
      if (url.includes("/v1/oauth/token")) {
        return jsonResponse({ access_token: "acc", refresh_token: "ref", expires_in: 3600 });
      }
      if (url.includes("/roles")) return jsonResponse({ organization_name: "Org" });
      return jsonResponse({ account: { uuid: "acct-profile", email: "e@x.co" }, organization: { uuid: "org-1" } });
    });
    cleanupFetch = mock.restore;
    try {
      const plugin = await ClaudeOAuthPlugin({ client: { auth: { set: async () => {} } } } as never);
      const pasteMethod = plugin.auth!.methods!.find((method) => method.label === "Claude Pro/Max")!;
      const flow = (await pasteMethod.authorize!()) as { url: string; callback: (code: string) => Promise<{ type: string }> };
      const state = new URL(flow.url).searchParams.get("state")!;
      const result = await flow.callback(`some-code#${state}`);
      expect(result.type).toBe("success");
    } finally {
      cleanupFetch();
      cleanupFetch = undefined;
      data.restore();
    }
  });
});

describe("token error sanitization", () => {
  function expiredHarness() {
    return makeHarness({
      type: "oauth",
      access: "stale-access",
      refresh: "stale-refresh",
      expires: Date.now() - 1000,
    });
  }

  serialTest("oversized non-JSON error body is never included in the thrown message", async () => {
    const data = useDataDir();
    const h = await expiredHarness();
    const giantBody = `RAW-MARKER-${"A".repeat(64 * 1024)}-Bearer-stale-access`;
    const mock = mockFetch((url) =>
      url.includes("/v1/oauth/token") ? new Response(giantBody, { status: 500 }) : jsonResponse({ id: "msg" }),
    );
    cleanupFetch = mock.restore;
    try {
      let error: unknown;
      try {
        await callFetch(h.options);
      } catch (e) {
        error = e;
      }
      const message = (error as Error).message;
      expect(message).toContain("HTTP 500");
      expect(message.length).toBeLessThan(600);
      expect(message).not.toContain("RAW-MARKER");
      expect(message).not.toContain("stale-access");
      const e = error as Error & { status?: number };
      expect(e.status).toBe(500);
    } finally {
      cleanupFetch();
      cleanupFetch = undefined;
      data.restore();
    }
  });

  serialTest("large JSON error body contributes only parsed fields with a bounded description", async () => {
    const data = useDataDir();
    const h = await expiredHarness();
    // Valid JSON well under the 16 KiB read bound, but far larger than any
    // acceptable error message — and carrying a credential echo.
    const giantDescription = `{"error":"temporarily_unavailable","error_description":"${"d".repeat(8000)} Bearer stale-access"}`;
    const mock = mockFetch((url) =>
      url.includes("/v1/oauth/token") ? new Response(giantDescription, { status: 503 }) : jsonResponse({ id: "msg" }),
    );
    cleanupFetch = mock.restore;
    try {
      const error = (await callFetch(h.options).catch((e) => e)) as Error & { status?: number };
      expect(error.message).toContain("HTTP 503");
      expect(error.message).toContain("temporarily_unavailable");
      expect(error.message.length).toBeLessThan(600);
      expect(error.message).not.toContain("stale-access");
      expect(error.status).toBe(503);
    } finally {
      cleanupFetch();
      cleanupFetch = undefined;
      data.restore();
    }
  });

  serialTest("invalid_grant over 401 also surfaces re-login guidance", async () => {
    const data = useDataDir();
    const h = await expiredHarness();
    let tokenCalls = 0;
    const mock = mockFetch((url) => {
      if (url.includes("/v1/oauth/token")) {
        tokenCalls++;
        return jsonResponse({ error: "invalid_grant", error_description: "token revoked" }, 401);
      }
      return jsonResponse({});
    });
    cleanupFetch = mock.restore;
    try {
      const error = await callFetch(h.options).catch((e) => e);
      expect(error).toBeInstanceOf(AnthropicReauthRequiredError);
      expect(error.message).toMatch(/re-login required/i);
      // Guidance stays sanitized: no raw credential echo beyond classification.
      expect(error.cause).toBeInstanceOf(Error);
      expect((error.cause as Error).message).not.toContain("stale-refresh");
      expect(tokenCalls).toBe(1);
    } finally {
      cleanupFetch();
      cleanupFetch = undefined;
      data.restore();
    }
  });

  serialTest("nested invalid_grant error shape is classified terminally", async () => {
    const data = useDataDir();
    const h = await expiredHarness();
    const mock = mockFetch((url) =>
      url.includes("/v1/oauth/token")
        ? jsonResponse({ error: { type: "invalid_grant", message: "grant expired" } }, 400)
        : jsonResponse({}),
    );
    cleanupFetch = mock.restore;
    try {
      const error = await callFetch(h.options).catch((e) => e);
      expect(error).toBeInstanceOf(AnthropicReauthRequiredError);
    } finally {
      cleanupFetch();
      cleanupFetch = undefined;
      data.restore();
    }
  });
});
