import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildEnforcedHeaders, buildOrderedHeaders, coworkFetch } from "./cowork_fetch.ts";

// Modeled on oh-my-pi's cowork-fetch-proxy.test.ts: the transport runs on
// node:https, so a configured proxy (or any non-HTTPS / Request-object input)
// must leave this transport and use global fetch instead.

describe("coworkFetch bypass handling", () => {
  const nativeFetch = globalThis.fetch;
  let calls: Array<{ url: string; proxy: unknown }>;

  beforeEach(() => {
    calls = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: input instanceof Request ? input.url : String(input),
        proxy: (init as { proxy?: unknown } | undefined)?.proxy,
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
  test("orders caller extras first, then the OMP enforced sequence, dropping managed keys", () => {
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
      order: "cowork",
      userAgent: "claude-cli/2.1.220 (external, claude-desktop)",
      sessionId: "session-1",
      betas: "beta-one,beta-two",
      authorization: "Bearer real-token",
      clientRequestId: "11111111-2222-3333-4444-555555555555",
      stainless: { "X-Stainless-Lang": "js", "X-Stainless-Package-Version": "0.94.0" },
    });
    expect(Object.keys(headers)).toEqual([
      "x-custom-extra",
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
    expect(headers.Authorization).toBe("Bearer real-token");
    // Managed caller keys (stale auth, api key, routing, private markers) are gone.
    for (const absent of ["x-api-key", "x-session-affinity", "x-claude-oauth-request-id", "authorization"]) {
      expect(Object.keys(headers).some((key) => key.toLowerCase() === absent && headers[key] === undefined)).toBe(false);
    }
    expect(Object.values(headers)).not.toContain("leak-me-not");
    expect(Object.values(headers)).not.toContain("Bearer stale");
    expect(headers["User-Agent"]).toBe("claude-cli/2.1.220 (external, claude-desktop)");
    expect(headers["x-app"]).toBe("cli");
  });

  test("omits optional session/beta entries when absent", () => {
    const headers = buildEnforcedHeaders(new Headers(), {
      order: "cowork",
      userAgent: "ua",
      authorization: "Bearer t",
      clientRequestId: "id",
      stainless: {},
    });
    expect("X-Claude-Code-Session-Id" in headers).toBe(false);
    expect("anthropic-beta" in headers).toBe(false);
  });

  test("matches genuine Claude CLI header order and casing", () => {
    const headers = buildEnforcedHeaders(new Headers({ "x-extra": "kept" }), {
      order: "cli",
      userAgent: "claude-cli/2.1.241 (external, cli)",
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
      "x-extra",
      "Connection",
      "Accept-Encoding",
    ]);
  });
});
