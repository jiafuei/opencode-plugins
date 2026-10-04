import { describe, expect, test } from "bun:test";
import { PROFILE_URL, ROLES_URL, resolveIdentity } from "./server.ts";

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

describe("resolveIdentity (login semantics)", () => {
  test.serial("missing account block: recovers full identity from profile and roles", async () => {
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
        PROFILE_URL,
        ROLES_URL,
      ]);
      expect(new Headers(calls[0]!.init!.headers).get("authorization")).toBe("Bearer access-1");
    } finally {
      restore();
    }
  });

  test.serial("roles failure does not discard a valid profile identity", async () => {
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

  test.serial("partial token identity wins while profile and roles fill missing fields", async () => {
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

  test.serial("full token identity short-circuits: no profile call at all", async () => {
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

  test.serial("profile failure is best-effort and preserves token identity", async () => {
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
