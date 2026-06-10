import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Ctx } from './context.ts';
import { HttpError, sendJson } from './http.ts';

// Auth is School SSO (src/school-sso.ts): handleApp resolves the shared `.themultiverse.school`
// session once per API request and stashes the user here; the route handlers read it via
// getSession/requireSession. Aethrix issues no session cookie of its own, so there is nothing to
// mint or clear — logout just sends the browser to the School logout.

export interface SessionUser {
  userId: number;
  email: string;
}

// Per-request resolved user, keyed by the request object (no mutation of req, no `any`).
const RESOLVED = new WeakMap<IncomingMessage, SessionUser | null>();

/** Called by handleApp after resolving the School session, before routing. */
export function attachResolvedUser(req: IncomingMessage, user: SessionUser | null): void {
  RESOLVED.set(req, user);
}

/** The current user for this request, or null if unauthenticated. */
export function getSession(req: IncomingMessage, _ctx?: Ctx): SessionUser | null {
  return RESOLVED.get(req) ?? null;
}

export function requireSession(req: IncomingMessage, ctx: Ctx): SessionUser {
  const session = getSession(req, ctx);
  if (!session) throw new HttpError(401, 'authentication required');
  return session;
}

// POST /api/auth/logout — there is no local session to destroy; tell the SPA where to send the
// browser so the School drops the shared cookie for every subdomain.
export function logout(_req: IncomingMessage, res: ServerResponse, ctx: Ctx): void {
  sendJson(res, 200, { ok: true, redirect: ctx.config.schoolLogoutUrl });
}

// GET /api/me — current user, or 401 (the SPA redirects to the School login on 401).
export function me(req: IncomingMessage, res: ServerResponse, ctx: Ctx): void {
  const session = requireSession(req, ctx);
  sendJson(res, 200, { user: { email: session.email } });
}
