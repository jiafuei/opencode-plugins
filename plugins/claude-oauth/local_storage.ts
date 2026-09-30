import { createHash, randomBytes } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function getInstallId(): string {
  const dir = path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "opencode");
  const file = path.join(dir, "claude-oauth-install-id");
  if (!existsSync(file)) {
    // Publish a fully written candidate with an atomic hard link: concurrent
    // processes that lose the race adopt the winner's id.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const candidate = `${file}.${process.pid}`;
    writeFileSync(candidate, randomBytes(16).toString("hex"), { mode: 0o600 });
    try {
      linkSync(candidate, file);
    } catch {}
    unlinkSync(candidate);
  }
  return readFileSync(file, "utf8").trim();
}

/** Derive a stable device ID from the plugin's install ID and the OAuth account. */
export function deriveDeviceId(accountId?: string): string {
  const hash = createHash("sha256");
  if (accountId) {
    return hash.update("claude-oauth-device-id-v2\0").update(getInstallId()).update("\0").update(accountId).digest("hex");
  }
  return hash.update("claude-oauth-device-id-v1:").update(getInstallId()).digest("hex");
}
