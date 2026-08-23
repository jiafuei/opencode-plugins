import { describe, expect, test } from "bun:test";
import {
  ClaudeOAuthPlugin,
  extractIdentity,
  fetchBootstrapIdentity,
  resolveIdentity,
} from "./claude_oauth.ts";

const TOKEN_BODY = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_in: 3600,
};

const BOOTSTRAP_IDENTITY = {
  oauth_account: {
    account_uuid: "bootstrap-account",
    account_email: "user@example.com",
    organization_uuid: "bootstrap-org",
    organization_name: "Acme workspace",
  },
};

interface Call {
  url: string;
  init?: RequestInit;
}

// Bun runs async tests concurrently by default; suites below mock
// globalThis.fetch and drive stateful plugin loaders, so their tests are
// serialized by hand through a shared promise chain.
let serialQueue: Promise<unknown> = Promise.resolve();
function serialTest(name: string, fn: () => Promise<void> | void) {
  test(name, async () => {
    // Run regardless of whether an earlier serialized test failed.
    const result = serialQueue.then(fn, fn);
    serialQueue = result.catch(() => {});
    await result;
  });
}

/** Mock global fetch, routing token vs bootstrap endpoints; returns captured calls. */
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

describe("extractIdentity normalization", () => {
  serialTest("normalizes missing, invalid, and valid identity fields", () => {
    const empty = { accountId: undefined, email: undefined, orgId: undefined, orgName: undefined };
    const cases = [
      {
        input: {
          ...TOKEN_BODY,
          account: { uuid: "", email_address: undefined as unknown as string },
          organization: { uuid: 42 as unknown as string, name: "" },
        },
        expected: empty,
      },
      {
        input: {
          ...TOKEN_BODY,
          account: { uuid: "acct-1", email_address: "a@b.c" },
          organization: { uuid: "org-1", name: "Org" },
        },
        expected: { accountId: "acct-1", email: "a@b.c", orgId: "org-1", orgName: "Org" },
      },
      { input: TOKEN_BODY, expected: empty },
    ];
    for (const { input, expected } of cases) {
      expect(extractIdentity(input)).toEqual(expected);
    }
  });
});

// Serialized: these suites mock globalThis.fetch and drive stateful plugin
// loaders, so interleaved async tests would see each other's mocks.
describe("resolveIdentity (login semantics)", () => {
  serialTest("missing account block: recovers full identity from bootstrap", async () => {
    const { calls, restore } = mockFetch(() => jsonResponse(BOOTSTRAP_IDENTITY));
    try {
      const identity = await resolveIdentity({ ...TOKEN_BODY }, { includeOrg: true });
      expect(identity).toEqual({
        accountId: "bootstrap-account",
        email: "user@example.com",
        orgId: "bootstrap-org",
        orgName: "Acme workspace",
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe("https://api.anthropic.com/api/claude_cli/bootstrap?entrypoint=cli&model=claude-opus-4-8");
    } finally {
      restore();
    }
  });

  serialTest("partial account (uuid present, email missing): bootstrap fills email without touching the token's account id", async () => {
    const { calls, restore } = mockFetch(() => jsonResponse(BOOTSTRAP_IDENTITY));
    try {
      const identity = await resolveIdentity(
        { ...TOKEN_BODY, account: { uuid: "token-account", email_address: "" } },
        { includeOrg: true },
      );
      // Token response fields win over bootstrap fields.
      expect(identity.accountId).toBe("token-account");
      expect(identity.email).toBe("user@example.com");
      expect(identity.orgId).toBe("bootstrap-org");
      expect(calls).toHaveLength(1);
    } finally {
      restore();
    }
  });

  serialTest("complete account but missing org: bootstrap is still consulted on login", async () => {
    const { calls, restore } = mockFetch((url) =>
      url.includes("/bootstrap") ? jsonResponse(BOOTSTRAP_IDENTITY) : jsonResponse({}),
    );
    try {
      const identity = await resolveIdentity(
        {
          ...TOKEN_BODY,
          account: { uuid: "token-account", email_address: "token@example.com" },
        },
        { includeOrg: true },
      );
      expect(identity.accountId).toBe("token-account");
      expect(identity.email).toBe("token@example.com");
      expect(identity.orgId).toBe("bootstrap-org");
      expect(identity.orgName).toBe("Acme workspace");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toContain("/api/claude_cli/bootstrap");
    } finally {
      restore();
    }
  });

  serialTest("full token identity short-circuits: no bootstrap call at all", async () => {
    const { calls, restore } = mockFetch(() => {
      throw new Error("bootstrap must not be called");
    });
    try {
      const identity = await resolveIdentity(
        {
          ...TOKEN_BODY,
          account: { uuid: "acct", email_address: "a@b.c" },
          organization: { uuid: "org", name: "Org" },
        },
        { includeOrg: true },
      );
      expect(identity).toEqual({ accountId: "acct", email: "a@b.c", orgId: "org", orgName: "Org" });
      expect(calls).toHaveLength(0);
    } finally {
      restore();
    }
  });

  serialTest("empty-string fields count as incomplete and trigger bootstrap; token values still win", async () => {
    const { calls, restore } = mockFetch(() => jsonResponse(BOOTSTRAP_IDENTITY));
    try {
      const identity = await resolveIdentity(
        {
          ...TOKEN_BODY,
          account: { uuid: "token-account", email_address: "" },
          organization: { uuid: "", name: "x" },
        },
        { includeOrg: true },
      );
      // Empty org uuid makes login incomplete → bootstrap runs; the token
      // response's non-empty fields (uuid, name "x") still win over bootstrap.
      expect(calls).toHaveLength(1);
      expect(identity).toEqual({
        accountId: "token-account",
        email: "user@example.com",
        orgId: "bootstrap-org",
        orgName: "x",
      });
    } finally {
      restore();
    }
  });

  const bootstrapFailures: [label: string, responder: (url: string) => Response | Promise<Response>][] = [
    ["network failure", () => Promise.reject(new Error("ECONNREFUSED"))],
    ["non-OK response", () => jsonResponse({ error: "nope" }, 403)],
    ["malformed JSON", () => jsonResponse("<html>gateway error</html>")],
    ["timeout abort", () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"))],
  ];
  for (const [label, responder] of bootstrapFailures) {
    serialTest(`bootstrap ${label} is strictly best-effort: token-derived identity survives`, async () => {
      const { calls, restore } = mockFetch(responder);
      try {
        const identity = await resolveIdentity(
          { ...TOKEN_BODY, account: { uuid: "token-account" } },
          { includeOrg: true },
        );
        expect(identity).toEqual({
          accountId: "token-account",
          email: undefined,
          orgId: undefined,
          orgName: undefined,
        });
        expect(calls).toHaveLength(1); // bootstrap attempted exactly once
      } finally {
        restore();
      }
    });
  }

  serialTest("bootstrap returning an all-empty oauth_account yields undefined fields, not a crash", async () => {
    const { restore } = mockFetch(() => jsonResponse({ oauth_account: {} }));
    try {
      const identity = await resolveIdentity({ ...TOKEN_BODY }, { includeOrg: true });
      expect(identity).toEqual({ accountId: undefined, email: undefined, orgId: undefined, orgName: undefined });
    } finally {
      restore();
    }
  });

  serialTest("fetchBootstrapIdentity surfaces non-OK and invalid JSON to callers (which swallow them)", async () => {
    {
      const { restore } = mockFetch(() => jsonResponse({}, 500));
      try {
        await expect(fetchBootstrapIdentity("tok")).rejects.toThrow("500");
      } finally {
        restore();
      }
    }
    {
      const { restore } = mockFetch(() => jsonResponse("not json"));
      try {
        await expect(fetchBootstrapIdentity("tok")).rejects.toThrow();
      } finally {
        restore();
      }
    }
  });

  serialTest("refresh path (includeOrg unset): missing org alone does not trigger bootstrap", async () => {
    const { calls, restore } = mockFetch(() => {
      throw new Error("bootstrap must not be called");
    });
    try {
      const identity = await resolveIdentity({
        ...TOKEN_BODY,
        account: { uuid: "acct", email_address: "a@b.c" },
        // organization deliberately absent — irrelevant on refresh
      });
      expect(identity.orgId).toBeUndefined();
      expect(calls).toHaveLength(0);
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Refresh through the plugin loader: stored accountId preservation + persistence
// ---------------------------------------------------------------------------

describe("refresh accountId preservation", () => {
  const EXPIRED_AUTH = {
    type: "oauth" as const,
    access: "stale-access",
    refresh: "stale-refresh",
    expires: Date.now() - 1000,
    accountId: "stored-account",
  };

  interface Persisted {
    refresh?: string;
    access?: string;
    expires?: number;
    accountId?: string;
  }

  async function runRefreshedFetch(auth: Record<string, unknown>, responder: (url: string) => Response | Promise<Response>) {
    // Clone: the loader mutates the auth object it receives (access/accountId
    // are cached on it after a refresh), so each test needs its own copy.
    const authState = structuredClone(auth);
    const persisted: Persisted[] = [];
    const plugin = await ClaudeOAuthPlugin({
      client: {
        auth: {
          set: async ({ body }: { body: Persisted }) => {
            persisted.push(body);
          },
        },
      },
    } as never);
    const options = await plugin.auth!.loader!(async () => authState as never, {} as never);
    const mock = mockFetch(responder);
    try {
      await options.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [], max_tokens: 1 }),
      });
    } finally {
      mock.restore();
    }
    return { persisted, calls: mock.calls };
  }

  function tokenResponse(overrides: Record<string, unknown> = {}) {
    return jsonResponse({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
      ...overrides,
    });
  }

  serialTest("refresh response with no identity preserves the stored accountId when bootstrap also fails", async () => {
    const { persisted, calls } = await runRefreshedFetch(EXPIRED_AUTH, (url) =>
      url.includes("/v1/oauth/token") ? tokenResponse() : jsonResponse({ error: "down" }, 500),
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ access: "new-access", refresh: "new-refresh", accountId: "stored-account" });
    // Bootstrap was attempted once before falling back.
    expect(calls.filter((c) => c.url.includes("/bootstrap"))).toHaveLength(1);
  });

  serialTest("refresh response with empty-string uuid normalizes away and bootstrap fills the gap", async () => {
    const { persisted } = await runRefreshedFetch(EXPIRED_AUTH, (url) =>
      url.includes("/v1/oauth/token")
        ? tokenResponse({ account: { uuid: "", email_address: "" } })
        : jsonResponse(BOOTSTRAP_IDENTITY),
    );
    // Empty strings normalize away; bootstrap then fills the gap (stored value absent from response).
    expect(persisted[0]?.accountId).toBe("bootstrap-account");
  });

  serialTest("refresh with null identity AND failed bootstrap keeps stored accountId verbatim", async () => {
    const { persisted } = await runRefreshedFetch(EXPIRED_AUTH, (url) => {
      if (url.includes("/v1/oauth/token")) return tokenResponse({ account: { uuid: null } });
      if (url.includes("/bootstrap")) return Promise.reject(new Error("offline"));
      return jsonResponse({});
    });
    expect(persisted[0]?.accountId).toBe("stored-account");
  });

  serialTest("refresh with no stored accountId resolves one from bootstrap", async () => {
    const { persisted } = await runRefreshedFetch(
      { type: "oauth", access: "stale-access", refresh: "stale-refresh", expires: Date.now() - 1000 },
      (url) => (url.includes("/v1/oauth/token") ? tokenResponse() : jsonResponse(BOOTSTRAP_IDENTITY)),
    );
    expect(persisted[0]?.accountId).toBe("bootstrap-account");
  });

  serialTest("refresh response identity wins over the stored accountId when present", async () => {
    const { persisted } = await runRefreshedFetch(EXPIRED_AUTH, (url) => {
      if (url.includes("/v1/oauth/token")) {
        return tokenResponse({
          account: { uuid: "rotated-account", email_address: "fresh@example.com" },
          organization: { uuid: "rotated-org", name: "New org" },
        });
      }
      if (url.includes("/bootstrap")) return Promise.reject(new Error("bootstrap must not be called"));
      return jsonResponse({});
    });
    expect(persisted[0]?.accountId).toBe("rotated-account");
  });
});
