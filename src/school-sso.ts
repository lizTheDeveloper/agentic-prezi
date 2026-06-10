// School-SSO: authenticate users via the platform's shared `.themultiverse.school` session.
//
// The School (Flask) app writes a session blob to the shared Redis under `school:session:{sid}`
// and sets a `session={sid}` cookie on domain `.themultiverse.school`, visible to every
// subdomain (this contract was read from the working `bazaar` app). We read that cookie, look the
// blob up in Redis, honor its `expires` (unix seconds), take `data.email`, and upsert a local
// user. The School cookie is the source of truth — Aethrix issues no session cookie of its own,
// so a School logout propagates here within the short resolution cache TTL.

import type { IncomingMessage } from 'node:http';
import type { Ctx } from './context.ts';
import { parseCookies } from './http.ts';
import { redisGet as realRedisGet } from './redis-min.ts';
import type { RedisTarget } from './redis-min.ts';

export interface SchoolUser { userId: number; email: string }

// Session ids are opaque; allow a generous but bounded, control-char-free charset. (RESP framing
// already makes the Redis command injection-safe; this is defense-in-depth + a cheap reject.)
const SID_RE = /^[A-Za-z0-9._-]{1,256}$/;

/** Pure: parse `redis://[user]:[password]@host:port` into a RedisTarget. Throws on a bad URL. */
export function parseRedisUrl(url: string): RedisTarget {
  const u = new URL(url);
  if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') throw new Error(`unsupported redis url: ${u.protocol}`);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
  };
}

/**
 * Pure: validate a School session blob and extract the email. Returns null if the blob is
 * malformed, expired, or has no usable email — fail closed.
 */
export function parseSchoolBlob(raw: string, nowSec: number): { email: string } | null {
  let blob: unknown;
  try { blob = JSON.parse(raw); } catch { return null; }
  if (blob == null || typeof blob !== 'object') return null;
  const b = blob as { expires?: unknown; data?: { email?: unknown } };
  const exp = typeof b.expires === 'string' ? Number(b.expires) : b.expires;
  if (typeof exp === 'number' && Number.isFinite(exp) && exp > 0 && exp < nowSec) return null; // expired
  const email = b.data?.email;
  if (typeof email !== 'string' || !email.includes('@')) return null;
  return { email: email.toLowerCase() };
}

export interface SchoolSsoOptions {
  target: RedisTarget;
  cookieName?: string;       // default 'session'
  keyPrefix?: string;        // default 'school:session:'
  cacheTtlMs?: number;       // positive-result cache window (logout propagation bound)
  redisGet?: (target: RedisTarget, key: string) => Promise<string | null>; // injectable for tests
}

export interface SchoolSso {
  resolve(req: IncomingMessage, ctx: Ctx, now?: number): Promise<SchoolUser | null>;
}

/** Build the SSO resolver. A short per-sid cache avoids a Redis round-trip on every API call. */
export function createSchoolSso(opts: SchoolSsoOptions): SchoolSso {
  const cookieName = opts.cookieName ?? 'session';
  const keyPrefix = opts.keyPrefix ?? 'school:session:';
  const cacheTtlMs = opts.cacheTtlMs ?? 30_000;
  const redisGet = opts.redisGet ?? realRedisGet;
  const cache = new Map<string, { user: SchoolUser; expiresAtMs: number }>();

  return {
    async resolve(req, ctx, now = Date.now()) {
      const sid = parseCookies(req)[cookieName];
      if (!sid || !SID_RE.test(sid)) return null;

      const hit = cache.get(sid);
      if (hit && hit.expiresAtMs > now) return hit.user;

      let raw: string | null;
      try {
        raw = await redisGet(opts.target, keyPrefix + sid);
      } catch {
        return null; // Redis unreachable → fail closed (no fallback auth path by design)
      }
      if (raw == null) return null;

      const parsed = parseSchoolBlob(raw, Math.floor(now / 1000));
      if (!parsed) return null;

      // Upsert the local user by email; the School session is the identity authority.
      ctx.db.prepare('INSERT INTO users (email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING')
        .run(parsed.email, now);
      const row = ctx.db.prepare('SELECT id FROM users WHERE email = ?').get(parsed.email) as { id: number } | undefined;
      if (!row) return null;

      const user: SchoolUser = { userId: row.id, email: parsed.email };
      cache.set(sid, { user, expiresAtMs: now + cacheTtlMs });
      return user;
    },
  };
}
