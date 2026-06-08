import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Ctx } from './context.ts';
import { HttpError, readJson, sendJson } from './http.ts';
import { normalizeEmail } from './validate.ts';
import { createSessionCookie } from './auth.ts';

// DEV-ONLY auth bypass: mints a session for an email WITHOUT the magic-link/email step, so a
// developer can sign in instantly. Active only when `config.devAuthBypass` is true (dev mode +
// explicit DEV_AUTH_BYPASS=1; loadConfig refuses it under NODE_ENV=production). Hard-guarded
// here as well, so even if the route is somehow reachable it does nothing unless explicitly on.
//
// GET is supported on purpose: a developer can just visit http://localhost:PORT/api/dev/login
// in the browser to get a session cookie, then open the app. (GET skips the CSRF header check.)
export async function devLogin(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  if (!ctx.config.devAuthBypass) throw new HttpError(404, 'not found');

  let email = 'dev@localhost';
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const body = await readJson(req, ctx.config.maxBodyBytes).catch(() => ({}) as Record<string, unknown>);
    if (body && typeof body.email === 'string' && body.email.trim()) {
      try {
        email = normalizeEmail(body.email);
      } catch {
        /* malformed → fall back to the default dev email */
      }
    }
  }

  const now = Date.now();
  ctx.db
    .prepare('INSERT INTO users (email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING')
    .run(email, now);
  const user = ctx.db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number };
  const cookie = createSessionCookie(ctx, user.id, now);
  sendJson(res, 200, { ok: true, devBypass: true, user: { email } }, { 'set-cookie': cookie });
}
