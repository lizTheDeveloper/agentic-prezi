import type { DatabaseSync } from 'node:sqlite';

// SQLite-backed job queue (spec §3 `jobs`, §5 publish loop). The schema/contract is SHARED with
// #2/#3 — keep it stable. Single in-process worker, so claim is a simple read-then-update inside
// the connection; `run_after` carries retry backoff.

export interface Job {
  id: number;
  presentation_id: number;
  type: string;
  status: string;
  attempts: number;
  run_after: number;
  payload: unknown;
  result: unknown;
  error: string | null;
}

interface JobRow {
  id: number;
  presentation_id: number;
  type: string;
  status: string;
  attempts: number;
  run_after: number;
  payload: string | null;
  result: string | null;
  error: string | null;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export class JobQueue {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  enqueue(presentationId: number, type: string, payload: unknown = null, now: number = Date.now()): number {
    const info = this.db
      .prepare(
        `INSERT INTO jobs (presentation_id, type, status, attempts, run_after, payload, created_at, updated_at)
         VALUES (?, ?, 'queued', 0, 0, ?, ?, ?)`,
      )
      .run(presentationId, type, payload == null ? null : JSON.stringify(payload), now, now);
    return Number(info.lastInsertRowid);
  }

  // Atomically claim the oldest runnable job: mark it 'running' and bump attempts.
  claim(now: number = Date.now()): Job | null {
    const row = this.db
      .prepare(
        `SELECT * FROM jobs
         WHERE status = 'queued' AND run_after <= ?
         ORDER BY id ASC LIMIT 1`,
      )
      .get(now) as JobRow | undefined;
    if (!row) return null;
    this.db
      .prepare(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`)
      .run(now, row.id);
    return hydrate({ ...row, status: 'running', attempts: row.attempts + 1 });
  }

  complete(jobId: number, result: unknown, now: number = Date.now()): void {
    this.db
      .prepare(`UPDATE jobs SET status = 'done', result = ?, error = NULL, updated_at = ? WHERE id = ?`)
      .run(result == null ? null : JSON.stringify(result), now, jobId);
  }

  // Record a failure. Requeue with backoff while attempts remain; otherwise mark 'failed'.
  // Returns true if the job was requeued for another attempt.
  fail(jobId: number, error: string, policy: RetryPolicy, now: number = Date.now()): boolean {
    const row = this.db.prepare('SELECT attempts FROM jobs WHERE id = ?').get(jobId) as
      | { attempts: number }
      | undefined;
    const attempts = row?.attempts ?? policy.maxAttempts;
    if (attempts < policy.maxAttempts) {
      const runAfter = now + policy.backoffMs * attempts;
      this.db
        .prepare(`UPDATE jobs SET status = 'queued', run_after = ?, error = ?, updated_at = ? WHERE id = ?`)
        .run(runAfter, error, now, jobId);
      return true;
    }
    this.db
      .prepare(`UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`)
      .run(error, now, jobId);
    return false;
  }

  get(jobId: number): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined;
    return row ? hydrate(row) : null;
  }
}

function hydrate(row: JobRow): Job {
  return {
    id: row.id,
    presentation_id: row.presentation_id,
    type: row.type,
    status: row.status,
    attempts: row.attempts,
    run_after: row.run_after,
    payload: row.payload ? JSON.parse(row.payload) : null,
    result: row.result ? JSON.parse(row.result) : null,
    error: row.error,
  };
}
