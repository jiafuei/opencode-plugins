import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Local identity + sidecar durability: exclusive install-ID creation with
// cross-process convergence, and lock-protected grants.json merges across
// processes. Subprocesses exercise real concurrent filesystem races that
// cannot be reproduced in-process.
// ---------------------------------------------------------------------------

const MODULE_PATH = new URL("./claude_oauth.ts", import.meta.url).pathname;

function isolatedDataDir(prefix: string): { dir: string; restore: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  return { dir, restore: () => rmSync(dir, { recursive: true, force: true }) };
}

function spawnRacers(script: string, dir: string, count: number): Bun.Subprocess[] {
  return Array.from({ length: count }, (_, i) =>
    Bun.spawn({
      cmd: [process.execPath, "-e", script],
      env: { ...process.env, XDG_DATA_HOME: dir, RACER_INDEX: String(i), MODULE_PATH },
      stdout: "pipe",
      stderr: "pipe",
    }),
  );
}

async function settle(procs: Bun.Subprocess[]): Promise<string[]> {
  const outs = await Promise.all(
    procs.map((p) =>
      p.exited.then(async () => {
        const text = p.stdout ? await new Response(p.stdout as ReadableStream).text() : "";
        return text.trim();
      }),
    ),
  );
  for (const p of procs) {
    if (p.exitCode !== 0) {
      const err = p.stderr ? await new Response(p.stderr as ReadableStream).text() : "(no stderr)";
      throw new Error(`racer failed (${p.exitCode}): ${err}`);
    }
  }
  return outs;
}

describe("install id (stable local identity)", () => {
  const SCRIPT = `
    const mod = await import(process.env.MODULE_PATH);
    const { json } = mod.rewriteBody(
      JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      {},
    );
    const userId = JSON.parse(JSON.parse(json).metadata.user_id);
    console.log(userId.device_id);
  `;

  test("concurrent processes converge on exactly one winner install id", async () => {
    const { dir, restore } = isolatedDataDir("claude-oauth-installid-");
    try {
      // Four simultaneous racers: whoever loses the exclusive create must
      // adopt the winner's identity, never generate its own.
      const procs = spawnRacers(SCRIPT, dir, 4);
      const deviceIds = await settle(procs);
      expect(new Set(deviceIds).size).toBe(1);
      expect(deviceIds[0]).toMatch(/^[0-9a-f]{64}$/);

      // The winning identity is stored owner-only and stays unchanged.
      const idFile = path.join(dir, "opencode", "claude-oauth-install-id");
      const storedId = readFileSync(idFile, "utf8").trim();
      expect(storedId).toMatch(/^[0-9a-f]{32}$/);
      expect(statSync(idFile).mode & 0o777).toBe(0o600);

      // A later process derives the same device id from the stored identity.
      const again = await settle(spawnRacers(SCRIPT, dir, 1));
      expect(again[0]).toBe(deviceIds[0]);
    } finally {
      restore();
    }
  });

  test("a valid pre-existing identity is adopted verbatim with 0600 enforced", async () => {
    const { dir, restore } = isolatedDataDir("claude-oauth-installid-pre-");
    try {
      const dataDir = path.join(dir, "opencode");
      const idFile = path.join(dataDir, "claude-oauth-install-id");
      // Looser-than-ideal mode on a legacy file: contents win, perms tighten.
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(idFile, "b".repeat(32), { mode: 0o644 });

      const [deviceId] = await settle(spawnRacers(SCRIPT, dir, 1));
      expect(deviceId).toMatch(/^[0-9a-f]{64}$/);
      // Identity unchanged: derived deterministically from the stored value.
      const { createHash } = await import("node:crypto");
      const expected = createHash("sha256")
        .update("claude-oauth-device-id-v1:")
        .update("b".repeat(32))
        .digest("hex");
      expect(deviceId).toBe(expected);
      expect(readFileSync(idFile, "utf8").trim()).toBe("b".repeat(32));
      expect(statSync(idFile).mode & 0o777).toBe(0o600);
    } finally {
      restore();
    }
  });
});

describe("grants sidecar cross-process merge", () => {
  const SCRIPT = `
    const mod = await import(process.env.MODULE_PATH);
    mod.recordAuthorizedAt("refresh-" + process.env.RACER_INDEX, "account-" + process.env.RACER_INDEX);
    console.log("ok");
  `;

  test("parallel login recordings in separate processes all land (no lost updates)", async () => {
    const { dir, restore } = isolatedDataDir("claude-oauth-grantsmerge-");
    try {
      const procs = spawnRacers(SCRIPT, dir, 4);
      await settle(procs);
      const grants = JSON.parse(
        readFileSync(path.join(dir, "opencode", "claude-oauth", "grants.json"), "utf8"),
      ) as Record<string, number>;
      // Every racer's update survived the concurrent read-modify-write cycles.
      expect(Object.keys(grants).sort()).toEqual(["account-0", "account-1", "account-2", "account-3"]);
      const grantsDir = statSync(path.join(dir, "opencode", "claude-oauth"));
      expect(grantsDir.mode & 0o777).toBe(0o700);
      expect(statSync(path.join(dir, "opencode", "claude-oauth", "grants.json")).mode & 0o777).toBe(0o600);
      // No temp files left behind by the atomic renames.
      const listing = readdirSync(path.join(dir, "opencode", "claude-oauth"));
      expect(listing.filter((f: string) => f.endsWith(".tmp") || f === "grants.lock")).toEqual([]);
    } finally {
      restore();
    }
  });
});
