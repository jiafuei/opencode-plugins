import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LEASE_STALE_MS, type WorkflowLease } from "./workflow_shared.ts";

export type LeaseToken = WorkflowLease & { generation: number; token: string };
export type MaintenanceToken = { runID: string; ownerIdentity: string; token: string; claimedAt: number };

export class WorkflowCoordination {
  readonly db: Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS lease (project INTEGER PRIMARY KEY CHECK (project = 1), run_id TEXT NOT NULL, token TEXT NOT NULL, generation INTEGER NOT NULL, owner TEXT NOT NULL, heartbeat INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS queue (run_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, replacement INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS maintenance (run_id TEXT PRIMARY KEY, owner TEXT NOT NULL, token TEXT NOT NULL, claimed_at INTEGER NOT NULL);");
    const columns = this.db.query("PRAGMA table_info(maintenance)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "token")) this.db.exec("ALTER TABLE maintenance ADD COLUMN token TEXT NOT NULL DEFAULT ''");
  }

  acquire(runID: string, owner: string, now = Date.now()): LeaseToken | undefined {
    return this.transaction(() => {
      const current = this.current();
      this.db.query("DELETE FROM maintenance WHERE run_id=? AND claimed_at < ?").run(runID, now - LEASE_STALE_MS);
      if (this.db.query("SELECT 1 FROM maintenance WHERE run_id=?").get(runID)) return undefined;
      if (current && (current.runID !== runID || current.ownerIdentity !== owner) && now - current.heartbeatAt <= LEASE_STALE_MS) return undefined;
      if (current?.runID === runID && current.ownerIdentity === owner) return current;
      const generation = (current?.generation ?? 0) + 1;
      const token = crypto.randomUUID();
      this.db.query("INSERT INTO lease(project, run_id, token, generation, owner, heartbeat) VALUES(1, ?, ?, ?, ?, ?) ON CONFLICT(project) DO UPDATE SET run_id=excluded.run_id, token=excluded.token, generation=excluded.generation, owner=excluded.owner, heartbeat=excluded.heartbeat").run(runID, token, generation, owner, now);
      return { runID, token, generation, ownerIdentity: owner, heartbeatAt: now };
    });
  }

  heartbeat(lease: LeaseToken, now = Date.now()): boolean {
    return this.db.query("UPDATE lease SET heartbeat=? WHERE project=1 AND run_id=? AND token=? AND generation=?").run(now, lease.runID, lease.token, lease.generation).changes === 1;
  }

  owns(lease: LeaseToken): boolean {
    const current = this.current();
    return current?.runID === lease.runID && current.token === lease.token && current.generation === lease.generation;
  }

  release(lease: LeaseToken): boolean {
    return this.db.query("DELETE FROM lease WHERE project=1 AND run_id=? AND token=? AND generation=?").run(lease.runID, lease.token, lease.generation).changes === 1;
  }

  current(): LeaseToken | undefined {
    const row = this.db.query("SELECT run_id, token, generation, owner, heartbeat FROM lease WHERE project=1").get() as { run_id: string; token: string; generation: number; owner: string; heartbeat: number } | null;
    return row ? { runID: row.run_id, token: row.token, generation: row.generation, ownerIdentity: row.owner, heartbeatAt: row.heartbeat } : undefined;
  }

  enqueue(runID: string, createdAt: number, replacement = false): void {
    this.db.query("INSERT INTO queue(run_id, created_at, replacement) VALUES(?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET replacement=MAX(replacement, excluded.replacement)").run(runID, createdAt, Number(replacement));
  }

  dequeue(runID: string): void { this.db.query("DELETE FROM queue WHERE run_id=?").run(runID); }

  nextQueued(): string | undefined {
    return (this.db.query("SELECT run_id FROM queue ORDER BY replacement DESC, created_at ASC, run_id ASC LIMIT 1").get() as { run_id: string } | null)?.run_id;
  }

  claimMaintenance(runID: string, owner: string, now = Date.now()): MaintenanceToken | undefined {
    return this.transaction(() => {
      this.db.query("DELETE FROM maintenance WHERE claimed_at < ?").run(now - LEASE_STALE_MS);
      const lease = this.current();
      if (lease?.runID === runID && now - lease.heartbeatAt <= LEASE_STALE_MS) return undefined;
      const token = crypto.randomUUID();
      if (this.db.query("INSERT OR IGNORE INTO maintenance(run_id, owner, token, claimed_at) VALUES(?, ?, ?, ?)").run(runID, owner, token, now).changes !== 1) return undefined;
      return { runID, ownerIdentity: owner, token, claimedAt: now };
    });
  }

  renewMaintenance(claim: MaintenanceToken, now = Date.now()): boolean { return this.db.query("UPDATE maintenance SET claimed_at=? WHERE run_id=? AND owner=? AND token=?").run(now, claim.runID, claim.ownerIdentity, claim.token).changes === 1; }

  releaseMaintenance(claim: MaintenanceToken): boolean { return this.db.query("DELETE FROM maintenance WHERE run_id=? AND owner=? AND token=?").run(claim.runID, claim.ownerIdentity, claim.token).changes === 1; }

  fenced<T>(lease: LeaseToken, work: () => T): T {
    return this.transaction(() => {
      if (!this.owns(lease)) throw new Error("Workflow lease ownership lost");
      return work();
    });
  }

  close(): void { this.db.close(); }

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
