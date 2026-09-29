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

/**
 * Derive a stable device ID from the plugin's install ID. The hash domains are
 * profile-specific (Cowork/OMP vs SDK CLI), and all reuse this plugin's stable
 * install ID.
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

export function deriveCoworkSessionId(rawSessionId: string): string {
  const bytes = new Uint8Array(
    new Bun.CryptoHasher("sha256")
      .update("claude-oauth-cowork-session-id-v1\0")
      .update(getInstallId())
      .update("\0")
      .update(rawSessionId)
      .digest(),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toHex();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
