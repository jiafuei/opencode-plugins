import { describe, expect, test } from "bun:test";
import { setSystemTime } from "bun:test";
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
    if (url.includes("api.anthropic.com/v1/oauth/token")) {
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
    const pasteMethod = plugin.auth!.methods!.find((m) => m.label === "Claude Pro/Max (paste code)")!;
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
  test("full redirect URL with a mismatched state fails locally without a token exchange", async () => {
    const h = await makePasteHarness();
    try {
      const { redirectUri, state } = authorizeParams(h.result.url);
      const pasted = `${redirectUri}?${new URLSearchParams({ code: "real-code", state: `WRONG-${state}` })}`;
      const result = await h.result.callback(pasted);
      expect(result.type).toBe("failed");
      // Rejected before any network work.
      expect(h.tokenCalls).toHaveLength(0);
      // Actionable log guidance, never echoing pasted material.
      const logged = h.warnings.join("\n");
      expect(logged).toMatch(/state does not match/i);
      expect(logged).toContain("opencode auth login");
      expect(logged).not.toContain("real-code");
      expect(logged).not.toContain(`WRONG-${state}`);
    } finally {
      h.restore();
    }
  });

  test("`code#state` with a mismatched state fragment fails locally without a token exchange", async () => {
    const h = await makePasteHarness();
    try {
      const { state } = authorizeParams(h.result.url);
      const result = await h.result.callback(`real-code#other-state`);
      void state;
      expect(result.type).toBe("failed");
      expect(h.tokenCalls).toHaveLength(0);
      const logged = h.warnings.join("\n");
      expect(logged).toMatch(/state does not match/i);
      expect(logged).not.toContain("real-code");
      expect(logged).not.toContain("other-state");
    } finally {
      h.restore();
    }
  });

  test("a correct full redirect URL succeeds and exchanges with the generated state", async () => {
    const h = await makePasteHarness();
    try {
      const { redirectUri, state } = authorizeParams(h.result.url);
      const pasted = `${redirectUri}?${new URLSearchParams({ code: "good-code", state })}`;
      const result = await h.result.callback(pasted);
      expect(result.type).toBe("success");
      expect(h.tokenCalls).toHaveLength(1);
      expect(h.tokenCalls[0]!.body.code).toBe("good-code");
      expect(h.tokenCalls[0]!.body.state).toBe(state);
    } finally {
      h.restore();
    }
  });

  test("a correct bare `code#state` succeeds", async () => {
    const h = await makePasteHarness();
    try {
      const { state } = authorizeParams(h.result.url);
      const result = await h.result.callback(`good-code#${state}`);
      expect(result.type).toBe("success");
      expect(h.tokenCalls).toHaveLength(1);
      expect(h.tokenCalls[0]!.body.code).toBe("good-code");
      expect(h.tokenCalls[0]!.body.state).toBe(state);
    } finally {
      h.restore();
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
