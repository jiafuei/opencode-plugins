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
  refreshTestSeam.resetInFlightRefreshes();
  return {
    restore: () => {
      process.env.XDG_DATA_HOME = prev;
      refreshTestSeam.resetInFlightRefreshes();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function holdLease(dir: string, ageMs = 0): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "owner"),
    JSON.stringify({ owner: "foreign-holder", pid: 999999, at: Date.now() - ageMs }),
  );
}

interface Harness {
  /** The starting auth record; persist() mirrors into it like the real store. */
  authState: Record<string, unknown>;
  /** Replace what getAuth returns entirely (logout, type switch, ...). */
  setAuth: (value: unknown) => void;
  persisted: Persisted[];
  events: string[];
  options: Record<string, any>;
}

async function makeHarness(opts?: {
  auth?: Record<string, unknown>;
  /** Replace the default persist behavior (return an error body or throw). */
  setImpl?: (body: Persisted) => Promise<unknown>;
}): Promise<Harness> {
  const authState = structuredClone(opts?.auth ?? EXPIRED_AUTH) as Record<string, unknown>;
  let currentAuth: unknown = authState;
  const persisted: Persisted[] = [];
  const events: string[] = [];
  const plugin = await ClaudeOAuthPlugin({
    client: {
      auth: {
        set: async ({ body }: { body: Persisted }) => {
          events.push("persist");
          if (opts?.setImpl) return opts.setImpl(body);
          // Like OpenCode's server: auth.set persists into the store that
          // getAuth reads, so post-refresh re-reads observe the new credential.
          Object.assign(authState, structuredClone(body));
          persisted.push(structuredClone(body));
        },
      },
    },
  } as never);
  const options = await plugin.auth!.loader!(async () => currentAuth as never, {} as never);
  return { authState, setAuth: (value) => (currentAuth = value), persisted, events, options };
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

  serialTest("persistence failures fail the request and release the lease", async () => {
    for (const mode of ["error-result", "throw"] as const) {
      const data = useDataDir();
      const h = await makeHarness({
        setImpl:
          mode === "error-result"
            ? async () => ({ error: { name: "ValidationError" } })
            : async () => {
                throw new Error("auth.set boom");
              },
      });
      const mock = mockFetch((url) => (isTokenCall(url) ? tokenResponse() : jsonResponse({})));
      try {
        await expect(callFetch(h.options)).rejects.toThrow(
          mode === "error-result" ? /persist refreshed Anthropic credentials/i : "auth.set boom",
        );
        expect(mock.calls.filter((c) => isTokenCall(c.url))).toHaveLength(1);
        expect(existsSync(refreshTestSeam.leaseDirFor("stored-account:stale-refresh"))).toBe(false);
      } finally {
        mock.restore();
        data.restore();
      }
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
    holdLease(lease, 200_000); // older than the lease TTL
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

describe("refresh lease ownership", () => {
  serialTest("release only removes the lease when the owner token matches", () => {
    const base = mkdtempSync(path.join(tmpdir(), "claude-oauth-owner-"));
    const dir = path.join(base, "lease");
    try {
      const first = refreshTestSeam.tryAcquireLease(dir);
      expect(typeof first).toBe("string");
      // A replacement lease appears under the same directory (a takeover by
      // another holder) while we still hold our now-outdated token.
      writeFileSync(
        path.join(dir, "owner"),
        JSON.stringify({ owner: "replacement-owner", pid: 424242, at: Date.now() }),
      );
      refreshTestSeam.releaseLease(dir, first!);
      // Our stale token must NOT delete another holder's replacement lease.
      expect(existsSync(dir)).toBe(true);
      expect(refreshTestSeam.readLeaseOwner(dir)?.owner).toBe("replacement-owner");
      // Releasing with the matching token removes it.
      refreshTestSeam.releaseLease(dir, "replacement-owner");
      expect(existsSync(dir)).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  serialTest("an ownerless fresh lease directory (holder mid-installation) is never stolen", () => {
    const base = mkdtempSync(path.join(tmpdir(), "claude-oauth-install-"));
    const dir = path.join(base, "lease");
    try {
      // Mirrors the window between the holder's winning mkdir and its
      // owner-record write: the directory exists but carries no owner yet.
      mkdirSync(dir);
      expect(refreshTestSeam.tryAcquireLease(dir)).toBeNull();
      // Stealing here would let the dispossessed holder overwrite our owner
      // record afterwards, leaving two live holders. Only once the directory
      // ages past the lease TTL does the takeover proceed.
      const originalNow = refreshTestSeam.leaseClock.now;
      refreshTestSeam.leaseClock.now = () => Date.now() + 200_000;
      try {
        const stolen = refreshTestSeam.tryAcquireLease(dir);
        expect(typeof stolen).toBe("string");
        expect(refreshTestSeam.readLeaseOwner(dir)?.owner).toBe(stolen!);
      } finally {
        refreshTestSeam.leaseClock.now = originalNow;
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  serialTest("stale takeover installs a fresh verified owner token", () => {
    const base = mkdtempSync(path.join(tmpdir(), "claude-oauth-takeover-"));
    const dir = path.join(base, "lease");
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, "owner"),
        JSON.stringify({ owner: "dead-owner", pid: 999999, at: Date.now() - 200_000 }),
      );
      const stolen = refreshTestSeam.tryAcquireLease(dir);
      expect(stolen).not.toBeNull();
      expect(stolen).not.toBe("dead-owner");
      const recorded = refreshTestSeam.readLeaseOwner(dir)!;
      expect(recorded.owner).toBe(stolen!);
      expect(recorded.pid).toBe(process.pid);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  serialTest("a live lease held well past 10s is never stolen; the waiter adopts the landed peer refresh", async () => {
    const data = useDataDir();
    const lease = refreshTestSeam.leaseDirFor("stored-account:stale-refresh");
    let fakeNow = Date.now();
    const originalNow = refreshTestSeam.leaseClock.now;
    const originalSleep = refreshTestSeam.leaseClock.sleep;
    refreshTestSeam.leaseClock.now = () => fakeNow;

    mkdirSync(lease, { recursive: true });
    const foreignOwner = { owner: "foreign-live-owner", pid: 999999, at: fakeNow };
    writeFileSync(path.join(lease, "owner"), JSON.stringify(foreignOwner));

    let tokenCalls = 0;
    const mock = mockFetch((url) => {
      if (isTokenCall(url)) {
        tokenCalls++;
        return tokenResponse();
      }
      return jsonResponse({ id: "msg" });
    });

    let h!: Harness;
    let peerLanded = false;
    const landPeer = () => {
      expect(peerLanded).toBe(false);
      peerLanded = true;
      // We have polled against this live holder far past the old bounded-wait
      // horizon and never stole its lease.
      expect(fakeNow - foreignOwner.at).toBeGreaterThanOrEqual(11_000);
      expect(refreshTestSeam.readLeaseOwner(lease)?.owner).toBe("foreign-live-owner");
      // The peer's refresh lands and it frees the lease.
      Object.assign(h.authState, { access: "peer-access", expires: fakeNow + 3600_000 });
      rmSync(lease, { recursive: true, force: true });
    };

    try {
      h = await makeHarness();
      refreshTestSeam.leaseClock.sleep = async (ms: number) => {
        fakeNow += ms;
        await Bun.sleep(1); // yield so other queued work can run
        if (!peerLanded && fakeNow - foreignOwner.at >= 11_000) landPeer();
      };
      await callFetch(h.options);
      expect(tokenCalls).toBe(0); // live lease was never taken over
      expect(peerLanded).toBe(true);
      const sent = mock.calls.filter((c) => c.url.includes("/v1/messages"));
      expect(sent).toHaveLength(1);
      expect(new Headers(sent[0]!.init!.headers).get("authorization")).toBe("Bearer peer-access");
    } finally {
      refreshTestSeam.leaseClock.now = originalNow;
      refreshTestSeam.leaseClock.sleep = originalSleep;
      mock.restore();
      data.restore();
    }
  });
});

describe("mid-refresh auth transitions", () => {
  serialTest("logout during the network refresh discards the result and fails clearly", async () => {
    const data = useDataDir();
    let h!: Harness;
    let tokenCalls = 0;
    const mock = mockFetch((url) => {
      if (isTokenCall(url)) {
        tokenCalls++;
        h.setAuth(undefined);
        return tokenResponse();
      }
      return jsonResponse({ id: "msg" });
    });
    try {
      h = await makeHarness();
      await expect(callFetch(h.options)).rejects.toThrow(/missing.*opencode auth login/i);
      expect(tokenCalls).toBe(1);
      expect(mock.calls.filter((c) => c.url.includes("/v1/messages"))).toHaveLength(0);
      expect(h.persisted).toHaveLength(0);
    } finally {
      mock.restore();
      data.restore();
    }
  });

  serialTest("API-key transition during the refresh dispatches an ordinary API request", async () => {
    const data = useDataDir();
    let h!: Harness;
    const mock = mockFetch((url) => {
      if (isTokenCall(url)) {
        h.setAuth({ type: "api", key: "sk-ant-switched" });
        return tokenResponse();
      }
      return jsonResponse({ id: "msg" });
    });
    try {
      h = await makeHarness();
      const response = await callFetch(h.options);
      expect(response.status).toBe(200);
      const sent = mock.calls.filter((c) => c.url.includes("/v1/messages"));
      expect(sent).toHaveLength(1);
      const headers = new Headers(sent[0]!.init!.headers);
      expect(headers.get("x-api-key")).toBe("sk-ant-switched");
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("user-agent") ?? "").not.toContain("claude-cli");
      expect(sent[0]!.url).toBe("https://api.anthropic.com/v1/messages"); // no ?beta=true
      expect(String(sent[0]!.init!.body)).not.toContain("x-anthropic-billing-header");
      expect(h.persisted).toHaveLength(0);
    } finally {
      mock.restore();
      data.restore();
    }
  });

  serialTest("a new OAuth login during the refresh wins over the stale refresh result", async () => {
    const data = useDataDir();
    let h!: Harness;
    let tokenCalls = 0;
    const mock = mockFetch((url) => {
      if (isTokenCall(url)) {
        tokenCalls++;
        h.setAuth({
          type: "oauth",
          access: "login-access",
          refresh: "login-refresh",
          expires: Date.now() + 3600_000,
          accountId: "new-account",
        });
        return tokenResponse();
      }
      return jsonResponse({ id: "msg" });
    });
    try {
      h = await makeHarness();
      await callFetch(h.options);
      expect(tokenCalls).toBe(1);
      const sent = mock.calls.filter((c) => c.url.includes("/v1/messages"));
      expect(sent).toHaveLength(1);
      expect(new Headers(sent[0]!.init!.headers).get("authorization")).toBe("Bearer login-access");
      expect(h.persisted).toHaveLength(0);
      expect(existsSync(refreshTestSeam.leaseDirFor("stored-account:stale-refresh"))).toBe(false);
    } finally {
      mock.restore();
      data.restore();
    }
  });

  serialTest("auth disappearing while waiting on a live lease fails clearly without network", async () => {
    const data = useDataDir();
    const lease = refreshTestSeam.leaseDirFor("stored-account:stale-refresh");
    holdLease(lease); // live foreign holder
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
        h.setAuth(undefined);
        rmSync(lease, { recursive: true, force: true });
      }, 30);
      try {
        await expect(callFetch(h.options)).rejects.toThrow(/missing.*opencode auth login/i);
      } finally {
        clearTimeout(peer);
      }
      expect(tokenCalls).toBe(0);
      expect(mock.calls.filter((c) => c.url.includes("/v1/messages"))).toHaveLength(0);
      expect(h.persisted).toHaveLength(0);
    } finally {
      mock.restore();
      data.restore();
    }
  });

  serialTest("dispatch uses the latest persisted credential after a successful shared refresh", async () => {
    const data = useDataDir();
    const mock = mockFetch((url) => (isTokenCall(url) ? tokenResponse() : jsonResponse({ id: "msg" })));
    try {
      const h = await makeHarness();
      await callFetch(h.options);
      const sent = mock.calls.filter((c) => c.url.includes("/v1/messages"));
      expect(new Headers(sent[0]!.init!.headers).get("authorization")).toBe("Bearer new-access");
      // persist() wrote into the store before dispatch; the request carried
      // exactly what was persisted.
      expect(h.authState.access).toBe("new-access");
      expect(h.events[0]).toBe("persist");
    } finally {
      mock.restore();
      data.restore();
    }
  });
});

describe("test-surface hygiene", () => {
  serialTest("the refresh seam exposes no raw refresh tokens or internal maps", () => {
    // The old seam exported the raw-keyed in-flight map itself.
    expect("inFlightRefreshes" in (refreshTestSeam as Record<string, unknown>)).toBe(false);
    // Safe reset/introspection methods exist instead.
    expect(refreshTestSeam.resetInFlightRefreshes).toBeTypeOf("function");
    expect(refreshTestSeam.inFlightKeys()).toHaveLength(0);
    // The key derivation hashes the credential identity.
    const key = refreshTestSeam.inFlightKey("stored-account", "stale-refresh");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("stale-refresh");
  });

  serialTest("in-flight refresh keys are hashed while a refresh is pending", async () => {
    const data = useDataDir();
    const lease = refreshTestSeam.leaseDirFor("stored-account:stale-refresh");
    holdLease(lease); // live foreign holder keeps the refresh in flight
    const mock = mockFetch((url) => (isTokenCall(url) ? tokenResponse() : jsonResponse({ id: "msg" })));
    try {
      const h = await makeHarness();
      const pending = callFetch(h.options);
      await Bun.sleep(30); // let it register the shared refresh promise
      const keys = refreshTestSeam.inFlightKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0]).toBe(refreshTestSeam.inFlightKey("stored-account", "stale-refresh"));
      expect(JSON.stringify(keys)).not.toContain("stale-refresh");
      // Unwind: free the lease so the refresh completes normally.
      rmSync(lease, { recursive: true, force: true });
      await pending;
    } finally {
      mock.restore();
      data.restore();
    }
  });
});
