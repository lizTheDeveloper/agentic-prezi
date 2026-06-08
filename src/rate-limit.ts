import type { DatabaseSync } from 'node:sqlite';

// SQLite-backed fixed-window counter. Used to throttle magic-link requests per email and per IP
// so the auth endpoint can't be used to spam mail or enumerate accounts (spec §4, §8).

// Returns true if the action is allowed (and records it); false if the bucket is over the limit
// for the current window.
export function checkRateLimit(
  db: DatabaseSync,
  bucket: string,
  max: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  const row = db
    .prepare('SELECT count, window_start FROM rate_limits WHERE bucket = ?')
    .get(bucket) as { count: number; window_start: number } | undefined;

  if (!row || now - row.window_start >= windowMs) {
    db.prepare(
      `INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET count = 1, window_start = excluded.window_start`,
    ).run(bucket, now);
    return true;
  }

  if (row.count >= max) return false;

  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE bucket = ?').run(bucket);
  return true;
}
