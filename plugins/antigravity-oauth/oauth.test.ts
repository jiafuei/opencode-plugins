import { describe, expect, test } from "bun:test";
import {
  CALLBACK_PATH,
  buildAuthUrl,
  exchangeToken,
  extractPastedCode,
  fetchUserEmail,
  newOAuthState,
  refreshToken,
} from "./oauth_flow.ts";

const REDIRECT_URI = `http://localhost:50000${CALLBACK_PATH}`;

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function scriptedFetcher(
  handlers: Array<(url: string, init: RequestInit) => Response | Promise<Response>>,
): { fetcher: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetcher = (async (url: any, init: any = {}) => {
    calls.push({ url: String(url), init });
    const handler = handlers[index++];
    if (!handler) throw new Error(`unexpected fetch #${index} to ${url}`);
    return await handler(String(url), init);
  }) as typeof fetch;
  return { fetcher, calls };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Authorization URL & paste-code handling
// ---------------------------------------------------------------------------

describe("authorization URL", () => {
  test("mirrors the native installed-app flow", () => {
    const state = newOAuthState();
    const url = new URL(buildAuthUrl(state, REDIRECT_URI));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/cclog",
      "https://www.googleapis.com/auth/experimentsandconfigs",
    ]);
    // The native flow does not use PKCE.
    expect(url.searchParams.get("code_challenge")).toBeNull();
  });
});

describe("paste-code extraction", () => {
  // Full redirect URLs are covered end to end by the paste method in plugin.test.ts.
  test("accepts bare codes and rejects other attempts' state before any exchange", () => {
    expect(extractPastedCode("4/0AxxxCode", "s")).toBe("4/0AxxxCode");
    expect(extractPastedCode("abc#other", "s")).toBeUndefined();
    expect(extractPastedCode("http://x/?code=abc&state=zzz", "s")).toBeUndefined();
    expect(extractPastedCode("", "s")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Token exchange & refresh
// ---------------------------------------------------------------------------

describe("token exchange", () => {
  test("exchanges the code and resolves email + project", async () => {
    const { fetcher, calls } = scriptedFetcher([
      () => jsonResponse({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }),
      () => jsonResponse({ email: "me@example.com" }),
      () => jsonResponse({ currentTier: { id: "free-tier" }, cloudaicompanionProject: "proj-77" }),
    ]);
    const credentials = await exchangeToken("code-1", REDIRECT_URI, fetcher);
    expect(credentials).toMatchObject({ refresh: "rt-1", access: "at-1", projectId: "proj-77", email: "me@example.com" });
    expect(credentials.expires - Date.now()).toBeWithin(55 * 60_000 - 1000, 55 * 60_000 + 1);

    const tokenCall = calls[0]!;
    expect(tokenCall.url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(String(tokenCall.init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-1");
    expect(body.get("redirect_uri")).toBe(REDIRECT_URI);
    // Login runs on the IDE's Node side (google-auth-library form order and headers).
    expect([...body.keys()]).toEqual(["client_id", "code", "grant_type", "redirect_uri", "client_secret"]);
    expect(tokenCall.init.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "google-api-nodejs-client/10.3.0",
      "x-goog-api-client": "gl-node/22.21.1",
    });
    expect(calls[1]!.init.headers).toMatchObject({
      "User-Agent": "antigravity/2.5.5 windows/amd64 google-api-nodejs-client/10.3.0",
    });
  });

  test("endpoint errors never echo credential-bearing bodies", async () => {
    const { fetcher } = scriptedFetcher([
      () =>
        new Response(
          JSON.stringify({ error: "invalid_grant", access_token: "SUPER-SECRET-TOKEN-VALUE" }),
          { status: 400 },
        ),
    ]);
    try {
      await exchangeToken("c", REDIRECT_URI, fetcher);
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("HTTP 400");
      expect((error as Error).message).not.toContain("SUPER-SECRET-TOKEN-VALUE");
    }
  });
});

describe("token refresh", () => {
  test("preserves rotated refresh tokens and applies the expiry skew", async () => {
    const { fetcher, calls } = scriptedFetcher([
      () => jsonResponse({ access_token: "at-2", refresh_token: "rt-rotated", expires_in: 3600 }),
    ]);
    const credentials = await refreshToken("rt-old", fetcher);
    expect(credentials.refresh).toBe("rt-rotated");
    expect(credentials.access).toBe("at-2");
    // A one-hour token is used for 55 minutes.
    expect(credentials.expires - Date.now()).toBeWithin(55 * 60_000 - 1000, 55 * 60_000 + 1);

    const body = new URLSearchParams(String(calls[0]!.init.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-old");
    // Refresh runs in the language server's Go HTTP/2 client: sorted form keys, Go's user agent.
    expect([...body.keys()]).toEqual(["client_id", "client_secret", "grant_type", "refresh_token"]);
    expect(calls[0]!.init.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept-Encoding": "gzip",
      "User-Agent": "Go-http-client/2.0",
    });
  });

  test("keeps the previous refresh token when upstream does not rotate", async () => {
    const { fetcher } = scriptedFetcher([() => jsonResponse({ access_token: "at-3", expires_in: 3600 })]);
    const credentials = await refreshToken("rt-keep", fetcher);
    expect(credentials.refresh).toBe("rt-keep");
  });
});

describe("optional user email", () => {
  test("failures are tolerated", async () => {
    const failing = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(fetchUserEmail("tok", failing)).resolves.toBeUndefined();
    const throwing = (async (): Promise<Response> => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(fetchUserEmail("tok", throwing)).resolves.toBeUndefined();
  });
});
