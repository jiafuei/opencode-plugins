import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { setupPlugin } from "./test_harness.ts";

// ---------------------------------------------------------------------------
// Paste-code login: local state validation before token exchange, identity
// metadata, and refresh rotation.
// ---------------------------------------------------------------------------

interface TokenCall {
  body: Record<string, any>;
}

interface Harness {
  method: any;
  result: { url: string; expiresAt: number; callback: (pasted: string) => Promise<any> };
  tokenCalls: TokenCall[];
  restore: () => void;
}

async function makePasteHarness(): Promise<Harness> {
  const tokenCalls: TokenCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("platform.claude.com/v1/oauth/token")) {
      tokenCalls.push({ body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          access_token: "at-1",
          refresh_token: "rt-1",
          expires_in: 3600,
          account: { uuid: "acct-uuid", email_address: "user@example.com" },
          organization: { uuid: "org-uuid" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    const { method } = await setupPlugin({}, null);
    const result = (await method.authorize({})) as Harness["result"];
    return { method, result, tokenCalls, restore: () => (globalThis.fetch = originalFetch) };
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

describe("paste code flow", () => {
  test("uses Claude Code's registered authorization endpoint and redirect URI", async () => {
    const h = await makePasteHarness();
    try {
      const url = new URL(h.result.url);
      expect(url.origin + url.pathname).toBe("https://claude.com/cai/oauth/authorize");
      expect(url.searchParams.get("redirect_uri")).toBe("https://platform.claude.com/oauth/code/callback");
    } finally {
      h.restore();
    }
  });

  test("generates Claude Code's 32-byte base64url PKCE verifier", async () => {
    const h = await makePasteHarness();
    try {
      const { state } = authorizeParams(h.result.url);
      expect((await h.result.callback(`good-code#${state}`)).type).toBe("oauth");
      const verifier = h.tokenCalls[0]!.body.code_verifier as string;
      expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(new URL(h.result.url).searchParams.get("code_challenge")).toBe(
        createHash("sha256").update(verifier).digest("base64url"),
      );
    } finally {
      h.restore();
    }
  });

  test("mismatched state fails locally for redirect URL and code#state formats", async () => {
    for (const format of ["redirect", "fragment"] as const) {
      const h = await makePasteHarness();
      try {
        const { redirectUri, state } = authorizeParams(h.result.url);
        const wrongState = `WRONG-${state}`;
        const pasted =
          format === "redirect"
            ? `${redirectUri}?${new URLSearchParams({ code: "real-code", state: wrongState })}`
            : `real-code#${wrongState}`;
        const error = (await h.result.callback(pasted).catch((error: Error) => error)) as Error;
        expect(error.message).toMatch(/state does not match/i);
        expect(error.message).not.toContain("real-code");
        expect(error.message).not.toContain(wrongState);
        expect(h.tokenCalls).toHaveLength(0);
      } finally {
        h.restore();
      }
    }
  });

  test("valid redirect URL and code#state formats exchange the generated state", async () => {
    for (const format of ["redirect", "fragment"] as const) {
      const h = await makePasteHarness();
      try {
        const { redirectUri, state } = authorizeParams(h.result.url);
        const pasted =
          format === "redirect"
            ? `${redirectUri}?${new URLSearchParams({ code: "good-code", state })}`
            : `good-code#${state}`;
        const result = await h.result.callback(pasted);
        expect(result).toMatchObject({
          type: "oauth",
          methodID: "claude-pro-max",
          access: "at-1",
          refresh: "rt-1",
          metadata: { accountId: "acct-uuid", email: "user@example.com", orgId: "org-uuid" },
        });
        expect(h.method.label(result)).toBe("user@example.com");
        expect(h.tokenCalls).toHaveLength(1);
        expect(h.tokenCalls[0]!.body.code).toBe("good-code");
        expect(h.tokenCalls[0]!.body.state).toBe(state);
        expect(h.tokenCalls[0]!.body.redirect_uri).toBe("https://platform.claude.com/oauth/code/callback");
      } finally {
        h.restore();
      }
    }
  });

  test("the authorization expires after five minutes", async () => {
    const h = await makePasteHarness();
    try {
      expect(h.result.expiresAt - Date.now()).toBeGreaterThan(4 * 60 * 1000);
      expect(h.result.expiresAt - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
    } finally {
      h.restore();
    }
  });

  test("refresh rotates tokens and keeps login identity", async () => {
    const h = await makePasteHarness();
    try {
      const credential = {
        type: "oauth",
        methodID: "claude-pro-max",
        access: "old",
        refresh: "old-refresh",
        expires: 0,
        metadata: { accountId: "kept" },
      };
      const refreshed = await h.method.refresh(credential);
      expect(h.tokenCalls[0]!.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "old-refresh" });
      expect(h.tokenCalls[0]!.body.scope).not.toContain("org:create_api_key");
      expect(refreshed).toMatchObject({ access: "at-1", refresh: "rt-1", metadata: { accountId: "kept" } });
      expect(refreshed.expires).toBeGreaterThan(Date.now());
    } finally {
      h.restore();
    }
  });
});
