import { describe, expect, test } from "bun:test";
import { setSystemTime } from "bun:test";
import { createHash } from "node:crypto";
import { ClaudeOAuthPlugin } from "./claude_oauth.ts";

// ---------------------------------------------------------------------------
// Paste-code login: local state validation before token exchange, the
// five-minute authorization window, and error sanitization.
// ---------------------------------------------------------------------------

interface TokenCall {
  body: Record<string, any>;
}

interface Harness {
  result: { url: string; callback: (pasted: string) => Promise<{ type: string }> };
  tokenCalls: TokenCall[];
  warnings: string[];
  restore: () => void;
}

async function makePasteHarness(): Promise<Harness> {
  const tokenCalls: TokenCall[] = [];
  const warnings: string[] = [];
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
          account: { uuid: "acct-uuid" },
          organization: { uuid: "org-uuid" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    const plugin = await ClaudeOAuthPlugin({
      client: {
        app: {
          log: async ({ body }: { body: { message: string } }) => {
            warnings.push(body.message);
          },
        },
      },
    } as never);
    const pasteMethod = plugin.auth!.methods!.find((m) => m.label === "Claude Pro/Max")!;
    const result = (await pasteMethod.authorize!()) as Harness["result"];
    return { result, tokenCalls, warnings, restore: () => (globalThis.fetch = originalFetch) };
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
      expect((await h.result.callback(`good-code#${state}`)).type).toBe("success");
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
        const result = await h.result.callback(pasted);
        expect(result.type).toBe("failed");
        expect(h.tokenCalls).toHaveLength(0);
        const logged = h.warnings.join("\n");
        expect(logged).toMatch(/state does not match/i);
        expect(logged).not.toContain("real-code");
        expect(logged).not.toContain(wrongState);
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
        expect(result.type).toBe("success");
        expect(h.tokenCalls).toHaveLength(1);
        expect(h.tokenCalls[0]!.body.code).toBe("good-code");
        expect(h.tokenCalls[0]!.body.state).toBe(state);
        expect(h.tokenCalls[0]!.body.redirect_uri).toBe("https://platform.claude.com/oauth/code/callback");
      } finally {
        h.restore();
      }
    }
  });

  test("pasting after the five-minute window fails without a token exchange", async () => {
    const h = await makePasteHarness();
    try {
      const { redirectUri, state } = authorizeParams(h.result.url);
      // Jump just past the five-minute authorization window.
      setSystemTime(Date.now() + 5 * 60 * 1000 + 1);
      const result = await h.result.callback(`${redirectUri}?${new URLSearchParams({ code: "late-code", state })}`);
      expect(result.type).toBe("failed");
      expect(h.tokenCalls).toHaveLength(0);
      expect(h.warnings.join("\n")).toMatch(/window expired/i);
    } finally {
      setSystemTime(); // restore real time
      h.restore();
    }
  });

  test("within the window, a valid paste still succeeds (expiry is not over-eager)", async () => {
    const h = await makePasteHarness();
    try {
      const { redirectUri, state } = authorizeParams(h.result.url);
      setSystemTime(Date.now() + 4 * 60 * 1000);
      const result = await h.result.callback(`${redirectUri}?${new URLSearchParams({ code: "in-time", state })}`);
      expect(result.type).toBe("success");
      expect(h.tokenCalls).toHaveLength(1);
    } finally {
      setSystemTime(); // restore real time
      h.restore();
    }
  });
});
