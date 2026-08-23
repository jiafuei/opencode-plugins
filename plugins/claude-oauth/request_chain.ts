import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Durable request-chain state behind Claude Code's cc_prev_req billing field.
// One owner for the whole lifecycle: the SQLite store (fresh schema is always
// version 1 — no migrations), the process-local fallback used when the
// database cannot be opened or fails mid-flight, credential-key hashing, and
// every generation/retry-sequencing, reset, delete, and close operation.

/**
 * Chain state for one (credential, session) pair. `requestId` is the last
 * successfully completed request id; `generation` fences resets/deletions;
 * `sequence` orders logical requests within a generation.
 */
export interface RequestChainState {
  requestId?: string;
  generation: number;
  sequence: number;
  completedSequence: number;
}

/**
 * Hashed key binding a chain to a credential identity. Never persists raw
 * refresh tokens or raw account ids — only this SHA-256 digest reaches disk.
 */
export function requestChainCredentialKey(refreshToken: string, accountId?: string): string {
  return createHash("sha256")
    .update(accountId ? `account\0${accountId}` : `refresh\0${refreshToken}`)
    .digest("hex");
}

interface SessionRow {
  previous_request_id: string | null;
  generation: number;
  request_sequence: number;
  completed_sequence: number;
}

// A row is established when a request starts. Completion only updates the
// generation it observed, so compaction/auth invalidation fences late writers
// across both plugin instances and processes.
class ClaudeOAuthDatabase {
  private readonly db: Database;

  constructor(file: string) {
    if (file !== ":memory:") {
      const dir = path.dirname(file);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
      writeFileSync(file, "", { flag: "a", mode: 0o600 });
      chmodSync(file, 0o600);
    }
    this.db = new Database(file, { create: true });
    try {
      this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
      this.db.exec("BEGIN EXCLUSIVE");
      const version = (this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
      if (version !== 0 && version !== 1) throw new Error(`Unsupported claude-oauth.db schema version ${version}`);
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS sessions (session_id TEXT NOT NULL, credential_key TEXT NOT NULL, previous_request_id TEXT, generation INTEGER NOT NULL DEFAULT 0, request_sequence INTEGER NOT NULL DEFAULT 0, completed_sequence INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER, PRIMARY KEY (session_id, credential_key)) WITHOUT ROWID; CREATE INDEX IF NOT EXISTS sessions_by_credential ON sessions (credential_key); CREATE TABLE IF NOT EXISTS requests (session_id TEXT NOT NULL, credential_key TEXT NOT NULL, logical_request_id TEXT NOT NULL, generation INTEGER NOT NULL, sequence INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (session_id, credential_key, logical_request_id), FOREIGN KEY (session_id, credential_key) REFERENCES sessions (session_id, credential_key) ON DELETE CASCADE) WITHOUT ROWID; CREATE INDEX IF NOT EXISTS requests_by_credential ON requests (credential_key); CREATE INDEX IF NOT EXISTS requests_by_created_at ON requests (created_at); PRAGMA user_version = 1; COMMIT;",
      );
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      this.db.close();
      throw error;
    }
  }

  startRequest(sessionId: string, credentialKey: string, logicalRequestId: string): RequestChainState {
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.query("DELETE FROM requests WHERE created_at < ?").run(now - 24 * 60 * 60 * 1000);
      this.db
        .query(
          "INSERT INTO sessions (session_id, credential_key, previous_request_id, generation, request_sequence, completed_sequence, created_at, updated_at, deleted_at) VALUES (?, ?, NULL, 0, 0, 0, ?, ?, NULL) ON CONFLICT (session_id, credential_key) DO UPDATE SET updated_at = excluded.updated_at, deleted_at = NULL",
        )
        .run(sessionId, credentialKey, now, now);
      const row = this.db
        .query(
          "SELECT previous_request_id, generation, request_sequence, completed_sequence FROM sessions WHERE session_id = ? AND credential_key = ?",
        )
        .get(sessionId, credentialKey) as SessionRow;
      const existing = this.db
        .query(
          "SELECT generation, sequence FROM requests WHERE session_id = ? AND credential_key = ? AND logical_request_id = ?",
        )
        .get(sessionId, credentialKey, logicalRequestId) as { generation: number; sequence: number } | null;
      let sequence = existing?.generation === row.generation ? existing.sequence : row.request_sequence + 1;
      if (!existing || existing.generation !== row.generation) {
        this.db
          .query(
            "UPDATE sessions SET request_sequence = ?, updated_at = ? WHERE session_id = ? AND credential_key = ?",
          )
          .run(sequence, now, sessionId, credentialKey);
        this.db
          .query(
            "INSERT INTO requests (session_id, credential_key, logical_request_id, generation, sequence, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (session_id, credential_key, logical_request_id) DO UPDATE SET generation = excluded.generation, sequence = excluded.sequence, created_at = excluded.created_at",
          )
          .run(sessionId, credentialKey, logicalRequestId, row.generation, sequence, now);
      }
      this.db.exec("COMMIT");
      return {
        requestId: row.previous_request_id ?? undefined,
        generation: row.generation,
        sequence,
        completedSequence: row.completed_sequence,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  complete(
    sessionId: string,
    credentialKey: string,
    logicalRequestId: string,
    generation: number,
    sequence: number,
    requestId: string,
  ): boolean {
    let completed = false;
    this.transaction(() => {
      completed =
        this.db
          .query(
            "UPDATE sessions SET previous_request_id = ?, completed_sequence = ?, updated_at = ? WHERE session_id = ? AND credential_key = ? AND generation = ? AND completed_sequence < ?",
          )
          .run(requestId, sequence, Date.now(), sessionId, credentialKey, generation, sequence).changes === 1;
      this.db
        .query(
          "DELETE FROM requests WHERE session_id = ? AND credential_key = ? AND logical_request_id = ? AND generation = ?",
        )
        .run(sessionId, credentialKey, logicalRequestId, generation);
    });
    return completed;
  }

  resetSession(sessionId: string): void {
    this.transaction(() => {
      this.db
        .query(
          "UPDATE sessions SET previous_request_id = NULL, generation = generation + 1, request_sequence = 0, completed_sequence = 0, updated_at = ?, deleted_at = NULL WHERE session_id = ?",
        )
        .run(Date.now(), sessionId);
      this.db.query("DELETE FROM requests WHERE session_id = ?").run(sessionId);
    });
  }

  deleteSession(sessionId: string): void {
    this.transaction(() => {
      const now = Date.now();
      this.db
        .query(
          "UPDATE sessions SET previous_request_id = NULL, generation = generation + 1, request_sequence = 0, completed_sequence = 0, updated_at = ?, deleted_at = ? WHERE session_id = ?",
        )
        .run(now, now, sessionId);
      this.db.query("DELETE FROM requests WHERE session_id = ?").run(sessionId);
    });
  }

  resetCredential(credentialKey: string): void {
    this.transaction(() => {
      this.db
        .query(
          "UPDATE sessions SET previous_request_id = NULL, generation = generation + 1, request_sequence = 0, completed_sequence = 0, updated_at = ? WHERE credential_key = ?",
        )
        .run(Date.now(), credentialKey);
      this.db.query("DELETE FROM requests WHERE credential_key = ?").run(credentialKey);
    });
  }

  resetAll(): void {
    this.transaction(() => {
      this.db
        .query(
          "UPDATE sessions SET previous_request_id = NULL, generation = generation + 1, request_sequence = 0, completed_sequence = 0, updated_at = ?",
        )
        .run(Date.now());
      this.db.query("DELETE FROM requests").run();
    });
  }

  close(): void {
    this.db.close();
  }

  private transaction(work: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      work();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

/**
 * Request-chain lifecycle owner. The database opens lazily on first use and
 * degrades permanently to the process-local fallback when it cannot be opened
 * or fails mid-operation; tokens and raw account ids are never persisted in
 * either path.
 */
export class RequestChainTracker {
  private readonly file: string;
  private database: ClaudeOAuthDatabase | undefined;
  private databaseUnavailable = false;
  // Process-local mirror of each (credential, session) chain, keyed by
  // `<credentialKey>\0<sessionId>`; also consulted while the database is
  // unavailable so chaining survives a failed open or a mid-flight failure.
  private readonly previousRequestIds = new Map<string, RequestChainState>();
  // In-flight logical requests, keyed by
  // `<credentialKey>\0<sessionId>\0<logicalRequestId>`; lets SDK retries reuse
  // their sequence while a new logical invocation gets a fresh one.
  private readonly logicalRequestSequences = new Map<
    string,
    { credentialKey: string; sessionId: string; generation: number; sequence: number }
  >();

  constructor(file: string) {
    this.file = file;
  }

  /**
   * Establish chain state for a logical request: reuse the in-flight sequence
   * on SDK retry of the same logical id, otherwise take the next sequence and
   * return the previous completed request id for cc_prev_req.
   */
  startRequest(credentialKey: string, sessionId: string, logicalRequestId: string): RequestChainState {
    const memoryKey = `${credentialKey}\0${sessionId}`;
    const logicalKey = `${memoryKey}\0${logicalRequestId}`;
    const stored = this.tryStore((database) => database.startRequest(sessionId, credentialKey, logicalRequestId));
    let state: RequestChainState;
    let sequence: number;
    if (stored) {
      state = stored;
      sequence = stored.sequence;
    } else {
      const current = this.previousRequestIds.get(memoryKey) ?? {
        generation: 0,
        sequence: 0,
        completedSequence: 0,
      };
      const existing = this.logicalRequestSequences.get(logicalKey);
      sequence = existing?.generation === current.generation ? existing.sequence : current.sequence + 1;
      state = { ...current, sequence: Math.max(current.sequence, sequence) };
    }
    this.previousRequestIds.set(memoryKey, state);
    this.logicalRequestSequences.set(logicalKey, {
      credentialKey,
      sessionId,
      generation: state.generation,
      sequence,
    });
    return { ...state, sequence };
  }

  /**
   * Record a successful completion. Fenced by generation and sequence: a late
   * response from before a reset/delete, or an out-of-order retry, never wins.
   */
  completeRequest(
    credentialKey: string,
    sessionId: string,
    logicalRequestId: string,
    generation: number,
    sequence: number,
    requestId: string,
  ): void {
    const memoryKey = `${credentialKey}\0${sessionId}`;
    const logicalKey = `${memoryKey}\0${logicalRequestId}`;
    const recorded = this.tryStore((database) =>
      database.complete(sessionId, credentialKey, logicalRequestId, generation, sequence, requestId),
    );
    if (recorded !== undefined) {
      if (recorded) {
        const current = this.previousRequestIds.get(memoryKey);
        this.previousRequestIds.set(memoryKey, {
          requestId,
          generation,
          sequence: Math.max(current?.sequence ?? sequence, sequence),
          completedSequence: sequence,
        });
      } else {
        this.previousRequestIds.delete(memoryKey);
      }
      this.logicalRequestSequences.delete(logicalKey);
      return;
    }
    const current = this.previousRequestIds.get(memoryKey);
    if (current?.generation === generation && current.completedSequence < sequence) {
      this.previousRequestIds.set(memoryKey, { ...current, requestId, completedSequence: sequence });
    }
    this.logicalRequestSequences.delete(logicalKey);
  }

  /** Compaction: bump generations so in-flight responses cannot restore state. */
  resetSession(sessionId: string): void {
    this.resetMemoryEntries((_credentialKey, id) => id === sessionId);
    this.tryStore((database) => database.resetSession(sessionId));
  }

  /** Deletion: like resetSession, but tombstoned so reactivation starts fresh. */
  deleteSession(sessionId: string): void {
    this.resetMemoryEntries((_credentialKey, id) => id === sessionId);
    this.tryStore((database) => database.deleteSession(sessionId));
  }

  /** Auth transition away from a credential: invalidate all of its chains. */
  resetCredential(credentialKey: string): void {
    this.resetMemoryEntries((key) => key === credentialKey);
    this.tryStore((database) => database.resetCredential(credentialKey));
  }

  /** A fresh login invalidates every chain for every session and credential. */
  resetAll(): void {
    this.resetMemoryEntries(() => true);
    this.tryStore((database) => database.resetAll());
  }

  close(): void {
    this.previousRequestIds.clear();
    this.logicalRequestSequences.clear();
    this.database?.close();
    this.database = undefined;
  }

  /**
   * Bump generations and clear sequences for the matching process-local
   * entries, then drop their in-flight logical requests.
   */
  private resetMemoryEntries(matches: (credentialKey: string, sessionId: string) => boolean): void {
    for (const [key, state] of this.previousRequestIds) {
      const separator = key.indexOf("\0");
      if (!matches(key.slice(0, separator), key.slice(separator + 1))) continue;
      this.previousRequestIds.set(key, {
        generation: state.generation + 1,
        sequence: 0,
        completedSequence: 0,
      });
    }
    for (const [key, request] of this.logicalRequestSequences) {
      if (matches(request.credentialKey, request.sessionId)) this.logicalRequestSequences.delete(key);
    }
  }

  /**
   * Run a database operation with the fallback policy: an unavailable database
   * (or one that fails here) disables SQLite for the lifetime of this tracker
   * and returns undefined so callers degrade to the process-local maps.
   */
  private tryStore<T>(work: (database: ClaudeOAuthDatabase) => T): T | undefined {
    if (!this.databaseUnavailable && !this.database) {
      try {
        this.database = new ClaudeOAuthDatabase(this.file);
      } catch {
        this.databaseUnavailable = true;
        return undefined;
      }
    }
    const database = this.database;
    if (!database) return undefined;
    try {
      return work(database);
    } catch {
      try {
        database.close();
      } catch {}
      this.database = undefined;
      this.databaseUnavailable = true;
      return undefined;
    }
  }
}
