import { describe, expect, test } from "bun:test";
import {
  CALLBACK_PATH,
  CALLBACK_PORT,
  EXPIRY_SKEW_MS,
  REDIRECT_URI,
  SCOPES,
  buildAuthUrl,
  exchangeToken,
  extractPastedCode,
  fetchUserEmail,
  newOAuthState,
  refreshToken,
} from "./oauth_flow.ts";

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
    const url = new URL(buildAuthUrl(state));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(SCOPES);
    // The native flow does not use PKCE.
    expect(url.searchParams.get("code_challenge")).toBeNull();
  });

  test("callback constants match the native client", () => {
    expect(CALLBACK_PORT).toBe(51121);
    expect(CALLBACK_PATH).toBe("/oauth-callback");
    expect(REDIRECT_URI).toBe("http://127.0.0.1:51121/oauth-callback");
  });
});

describe("paste-code extraction", () => {
  test("accepts bare codes", () => {
    expect(extractPastedCode("4/0AxxxCode", "s")).toBe("4/0AxxxCode");
  });

  test("accepts full redirect URLs with matching state", () => {
    const input = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}?code=abc&state=s`;
    expect(extractPastedCode(input, "s")).toBe("abc");
  });

  test("rejects state mismatches before any exchange", () => {
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
      () =>
        jsonResponse({
          currentTier: { id: "free-tier" },
          paidTier: { id: "free-tier" },
          cloudaicompanionProject: "proj-77",
        }),
      () =>
        jsonResponse({
          currentTier: { id: "free-tier" },
          paidTier: { id: "free-tier" },
          cloudaicompanionProject: "proj-77",
        }),
    ]);
    const credentials = await exchangeToken("code-1", REDIRECT_URI, fetcher);
    expect(credentials).toMatchObject({ refresh: "rt-1", access: "at-1", projectId: "proj-77", email: "me@example.com" });
    expect(credentials.expires).toBeGreaterThanOrEqual(Date.now() + 3600_000 - EXPIRY_SKEW_MS - 1000);

    const tokenCall = calls[0]!;
    expect(tokenCall.url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(String(tokenCall.init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-1");
    expect(body.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(body.get("client_id")).toContain(".apps.googleusercontent.com");
    expect(body.get("client_secret")).toBeTruthy();

    const userinfoCall = calls[1]!;
    expect(userinfoCall.url).toBe("https://www.googleapis.com/oauth2/v1/userinfo?alt=json");
    expect((userinfoCall.init.headers as Record<string, string>).Authorization).toBe("Bearer at-1");
  });

  test("missing refresh_token fails loudly", async () => {
    const { fetcher } = scriptedFetcher([() => jsonResponse({ access_token: "at", expires_in: 100 })]);
    await expect(exchangeToken("c", REDIRECT_URI, fetcher)).rejects.toThrow(/refresh token/i);
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
    const credentials = await refreshToken("rt-old", "proj-9", fetcher);
    expect(credentials.refresh).toBe("rt-rotated");
    expect(credentials.access).toBe("at-2");
    expect(credentials.projectId).toBe("proj-9");
    expect(credentials.expires).toBeGreaterThan(Date.now() + 3600_000 - EXPIRY_SKEW_MS - 1000);

    const body = new URLSearchParams(String(calls[0]!.init.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-old");
  });

  test("keeps the previous refresh token when upstream does not rotate", async () => {
    const { fetcher } = scriptedFetcher([() => jsonResponse({ access_token: "at-3", expires_in: 3600 })]);
    const credentials = await refreshToken("rt-keep", "p", fetcher);
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
