import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AnthropicReauthRequiredError, ClaudeOAuthPlugin, grantTestSeam } from "./claude_oauth.ts";

// Bun runs async tests concurrently by default; these suites mock
// globalThis.fetch and share module-level state (warned-grant dedup set), so
// their tests are serialized by hand through a promise chain.
let serialQueue: Promise<unknown> = Promise.resolve();
function serialTest(name: string, fn: () => Promise<void> | void) {
  test(name, async () => {
    const result = serialQueue.then(fn, fn);
    serialQueue = result.catch(() => {});
    await result;
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Fixed "now" for the injected clock.
const T0 = 1_800_000_000_000;

/** Isolate the data dir and grant-test state under a fresh temp dir per test. */
function useGrantsEnv(): { dir: string; restore: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "claude-oauth-grants-"));
  const prev = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  grantTestSeam.clock.now = () => T0;
  grantTestSeam.warnedGrantKeys.clear();
  return {
    dir,
    restore: () => {
      process.env.XDG_DATA_HOME = prev;
      grantTestSeam.clock.now = () => Date.now();
      grantTestSeam.warnedGrantKeys.clear();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function grantsPath(): string {
  return path.join(process.env.XDG_DATA_HOME!, "opencode", "claude-oauth", "grants.json");
}

function readGrantsFile(): Record<string, number> {
  return JSON.parse(readFileSync(grantsPath(), "utf8"));
}

function seedGrantsFile(grants: Record<string, number>, raw?: string): void {
  if (raw !== undefined) {
    mkdirSync(path.dirname(grantsPath()), { recursive: true });
    writeFileSync(grantsPath(), raw);
    return;
  }
  mkdirSync(path.dirname(grantsPath()), { recursive: true });
  writeFileSync(grantsPath(), JSON.stringify(grants));
}

interface Harness {
  warnings: Array<{ service: string; level: string; message: string }>;
  persisted: unknown[];
  options: Record<string, any>;
}

async function makeHarness(opts?: {
  auth?: Record<string, unknown>;
  /** Replace the app.log implementation. */
  logImpl?: (body: unknown) => Promise<unknown>;
}): Promise<Harness> {
  const authState = opts?.auth ?? {
    type: "oauth",
    access: "access-a",
    refresh: "refresh-a",
    expires: Date.now() + 3_600_000,
    accountId: "account-a",
  };
  const warnings: Harness["warnings"] = [];
  const persisted: unknown[] = [];
  const plugin = await ClaudeOAuthPlugin({
    client: {
      auth: {
        set: async ({ body }: { body: unknown }) => {
          persisted.push(body);
        },
      },
      app: {
        log: async ({ body }: { body: Harness["warnings"][number] }) => {
          if (opts?.logImpl) return opts.logImpl(body);
          warnings.push(body);
        },
      },
    },
  } as never);
  const options = await plugin.auth!.loader!(async () => structuredClone(authState) as never, {} as never);
  return { warnings, persisted, options };
}

describe("grant-age sidecar", () => {
  serialTest("login recording writes authorizedAt at the injected clock time with mode 0600", async () => {
    const env = useGrantsEnv();
    try {
      const { recordAuthorizedAt } = await import("./claude_oauth.ts");
      recordAuthorizedAt("refresh-a", "account-a");
      const grants = readGrantsFile();
      expect(grants["account-a"]).toBe(T0);
      expect(statSync(grantsPath()).mode & 0o777).toBe(0o600);
      // Data directories created by the sidecar are owner-only.
      expect(statSync(path.join(process.env.XDG_DATA_HOME!, "opencode")).mode & 0o777).toBe(0o700);
      expect(statSync(path.join(process.env.XDG_DATA_HOME!, "opencode", "claude-oauth")).mode & 0o777).toBe(0o700);
    } finally {
      env.restore();
    }
  });

  serialTest("credentials without an accountId key on a stable non-secret hash of the refresh token", async () => {
    const env = useGrantsEnv();
    try {
      const { recordAuthorizedAt } = await import("./claude_oauth.ts");
      recordAuthorizedAt("refresh-no-account");
      const grants = readGrantsFile();
      const keys = Object.keys(grants);
      expect(keys).toHaveLength(1);
      // Hex hash slice, not the raw token.
      expect(keys[0]).toMatch(/^[0-9a-f]{16}$/);
      expect(JSON.stringify(grants)).not.toContain("refresh-no-account");
      // Same token → same key (stable across calls).
      recordAuthorizedAt("refresh-no-account");
      expect(Object.keys(readGrantsFile())).toHaveLength(1);
    } finally {
      env.restore();
    }
  });

  serialTest("multiple accounts coexist in the same sidecar; re-login overwrites only its own account", async () => {
    const env = useGrantsEnv();
    try {
      const { recordAuthorizedAt } = await import("./claude_oauth.ts");
      recordAuthorizedAt("refresh-a", "account-a");
      grantTestSeam.clock.now = () => T0 + 5_000;
      recordAuthorizedAt("refresh-b", "account-b");
      let grants = readGrantsFile();
      expect(grants).toEqual({ "account-a": T0, "account-b": T0 + 5_000 });
      // Re-login account A: B's timestamp is untouched, A's is reset by the NEW grant.
      grantTestSeam.clock.now = () => T0 + 10_000;
      recordAuthorizedAt("refresh-a2", "account-a");
      grants = readGrantsFile();
      expect(grants).toEqual({ "account-a": T0 + 10_000, "account-b": T0 + 5_000 });
    } finally {
      env.restore();
    }
  });

  serialTest("refresh rotation never resets authorizedAt", async () => {
    const env = useGrantsEnv();
    seedGrantsFile({ "account-a": T0 - 10 * DAY_MS });
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("/v1/oauth/token")) {
          return new Response(
            JSON.stringify({ access_token: "new-access", refresh_token: "rotated-refresh", expires_in: 3600 }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ id: "msg" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;
      const h = await makeHarness({
        auth: {
          type: "oauth",
          access: "stale-access",
          refresh: "stale-refresh",
          expires: Date.now() - 1000,
          accountId: "account-a",
        },
      });
      await h.options.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [], max_tokens: 1 }),
      });
      expect(h.persisted[0]).toMatchObject({ access: "new-access", refresh: "rotated-refresh" });
      // Rotation persisted new tokens but the recorded authorization instant is untouched.
      expect(readGrantsFile()).toEqual({ "account-a": T0 - 10 * DAY_MS });
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
    }
  });

  serialTest("malformed sidecar never blocks the loader and yields no warning", async () => {
    const env = useGrantsEnv();
    try {
      seedGrantsFile({}, "{ this is not json ]]");
      const h = await makeHarness({
        auth: {
          type: "oauth",
          access: "a",
          refresh: "r",
          expires: Date.now() + 3_600_000,
          accountId: "account-old",
        },
      });
      expect(h.warnings).toHaveLength(0);
      expect(h.options.fetch).toBeTypeOf("function");
    } finally {
      env.restore();
    }
  });

  serialTest("day-27 grant produces no warning", async () => {
    const env = useGrantsEnv();
    try {
      seedGrantsFile({ "account-a": T0 - 27 * DAY_MS });
      const h = await makeHarness({
        auth: {
          type: "oauth",
          access: "a",
          refresh: "r",
          expires: Date.now() + 3_600_000,
          accountId: "account-a",
        },
      });
      expect(h.warnings).toHaveLength(0);
    } finally {
      env.restore();
    }
  });

  serialTest("day-28 grant warns exactly once per process/account across loaders", async () => {
    const env = useGrantsEnv();
    const auth = {
      type: "oauth",
      access: "a",
      refresh: "r",
      expires: Date.now() + 3_600_000,
      accountId: "account-a",
    };
    try {
      seedGrantsFile({ "account-a": T0 - 28 * DAY_MS });
      const first = await makeHarness({ auth });
      expect(first.warnings).toHaveLength(1);
      expect(first.warnings[0]).toMatchObject({ service: "claude-oauth", level: "warn" });
      expect(first.warnings[0]!.message).toMatch(/28 days old/);
      expect(first.warnings[0]!.message).toMatch(/~30 days is an observed heuristic/i);
      expect(first.warnings[0]!.message).toMatch(/opencode auth login/);
      // A second loader instance in the same process must not warn again.
      const second = await makeHarness({ auth });
      expect(second.warnings).toHaveLength(0);
    } finally {
      env.restore();
    }
  });

  serialTest("each account gets its own warning (no cross-account dedup)", async () => {
    const env = useGrantsEnv();
    try {
      seedGrantsFile({ "account-a": T0 - 30 * DAY_MS, "account-b": T0 - 29 * DAY_MS });
      await makeHarness({
        auth: { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 3_600_000, accountId: "account-a" },
      });
      const second = await makeHarness({
        auth: { type: "oauth", access: "b", refresh: "r2", expires: Date.now() + 3_600_000, accountId: "account-b" },
      });
      expect(second.warnings).toHaveLength(1);
      expect(second.warnings[0]!.message).toContain("account-b");
    } finally {
      env.restore();
    }
  });

  serialTest("app.log throwing never blocks the loader", async () => {
    const env = useGrantsEnv();
    try {
      seedGrantsFile({ "account-a": T0 - 40 * DAY_MS });
      const h = await makeHarness({
        auth: {
          type: "oauth",
          access: "a",
          refresh: "r",
          expires: Date.now() + 3_600_000,
          accountId: "account-a",
        },
        logImpl: async () => {
          throw new Error("log endpoint down");
        },
      });
      expect(h.options.fetch).toBeTypeOf("function");
    } finally {
      env.restore();
    }
  });

  serialTest("terminal invalid_grant mentions observed grant expiry but keeps auth intact", async () => {
    const env = useGrantsEnv();
    seedGrantsFile({ "account-a": T0 - 29 * DAY_MS });
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("/v1/oauth/token")) {
          return new Response(JSON.stringify({ error: "invalid_grant", error_description: "expired" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch;
      const h = await makeHarness({
        auth: {
          type: "oauth",
          access: "stale-access",
          refresh: "stale-refresh",
          expires: Date.now() - 1000,
          accountId: "account-a",
        },
      });
      const error = await h.options
        .fetch!("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [], max_tokens: 1 }),
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AnthropicReauthRequiredError);
      expect((error as Error).message).toMatch(/re-login required/i);
      expect((error as Error).message).toMatch(/Observed grant age: ~29 day\(s\)/);
      // Auth is NOT auto-deleted.
      expect(h.persisted).toHaveLength(0);
      expect(readGrantsFile()).toEqual({ "account-a": T0 - 29 * DAY_MS });
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
    }
  });
});

describe("grant key migration (refresh-hash → accountId)", () => {
  function hashKey(refreshToken: string): string {
    return createHash("sha256").update(refreshToken).digest("hex").slice(0, 16);
  }

  serialTest("a grant first keyed by refresh hash falls back to it and migrates once accountId is known", async () => {
    const env = useGrantsEnv();
    const legacy = T0 - 29 * DAY_MS;
    // Grant recorded before the accountId was known.
    seedGrantsFile({ [hashKey("stale-refresh")]: legacy });
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("/v1/oauth/token")) {
          return new Response(JSON.stringify({ error: "invalid_grant", error_description: "expired" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch;
      const h = await makeHarness({
        auth: {
          type: "oauth",
          access: "stale-access",
          refresh: "stale-refresh",
          expires: Date.now() - 1000,
          accountId: "account-a",
        },
      });
      const error = await h.options
        .fetch!("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [], max_tokens: 1 }),
        })
        .catch((e: unknown) => e);
      // Fallback lookup found the legacy entry, so the observed age survives.
      expect(error).toBeInstanceOf(AnthropicReauthRequiredError);
      expect((error as Error).message).toMatch(/Observed grant age: ~29 day\(s\)/);
      // The history moved onto the stable account key; the refresh-hash key is
      // gone, so a later rotation cannot lose the age.
      expect(readGrantsFile()).toEqual({ "account-a": legacy });
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
    }
  });

  serialTest("migration never overwrites an existing account-keyed entry", async () => {
    const env = useGrantsEnv();
    try {
      seedGrantsFile({ [hashKey("refresh-a")]: T0 - 40 * DAY_MS, "account-a": T0 - 5 * DAY_MS });
      const h = await makeHarness({
        auth: {
          type: "oauth",
          access: "a",
          refresh: "refresh-a",
          expires: Date.now() + 3_600_000,
          accountId: "account-a",
        },
      });
      // Fresh credential: no stale-grant warning from either entry.
      expect(h.warnings).toHaveLength(0);
      // Both entries are preserved untouched (no migration clobbered account-a).
      expect(readGrantsFile()).toEqual({ [hashKey("refresh-a")]: T0 - 40 * DAY_MS, "account-a": T0 - 5 * DAY_MS });
    } finally {
      env.restore();
    }
  });
});
