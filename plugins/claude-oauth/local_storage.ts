import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function opencodeDataDir(): string {
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "opencode");
}

function getInstallId(): string {
  const dir = opencodeDataDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "claude-oauth-install-id");
  let existing = "";
  try {
    existing = readFileSync(file, "utf8").trim();
  } catch {}
  if (existing) {
    if ((statSync(file).mode & 0o777) !== 0o600) chmodSync(file, 0o600);
    return existing;
  }
  const id = randomBytes(16).toString("hex");
  try {
    writeFileSync(file, id, { mode: 0o600, flag: "wx" });
    return id;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    for (let attempt = 0; attempt < 50; attempt++) {
      Bun.sleepSync(5);
      const winner = readFileSync(file, "utf8").trim();
      if (winner) {
        chmodSync(file, 0o600);
        return winner;
      }
    }
    throw new Error("claude-oauth install id file was created but never populated");
  }
}

/**
 * Derive a stable device ID from the plugin's install ID. The hash domains are
 * profile-specific (Claude CLI/SDK CLI vs Cowork/OMP), and all reuse this
 * plugin's stable install ID.
 */
export function deriveDeviceId(
  accountId?: string,
  installDomain = "claude-oauth-device-id-v1:",
  accountDomain = "claude-oauth-device-id-v2",
): string {
  const hash = createHash("sha256");
  if (accountId) {
    return hash.update(`${accountDomain}\0`).update(getInstallId()).update("\0").update(accountId).digest("hex");
  }
  return hash.update(installDomain).update(getInstallId()).digest("hex");
}
