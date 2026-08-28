import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

      const again = await settle(spawnRacers(SCRIPT, dir, 1));
      expect(again[0]).toBe(deviceIds[0]);
    } finally {
      restore();
    }
  });

  test("a valid pre-existing identity is adopted", async () => {
    const { dir, restore } = isolatedDataDir("claude-oauth-installid-pre-");
    try {
      const dataDir = path.join(dir, "opencode");
      const idFile = path.join(dataDir, "claude-oauth-install-id");
      // Looser-than-ideal mode on a legacy file: contents win, perms tighten.
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(idFile, "b".repeat(32), { mode: 0o644 });

      const [deviceId] = await settle(spawnRacers(SCRIPT, dir, 1));
      const { createHash } = await import("node:crypto");
      const expected = createHash("sha256")
        .update("claude-oauth-device-id-v1:")
        .update("b".repeat(32))
        .digest("hex");
      expect(deviceId).toBe(expected);
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
      expect(Object.keys(grants).sort()).toEqual(["account-0", "account-1", "account-2", "account-3"]);
    } finally {
      restore();
    }
  });
});
