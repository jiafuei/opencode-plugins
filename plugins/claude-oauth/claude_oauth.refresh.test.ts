import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AnthropicReauthRequiredError, ClaudeOAuthPlugin, refreshTestSeam } from "./claude_oauth.ts";

interface Persisted {
  refresh?: string;
  access?: string;
  expires?: number;
  accountId?: string;
}

interface Call {
  url: string;
  init?: RequestInit;
}

// Bun runs async tests concurrently by default; these suites mock
// globalThis.fetch and drive stateful plugin loaders (plus shared module-level
// refresh state), so their tests are serialized by hand through a promise chain.
let serialQueue: Promise<unknown> = Promise.resolve();
function serialTest(name: string, fn: () => Promise<void> | void) {
  test(name, async () => {
    const result = serialQueue.then(fn, fn);
    serialQueue = result.catch(() => {});
    await result;
  });
}

/** Mock global fetch; returns captured calls. */
function mockFetch(responder: (url: string) => Response | Promise<Response>): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    return responder(url);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const MESSAGES_BODY = JSON.stringify({ model: "claude-sonnet-4-6", messages: [], max_tokens: 1 });

const EXPIRED_AUTH = {
  type: "oauth" as const,
  access: "stale-access",
  refresh: "stale-refresh",
  expires: Date.now() - 1000,
  accountId: "stored-account",
};

function tokenResponse(overrides: Record<string, unknown> = {}, status = 200): Response {
  return jsonResponse(
    { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, ...overrides },
    status,
  );
}

function isTokenCall(url: string): boolean {
  return url.includes("/v1/oauth/token");
}

/**
 * Isolate the lease directory under a fresh temp dir. Also clears any leftover
 * in-flight refresh promises from earlier tests.
 */
function useDataDir(): { restore: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "claude-oauth-refresh-"));
  const prev = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  refreshTestSeam.inFlightRefreshes.clear();
  return {
    restore: () => {
      process.env.XDG_DATA_HOME = prev;
      refreshTestSeam.inFlightRefreshes.clear();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function holdLease(dir: string, ageMs = 0): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "owner"), JSON.stringify({ pid: 999999, at: Date.now() - ageMs }));
}

interface Harness {
  authState: Record<string, unknown>;
  persisted: Persisted[];
  events: string[];
  options: Record<string, any>;
}

async function makeHarness(opts?: {
  auth?: Record<string, unknown>;
  /** Replace the default persist behavior (return an error body or throw). */
  setImpl?: (body: Persisted) => Promise<unknown>;
}): Promise<Harness> {
  const authState = structuredClone(opts?.auth ?? EXPIRED_AUTH);
  const persisted: Persisted[] = [];
  const events: string[] = [];
  const plugin = await ClaudeOAuthPlugin({
    client: {
      auth: {
        set: async ({ body }: { body: Persisted }) => {
          events.push("persist");
          if (opts?.setImpl) return opts.setImpl(body);
          persisted.push(structuredClone(body));
        },
      },
    },
  } as never);
  const options = await plugin.auth!.loader!(async () => authState as never, {} as never);
  return { authState, persisted, events, options };
}

function callFetch(options: Record<string, any>): Promise<Response> {
  return options.fetch!("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: MESSAGES_BODY,
  });
}

describe("shared refresh coordination", () => {
  serialTest("two loader instances share a single refresh network call", async () => {
    const data = useDataDir();
    let tokenCalls = 0;
    const mock = mockFetch((url) => {
      if (isTokenCall(url)) {
        tokenCalls++;
        return tokenResponse();
      }
      return jsonResponse({ id: "msg" });
    });
    try {
      // Two independent plugin instances, each with its own getAuth/persist —
      // sharing happens through the module-scope promise map.
      const a = await makeHarness();
      const b = await makeHarness();
      await Promise.all([callFetch(a.options), callFetch(b.options)]);
      expect(tokenCalls).toBe(1);
      const sent = mock.calls.filter((c) => c.url.includes("/v1/messages"));
      expect(sent).toHaveLength(2);
      expect(new Headers(sent[0]!.init!.headers).get("authorization")).toBe("Bearer new-access");
      expect(new Headers(sent[1]!.init!.headers).get("authorization")).toBe("Bearer new-access");
      // Exactly one of the two instances persists; the other adopts the
      // credential carried by the shared refresh promise.
      expect(a.persisted.length + b.persisted.length).toBe(1);
      const persistedOne = [...a.persisted, ...b.persisted][0]!;
      expect(persistedOne).toMatchObject({ access: "new-access", refresh: "new-refresh" });
    } finally {
      mock.restore();
      data.restore();
    }
  });

  serialTest("adopts credentials a peer persisted while we waited on the lease", async () => {
    const data = useDataDir();
    const lease = refreshTestSeam.leaseDirFor("stored-account:stale-refresh");
    holdLease(lease); // live foreign holder (fresh timestamp)
    let tokenCalls = 0;
    const mock = mockFetch((url) => {
      if (isTokenCall(url)) {
        tokenCalls++;
        return tokenResponse();
      }
      return jsonResponse({ id: "msg" });
    });
    try {
      const h = await makeHarness();
      const peer = setTimeout(() => {
        Object.assign(h.authState, {
          access: "peer-access",
          refresh: "peer-refresh",
          expires: Date.now() + 3600_000,
        });
        rmSync(lease, { recursive: true, force: true });
      }, 50);
      try {
        await callFetch(h.options);
        expect(tokenCalls).toBe(0);
        const sent = mock.calls.filter((c) => c.url.includes("/v1/messages"));
        expect(sent).toHaveLength(1);
        expect(new Headers(sent[0]!.init!.headers).get("authorization")).toBe("Bearer peer-access");
      } finally {
        clearTimeout(peer);
      }
    } finally {
      mock.restore();
      data.restore();
    }
  });

  serialTest("persistence returning an error object fails loudly and releases the lease", async () => {
    const data = useDataDir();
    const h = await makeHarness({ setImpl: async () => ({ error: { name: "ValidationError" } }) });
    const mock = mockFetch((url) => (isTokenCall(url) ? tokenResponse() : jsonResponse({})));
    try {
      await expect(callFetch(h.options)).rejects.toThrow(/persist refreshed Anthropic credentials/i);
      expect(mock.calls.filter((c) => isTokenCall(c.url))).toHaveLength(1);
      expect(existsSync(refreshTestSeam.leaseDirFor("stored-account:stale-refresh"))).toBe(false);
    } finally {
      mock.restore();
      data.restore();
    }
  });

  serialTest("persistence throwing fails the request and releases the lease", async () => {
    const data = useDataDir();
    const h = await makeHarness({
      setImpl: async () => {
        throw new Error("auth.set boom");
      },
    });
    const mock = mockFetch((url) => (isTokenCall(url) ? tokenResponse() : jsonResponse({})));
    try {
      await expect(callFetch(h.options)).rejects.toThrow("auth.set boom");
      expect(existsSync(refreshTestSeam.leaseDirFor("stored-account:stale-refresh"))).toBe(false);
    } finally {
      mock.restore();
      data.restore();
    }
  });

  serialTest("rotated tokens are persisted before the API request proceeds", async () => {
    const data = useDataDir();
    const h = await makeHarness();
    const mock = mockFetch((url) => {
      if (isTokenCall(url)) return tokenResponse();
      if (!url.includes("/bootstrap")) h.events.push("request");
      return jsonResponse({ id: "msg" });
    });
    try {
      const response = await callFetch(h.options);
      expect(response.status).toBe(200);
      const sent = mock.calls.filter((c) => c.url.includes("/v1/messages"));
      expect(new Headers(sent[0]!.init!.headers).get("authorization")).toBe("Bearer new-access");
      expect(h.events[0]).toBe("persist");
      expect(h.events).toContain("request");
      expect(h.persisted[0]).toMatchObject({
        access: "new-access",
        refresh: "new-refresh",
        accountId: "stored-account",
      });
    } finally {
      mock.restore();
      data.restore();
    }
  });

  serialTest("recovers from a stale lease left by a crashed process", async () => {
    const data = useDataDir();
    const lease = refreshTestSeam.leaseDirFor("stored-account:stale-refresh");
    holdLease(lease, 120_000); // older than the lease TTL
    let tokenCalls = 0;
    const mock = mockFetch((url) => {
      if (isTokenCall(url)) {
        tokenCalls++;
        return tokenResponse();
      }
      return jsonResponse({ id: "msg" });
    });
    try {
      const h = await makeHarness();
      await callFetch(h.options);
      expect(tokenCalls).toBe(1);
      const sent = mock.calls.filter((c) => c.url.includes("/v1/messages"));
      expect(new Headers(sent[0]!.init!.headers).get("authorization")).toBe("Bearer new-access");
      expect(existsSync(lease)).toBe(false);
    } finally {
      mock.restore();
      data.restore();
    }
  });

  serialTest("invalid_grant surfaces a clear re-login error instead of retrying", async () => {
    const data = useDataDir();
    let tokenCalls = 0;
    const mock = mockFetch((url) => {
      if (isTokenCall(url)) {
        tokenCalls++;
        return jsonResponse({ error: "invalid_grant", error_description: "refresh token expired" }, 400);
      }
      return jsonResponse({});
    });
    try {
      const h = await makeHarness();
      const error = await callFetch(h.options).catch((e) => e);
      expect(error).toBeInstanceOf(AnthropicReauthRequiredError);
      expect(error.message).toMatch(/re-login required/i);
      expect(tokenCalls).toBe(1); // terminal: no repeated generic attempts
      expect(existsSync(refreshTestSeam.leaseDirFor("stored-account:stale-refresh"))).toBe(false);
    } finally {
      mock.restore();
      data.restore();
    }
  });

  serialTest("refresh response without refresh_token keeps the original", async () => {
    const data = useDataDir();
    const mock = mockFetch((url) => (isTokenCall(url) ? tokenResponse({ refresh_token: "" }) : jsonResponse({})));
    try {
      const h = await makeHarness();
      await callFetch(h.options);
      expect(h.persisted[0]?.refresh).toBe("stale-refresh");
    } finally {
      mock.restore();
      data.restore();
    }
  });
});
