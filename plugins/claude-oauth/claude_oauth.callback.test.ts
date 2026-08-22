import { describe, expect, test, afterEach } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ClaudeOAuthPlugin, callbackTestSeam as seam } from "./claude_oauth.ts";

// ---------------------------------------------------------------------------
// Step 7: browser OAuth callback lifecycle
//
// Exercises the real callback server over real local HTTP; only the Anthropic
// token endpoint is mocked so authorize/callback can complete end-to-end.
// ---------------------------------------------------------------------------

afterEach(() => {
  // Never leak a listener or pending timer between tests.
  seam.disposeOAuth();
});

/** Browser-flow authorize through the real plugin, with the token endpoint mocked. */
async function browserAuthorize(tokenBodies: Record<string, any>[] = []) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("api.anthropic.com/v1/oauth/token")) {
      tokenBodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          access_token: "at-" + tokenBodies.length,
          refresh_token: "rt-" + tokenBodies.length,
          expires_in: 3600,
          account: { uuid: "acct-uuid" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    const plugin = await ClaudeOAuthPlugin({} as never);
    const result = (await plugin.auth!.methods![0]!.authorize!()) as {
      url: string;
      callback: () => Promise<{ type: string; access?: string }>;
    };
    return { result, restore: () => (globalThis.fetch = originalFetch) };
  } catch (error) {
    globalThis.fetch = originalFetch;
    throw error;
  }
}

function authorizeParams(url: string): { redirectUri: string; state: string } {
  const parsed = new URL(url);
  return {
    redirectUri: parsed.searchParams.get("redirect_uri")!,
    state: parsed.searchParams.get("state")!,
  };
}

function callbackUrl(redirectUri: string, params: Record<string, string>): string {
  return `${redirectUri}?${new URLSearchParams(params)}`;
}

async function httpGet(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url);
  return { status: res.status, body: await res.text() };
}

describe("browser OAuth callback lifecycle", () => {
  test("binds explicitly to loopback 127.0.0.1 and prefers port 54545", async () => {
    const server = await seam.startCallbackServer();
    const addr = server.address() as AddressInfo;
    expect(addr.address).toBe("127.0.0.1");
    expect(addr.port).toBe(54545);
  });

  test("falls back to an ephemeral loopback port when 54545 is busy", async () => {
    const occupant: Server = createServer(() => {});
    await new Promise<void>((resolve) => occupant.listen(54545, "127.0.0.1", resolve));
    try {
      const server = await seam.startCallbackServer();
      const addr = server.address() as AddressInfo;
      expect(addr.address).toBe("127.0.0.1");
      expect(addr.port).not.toBe(54545);

      // The fallback port is fully functional over real HTTP.
      const codePromise = seam.registerFlow("st-fallback");
      const redirect = `http://127.0.0.1:${addr.port}/callback`;
      const res = await httpGet(callbackUrl(redirect, { code: "c1", state: "st-fallback" }));
      expect(res.body).toContain("Login successful");
      expect(await codePromise).toBe("c1");
    } finally {
      await new Promise<void>((resolve) => occupant.close(() => resolve()));
    }
  });

  test("authorize uses the actual bound redirect URI and retains an early callback", async () => {
    const tokenBodies: Record<string, any>[] = [];
    const { result, restore } = await browserAuthorize(tokenBodies);
    try {
      const server = seam.server();
      expect(server).toBeDefined();
      const port = (server!.address() as AddressInfo).port;

      const authorizeUrl = new URL(result.url);
      const redirectUri = authorizeUrl.searchParams.get("redirect_uri");
      const state = authorizeUrl.searchParams.get("state");
      expect(authorizeUrl.hostname).toBe("claude.ai");
      expect(redirectUri).toBe(`http://127.0.0.1:${port}/callback`);

      // Early callback: lands before OpenCode ever invokes callback().
      const res = await httpGet(callbackUrl(redirectUri!, { code: "early-code", state: state! }));
      expect(res.body).toContain("Login successful");

      const tokens = await result.callback();
      expect(tokens.type).toBe("success");
      expect(tokens.access).toBe("at-1");
      // Token exchange echoes the exact same redirect URI.
      expect(tokenBodies[0]!.redirect_uri).toBe(redirectUri);
      expect(tokenBodies[0]!.code).toBe("early-code");
      expect(tokenBodies[0]!.state).toBe(state);
    } finally {
      restore();
    }
  });

  test("success cleanup removes the flow and closes the server when none remain", async () => {
    const { result, restore } = await browserAuthorize();
    try {
      const { redirectUri, state } = authorizeParams(result.url);
      expect(seam.pendingFlows.size).toBe(1);
      await httpGet(callbackUrl(redirectUri, { code: "c", state }));
      expect(seam.pendingFlows.size).toBe(0);
      expect(seam.server()).toBeUndefined();
    } finally {
      restore();
    }
  });

  test("a mismatched/unknown/malformed request never cancels an active flow", async () => {
    const { result, restore } = await browserAuthorize();
    try {
      const { redirectUri, state } = authorizeParams(result.url);

      for (const params of [
        { code: "x", state: "not-the-real-state" },
        { code: "x" }, // malformed: no state at all
        { state: "no-code-either" },
      ] as Record<string, string>[]) {
        const res = await httpGet(callbackUrl(redirectUri, params));
        expect(res.body).toContain("Login failed");
      }

      // The real flow survived untouched and still completes.
      const res = await httpGet(callbackUrl(redirectUri, { code: "late-code", state }));
      expect(res.body).toContain("Login successful");
      const tokens = await result.callback();
      expect(tokens.access).toBe("at-1");
      expect(seam.pendingFlows.size).toBe(0);
    } finally {
      restore();
    }
  });

  test("error callbacks validate state and isolate failures per flow", async () => {
    const server = await seam.startCallbackServer();
    const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
    const a = seam.registerFlow("state-a");
    const b = seam.registerFlow("state-b");

    // Error carrying flow A's state rejects only A, with its description.
    const res = await httpGet(
      callbackUrl(redirect, { error: "access_denied", error_description: "user said no", state: "state-a" }),
    );
    expect(res.body).toContain("Login failed");
    expect(await a.catch((e: Error) => e.message)).toBe("user said no");
    expect(seam.pendingFlows.has("state-b")).toBe(true);

    // B is still alive: a normal callback resolves it.
    await httpGet(callbackUrl(redirect, { code: "b-code", state: "state-b" }));
    expect(await b).toBe("b-code");
  });

  test("concurrent flows share one server and do not overwrite each other", async () => {
    const tokenBodies: Record<string, any>[] = [];
    const first = await browserAuthorize(tokenBodies);
    const second = await browserAuthorize(tokenBodies);
    try {
      expect(first.result.url).not.toBe(second.result.url);
      expect(seam.pendingFlows.size).toBe(2);

      const one = authorizeParams(first.result.url);
      const two = authorizeParams(second.result.url);
      // Both flows ride the single shared server.
      expect(one.redirectUri).toBe(two.redirectUri);

      // Complete them out of order over real HTTP.
      await httpGet(callbackUrl(two.redirectUri, { code: "code-two", state: two.state }));
      await httpGet(callbackUrl(one.redirectUri, { code: "code-one", state: one.state }));

      const [t1, t2] = await Promise.all([first.result.callback(), second.result.callback()]);
      expect(t1.type).toBe("success");
      expect(t2.type).toBe("success");
      // Each flow's code went out with its own state — never crossed.
      const codeByState = new Map(tokenBodies.map((b) => [b.state, b.code]));
      expect(codeByState.get(one.state)).toBe("code-one");
      expect(codeByState.get(two.state)).toBe("code-two");
      expect(seam.pendingFlows.size).toBe(0);
    } finally {
      first.restore();
      second.restore();
    }
  });

  test("flows expire after their timeout and close the server when none remain", async () => {
    const server = await seam.startCallbackServer();
    const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
    const p = seam.registerFlow("st-timeout", 25);
    const error = await p.catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("timeout");
    expect(seam.pendingFlows.size).toBe(0);
    expect(seam.server()).toBeUndefined();
    expect(server.listening).toBe(false);

    // A timed-out flow does not disturb a concurrently active one.
    const survivor = seam.registerFlow("st-survivor");
    const expired = seam.registerFlow("st-expired", 10);
    await expired.catch((e: Error) => e);
    expect(seam.pendingFlows.has("st-survivor")).toBe(true);
    expect(seam.pendingFlows.has("st-expired")).toBe(false);
  });

  test("dispose rejects every pending flow and closes the server", async () => {
    const server = await seam.startCallbackServer();
    const a = seam.registerFlow("st-d1");
    const b = seam.registerFlow("st-d2");
    expect(seam.pendingFlows.size).toBe(2);

    seam.disposeOAuth();
    expect(seam.pendingFlows.size).toBe(0);
    expect(seam.server()).toBeUndefined();
    expect(server.listening).toBe(false);

    const errA = await a.catch((e: Error) => e);
    const errB = await b.catch((e: Error) => e);
    expect((errA as Error).message).toContain("disposed");
    expect((errB as Error).message).toContain("disposed");
  });
});
