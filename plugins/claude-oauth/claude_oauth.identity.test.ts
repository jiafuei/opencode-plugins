import { describe, expect, test } from "bun:test";
import { extractIdentity, resolveIdentity } from "./claude_oauth.ts";
import { COWORK_PROFILE } from "./wire_format.ts";

const TOKEN_BODY = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_in: 3600,
};

const PROFILE_IDENTITY = {
  account: { uuid: "profile-account", email: "user@example.com" },
  organization: { uuid: "profile-org" },
};

const ROLES_IDENTITY = { organization_name: "Acme workspace", organization_role: "admin" };

interface Call {
  url: string;
  init?: RequestInit;
}

// Suites below mock globalThis.fetch, so their tests are serialized by hand
// through a shared promise chain.
let serialQueue: Promise<unknown> = Promise.resolve();
function serialTest(name: string, fn: () => Promise<void> | void) {
  test(name, async () => {
    // Run regardless of whether an earlier serialized test failed.
    const result = serialQueue.then(fn, fn);
    serialQueue = result.catch(() => {});
    await result;
  });
}

/** Mock global fetch and return captured calls. */
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

function identityResponse(url: string): Response {
  return jsonResponse(url.includes("/roles") ? ROLES_IDENTITY : PROFILE_IDENTITY);
}

describe("extractIdentity normalization", () => {
  serialTest("extracts valid token identity", () => {
    expect(extractIdentity({
      ...TOKEN_BODY,
      account: { uuid: "acct-1", email_address: "a@b.c" },
      organization: { uuid: "org-1", name: "Org" },
    })).toEqual({ accountId: "acct-1", email: "a@b.c", orgId: "org-1", orgName: "Org" });
  });
});

describe("resolveIdentity (login semantics)", () => {
  serialTest("Cowork recovers identity from the Claude CLI bootstrap request", async () => {
    const { calls, restore } = mockFetch(() => jsonResponse({
      oauth_account: {
        account_uuid: "bootstrap-account",
        account_email: "bootstrap@example.com",
        organization_uuid: "bootstrap-org",
        organization_name: "Bootstrap Org",
      },
    }));
    try {
      expect(await resolveIdentity({ ...TOKEN_BODY }, COWORK_PROFILE)).toEqual({
        accountId: "bootstrap-account",
        email: "bootstrap@example.com",
        orgId: "bootstrap-org",
        orgName: "Bootstrap Org",
      });
      expect(calls[0]!.url).toBe("https://api.anthropic.com/api/claude_cli/bootstrap?entrypoint=cli&model=claude-opus-4-8");
      const headers = new Headers(calls[0]!.init!.headers);
      expect(headers.get("user-agent")).toBe(`claude-code/${COWORK_PROFILE.version}`);
      expect(headers.get("anthropic-beta")).toBe("oauth-2025-04-20");
      expect(headers.get("authorization")).toBe("Bearer access-1");
    } finally {
      restore();
    }
  });

  serialTest("missing account block: recovers full identity from profile and roles", async () => {
    const { calls, restore } = mockFetch(identityResponse);
    try {
      const identity = await resolveIdentity({ ...TOKEN_BODY });
      expect(identity).toEqual({
        accountId: "profile-account",
        email: "user@example.com",
        orgId: "profile-org",
        orgName: "Acme workspace",
      });
      expect(calls.map((call) => call.url)).toEqual([
        "https://api.anthropic.com/api/oauth/profile",
        "https://api.anthropic.com/api/oauth/claude_cli/roles",
      ]);
      expect(new Headers(calls[0]!.init!.headers).get("authorization")).toBe("Bearer access-1");
    } finally {
      restore();
    }
  });

  serialTest("roles failure does not discard a valid profile identity", async () => {
    const { restore } = mockFetch((url) =>
      url.includes("/roles") ? Promise.reject(new Error("roles unavailable")) : jsonResponse(PROFILE_IDENTITY),
    );
    try {
      expect(await resolveIdentity({ ...TOKEN_BODY })).toEqual({
        accountId: "profile-account",
        email: "user@example.com",
        orgId: "profile-org",
        orgName: undefined,
      });
    } finally {
      restore();
    }
  });

  serialTest("partial token identity wins while profile and roles fill missing fields", async () => {
    const { restore } = mockFetch(identityResponse);
    try {
      const identity = await resolveIdentity(
        {
          ...TOKEN_BODY,
          account: { uuid: "token-account", email_address: "token@example.com" },
          organization: { name: "Token org name" },
        },
      );
      expect(identity).toEqual({
        accountId: "token-account",
        email: "token@example.com",
        orgId: "profile-org",
        orgName: "Token org name",
      });
    } finally {
      restore();
    }
  });

  serialTest("full token identity short-circuits: no profile call at all", async () => {
    const { calls, restore } = mockFetch(() => {
      throw new Error("profile must not be called");
    });
    try {
      const identity = await resolveIdentity(
        {
          ...TOKEN_BODY,
          account: { uuid: "acct", email_address: "a@b.c" },
          organization: { uuid: "org", name: "Org" },
        },
      );
      expect(identity).toEqual({ accountId: "acct", email: "a@b.c", orgId: "org", orgName: "Org" });
      expect(calls).toHaveLength(0);
    } finally {
      restore();
    }
  });

  serialTest("profile failure is best-effort and preserves token identity", async () => {
    const { restore } = mockFetch(() => Promise.reject(new Error("ECONNREFUSED")));
    try {
      expect(await resolveIdentity(
        { ...TOKEN_BODY, account: { uuid: "token-account" } },
      )).toMatchObject({ accountId: "token-account" });
    } finally {
      restore();
    }
  });
});
