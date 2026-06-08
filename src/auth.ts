import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Ctx } from './context.ts';
import { HttpError, readJson, sendJson, parseCookies, serializeCookie, clientIp } from './http.ts';
import { randomToken, sha256 } from './crypto.ts';
import { normalizeEmail } from './validate.ts';
import { checkRateLimit } from './rate-limit.ts';

export const SESSION_COOKIE = 'session';

export interface SessionUser {
  userId: number;
  email: string;
  sessionId: number;
}

// Resolve the current session from the cookie. Only the hash of the session secret is stored, so
// the lookup hashes the presented secret and matches on the indexed column (spec §4).
export function getSession(req: IncomingMessage, ctx: Ctx, now: number = Date.now()): SessionUser | null {
  const cookies = parseCookies(req);
  const secret = cookies[SESSION_COOKIE];
  if (!secret) return null;
  const row = ctx.db
    .prepare(
      `SELECT s.id AS sessionId, s.user_id AS userId, s.expires_at AS expiresAt, u.email AS email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.session_hash = ?`,
    )
    .get(sha256(secret)) as { sessionId: number; userId: number; expiresAt: number; email: string } | undefined;
  if (!row || row.expiresAt <= now) return null;
  return { userId: row.userId, email: row.email, sessionId: row.sessionId };
}

export function requireSession(req: IncomingMessage, ctx: Ctx): SessionUser {
  const session = getSession(req, ctx);
  if (!session) throw new HttpError(401, 'authentication required');
  return session;
}

// Mint a new session for a user and return the Set-Cookie header value. Only the hash of the
// opaque secret is persisted. Shared by magic-link verify and the dev auth bypass.
export function createSessionCookie(ctx: Ctx, userId: number, now: number = Date.now()): string {
  const sessionSecret = randomToken(32);
  ctx.db
    .prepare('INSERT INTO sessions (session_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(sha256(sessionSecret), userId, now + ctx.config.sessionTtlMs, now);
  return serializeCookie(SESSION_COOKIE, sessionSecret, {
    httpOnly: true,
    secure: ctx.config.cookieSecure,
    sameSite: 'Lax',
    maxAgeMs: ctx.config.sessionTtlMs,
  });
}

function buildVerifyLink(ctx: Ctx, token: string): string {
  const scheme = ctx.config.cookieSecure ? 'https' : 'http';
  const host = ctx.config.devMode ? `localhost:${ctx.config.port}` : `app.${ctx.config.baseDomain}`;
  return `${scheme}://${host}/auth/verify?token=${encodeURIComponent(token)}`;
}

// POST /api/auth/request { email } — always responds with a neutral 200 (no account enumeration).
export async function requestMagicLink(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const body = await readJson(req, ctx.config.maxBodyBytes);
  let email: string;
  try {
    email = normalizeEmail(body.email);
  } catch {
    // Even on a malformed email, respond neutrally so probing reveals nothing.
    sendJson(res, 200, { ok: true, message: 'If that email is valid, a sign-in link is on its way.' });
    return;
  }

  const now = Date.now();
  const ip = clientIp(req);
  const { rateLimitMax, rateLimitWindowMs } = ctx.config;
  const allowed =
    checkRateLimit(ctx.db, `email:${email}`, rateLimitMax, rateLimitWindowMs, now) &&
    checkRateLimit(ctx.db, `ip:${ip}`, rateLimitMax * 3, rateLimitWindowMs, now);

  if (allowed) {
    ctx.db
      .prepare('INSERT INTO users (email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING')
      .run(email, now);

    const token = randomToken(32);
    ctx.db
      .prepare('INSERT INTO magic_tokens (token_hash, email, expires_at, used_at) VALUES (?, ?, ?, NULL)')
      .run(sha256(token), email, now + ctx.config.magicTokenTtlMs);

    await ctx.email.sendMagicLink(email, buildVerifyLink(ctx, token));
  }

  // Neutral response regardless of whether the email existed or was rate-limited.
  sendJson(res, 200, { ok: true, message: 'If that email is valid, a sign-in link is on its way.' });
}

// POST /api/auth/verify { token } — single-use, short-TTL; on success sets the session cookie.
export async function verifyMagicLink(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const body = await readJson(req, ctx.config.maxBodyBytes);
  const token = typeof body.token === 'string' ? body.token : '';
  if (!token) throw new HttpError(400, 'token is required');

  const now = Date.now();
  const tokenHash = sha256(token);
  const row = ctx.db
    .prepare('SELECT email, expires_at AS expiresAt, used_at AS usedAt FROM magic_tokens WHERE token_hash = ?')
    .get(tokenHash) as { email: string; expiresAt: number; usedAt: number | null } | undefined;

  if (!row || row.usedAt != null || row.expiresAt <= now) {
    throw new HttpError(400, 'this sign-in link is invalid or has expired');
  }

  // Single-use: mark consumed. (Single in-process writer, so this is effectively atomic.)
  ctx.db.prepare('UPDATE magic_tokens SET used_at = ? WHERE token_hash = ?').run(now, tokenHash);

  const user = ctx.db.prepare('SELECT id FROM users WHERE email = ?').get(row.email) as { id: number } | undefined;
  if (!user) throw new HttpError(400, 'this sign-in link is invalid or has expired');

  const cookie = createSessionCookie(ctx, user.id, now);
  sendJson(res, 200, { ok: true, user: { email: row.email } }, { 'set-cookie': cookie });
}

// POST /api/auth/logout — delete the current session and clear the cookie.
export async function logout(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const session = getSession(req, ctx);
  if (session) ctx.db.prepare('DELETE FROM sessions WHERE id = ?').run(session.sessionId);
  const cleared = serializeCookie(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: ctx.config.cookieSecure,
    sameSite: 'Lax',
    maxAgeMs: 0,
  });
  sendJson(res, 200, { ok: true }, { 'set-cookie': cleared });
}

// GET /api/me — current user.
export function me(req: IncomingMessage, res: ServerResponse, ctx: Ctx): void {
  const session = requireSession(req, ctx);
  sendJson(res, 200, { user: { email: session.email } });
}
