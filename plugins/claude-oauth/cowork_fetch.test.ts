import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildEnforcedHeaders, buildOrderedHeaders, coworkFetch } from "./cowork_fetch.ts";

// Modeled on oh-my-pi's cowork-fetch-proxy.test.ts: the transport runs on
// node:https, so a configured proxy (or any non-HTTPS / Request-object input)
// must leave this transport and use global fetch instead.

describe("coworkFetch bypass handling", () => {
  const nativeFetch = globalThis.fetch;
  let calls: Array<{ url: string; proxy: unknown; headers: RequestInit["headers"] }>;

  beforeEach(() => {
    calls = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: input instanceof Request ? input.url : String(input),
        proxy: (init as { proxy?: unknown } | undefined)?.proxy,
        headers: init?.headers,
      });
      return new Response("ok");
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
  });

  test("delegates a proxied request to the global fetch, proxy option intact", async () => {
    const response = await coworkFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      proxy: "http://127.0.0.1:24560",
    } as RequestInit);

    expect(await response.text()).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]!.proxy).toBe("http://127.0.0.1:24560");
  });

  test("drops managed caller headers on the proxy fallback path", async () => {
    const headers = buildEnforcedHeaders(
      new Headers({ authorization: "Bearer stale", "x-api-key": "leak-me-not", "x-claude-oauth-request-id": "marker" }),
      {
        profile: "sdk-cli",
        userAgent: "claude-cli/2.1.224 (external, sdk-cli)",
        authorization: "Bearer token",
        clientRequestId: "request-1",
        stainless: {},
      },
    );

    await coworkFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: "{}",
      proxy: "http://127.0.0.1:24560",
    } as RequestInit);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers).toBe(headers);
    expect(Object.values(headers)).not.toContain("Bearer stale");
    expect(Object.values(headers)).not.toContain("leak-me-not");
    expect(Object.values(headers)).not.toContain("marker");
    expect(headers.Authorization).toBe("Bearer token");
  });

  test("delegates Request-object input to the global fetch", async () => {
    await coworkFetch(new Request("https://api.anthropic.com/v1/messages"));
    expect(calls).toHaveLength(1);
  });

  test("delegates non-https targets to the global fetch", async () => {
    await coworkFetch("http://api.anthropic.com/v1/messages", { headers: { accept: "*/*" } });
    expect(calls).toHaveLength(1);
  });

  test("keeps unproxied https requests on the cowork transport", async () => {
    // Unreachable loopback port: reaching the node:https path fails to connect
    // instead of delegating, which is what proves the request stayed here.
    await expect(coworkFetch("https://127.0.0.1:1/v1/messages", { headers: { accept: "*/*" } })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("buildOrderedHeaders", () => {
  const url = new URL("https://api.anthropic.com/v1/messages?beta=true");

  test("inserts Host before Accept-Encoding and appends Content-Length last", () => {
    const headers = buildOrderedHeaders(url, { Connection: "keep-alive", "Accept-Encoding": "gzip" }, '{"a":1}');
    expect(Object.keys(headers)).toEqual(["Connection", "Host", "Accept-Encoding", "Content-Length"]);
    expect(headers.Host).toBe("api.anthropic.com");
    expect(headers["Content-Length"]).toBe("7");
  });

  test("appends Host at the end when no Accept-Encoding is present, honoring explicit values", () => {
    const headers = buildOrderedHeaders(
      url,
      { Host: "custom.example.com", Accept: "*/*" },
      undefined,
    );
    expect(Object.keys(headers)).toEqual(["Host", "Accept"]);
    expect(headers.Host).toBe("custom.example.com");
    // No body → no Content-Length.
    expect(headers["Content-Length"]).toBeUndefined();
  });

  test("computes Content-Length in bytes for multibyte bodies", () => {
    const headers = buildOrderedHeaders(url, {}, "héllo");
    expect(headers["Content-Length"]).toBe(String(Buffer.byteLength("héllo")));
  });
});

describe("buildEnforcedHeaders", () => {
  test("orders the OMP enforced sequence for cowork profile, dropping caller extras and managed keys", () => {
    const caller = new Headers({
      "content-type": "application/json",
      "user-agent": "my-client/1.0",
      authorization: "Bearer stale",
      "x-api-key": "leak-me-not",
      "x-session-affinity": "ses_opencode",
      "x-claude-oauth-request-id": "private-marker",
      "x-custom-extra": "keep-me",
    });
    const headers = buildEnforcedHeaders(caller, {
      profile: "cowork",
      userAgent: "claude-cli/2.1.246 (external, claude-desktop)",
      sessionId: "session-1",
      betas: "beta-one,beta-two",
      authorization: "Bearer real-token",
      clientRequestId: "11111111-2222-3333-4444-555555555555",
      stainless: { "X-Stainless-Lang": "js", "X-Stainless-Package-Version": "0.112.1" },
    });
    expect(Object.keys(headers)).toEqual([
      "Accept",
      "Content-Type",
      "User-Agent",
      "X-Claude-Code-Session-Id",
      "X-Stainless-Lang",
      "X-Stainless-Package-Version",
      "anthropic-beta",
      "anthropic-dangerous-direct-browser-access",
      "anthropic-version",
      "Authorization",
      "x-app",
      "x-client-request-id",
      "Connection",
      "Accept-Encoding",
    ]);
    expect(headers["x-custom-extra"]).toBeUndefined();
    expect(headers.Authorization).toBe("Bearer real-token");
    // Managed caller keys (stale auth, api key, routing, private markers) are gone.
    for (const absent of ["x-api-key", "x-session-affinity", "x-claude-oauth-request-id", "authorization"]) {
      expect(Object.keys(headers).some((key) => key.toLowerCase() === absent && headers[key] === undefined)).toBe(false);
    }
    expect(Object.values(headers)).not.toContain("leak-me-not");
    expect(Object.values(headers)).not.toContain("Bearer stale");
    expect(headers["User-Agent"]).toBe("claude-cli/2.1.246 (external, claude-desktop)");
    expect(headers["x-app"]).toBe("cli");
  });

  test("omits optional session/beta entries when absent", () => {
    const headers = buildEnforcedHeaders(new Headers(), {
      profile: "cowork",
      userAgent: "ua",
      authorization: "Bearer t",
      clientRequestId: "id",
      stainless: {},
    });
    expect("X-Claude-Code-Session-Id" in headers).toBe(false);
    expect("anthropic-beta" in headers).toBe(false);
  });

  test("orders sdk-cli headers like the captured Claude CLI sequence, dropping unknown caller headers", () => {
    const headers = buildEnforcedHeaders(new Headers({ cookie: "private", "x-extra": "kept" }), {
      profile: "sdk-cli",
      userAgent: "claude-cli/2.1.224 (external, sdk-cli)",
      sessionId: "session-1",
      betas: "beta-one",
      authorization: "Bearer token",
      clientRequestId: "request-1",
      stainless: { "X-Stainless-Arch": "x64", "X-Stainless-Lang": "js" },
    });
    expect(Object.keys(headers)).toEqual([
      "Accept",
      "Authorization",
      "Content-Type",
      "User-Agent",
      "X-Claude-Code-Session-Id",
      "X-Stainless-Arch",
      "X-Stainless-Lang",
      "anthropic-beta",
      "anthropic-dangerous-direct-browser-access",
      "anthropic-version",
      "x-app",
      "x-client-request-id",
      "Connection",
      "Accept-Encoding",
    ]);
    expect(headers["cookie"]).toBeUndefined();
    expect(headers["x-extra"]).toBeUndefined();
  });

  test("drops unknown SDK CLI caller headers", () => {
    const headers = buildEnforcedHeaders(new Headers({ "x-extra": "drop-me" }), {
      profile: "sdk-cli",
      userAgent: "claude-cli/2.1.224 (external, sdk-cli)",
      authorization: "Bearer token",
      clientRequestId: "request-1",
      stainless: {},
    });
    expect(headers["x-extra"]).toBeUndefined();
  });
});
