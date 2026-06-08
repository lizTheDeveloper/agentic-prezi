import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Ctx } from './context.ts';
import { Router } from './router.ts';
import { HttpError, sendJson } from './http.ts';
import { serveStatic } from './static.ts';
import { requestMagicLink, verifyMagicLink, logout, me } from './auth.ts';
import { list, create, detail, update, publish } from './presentations.ts';
import { devLogin } from './dev-auth.ts';

// The app-origin handler: JSON API under /api/* plus the static vanilla SPA (with client-side
// routing fallback). Cookies + auth live here only (the published origin is separate).

// App-origin CSP. The published origin gets a much stricter policy in published.ts.
const APP_CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
  "base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";

export function buildRouter(): Router {
  const r = new Router();
  r.get('/api/health', (_req, res) => sendJson(res, 200, { ok: true }));

  r.post('/api/auth/request', requestMagicLink);
  r.post('/api/auth/verify', verifyMagicLink);
  r.post('/api/auth/logout', logout);
  r.get('/api/me', me);

  r.get('/api/presentations', list);
  r.post('/api/presentations', create);
  r.get('/api/presentations/:id', detail);
  r.patch('/api/presentations/:id', update);
  r.post('/api/presentations/:id/publish', publish);

  // DEV-ONLY bypass (GET + POST). The handler 404s unless config.devAuthBypass is on, so this is
  // inert in production (and loadConfig refuses to enable it there at all).
  r.get('/api/dev/login', devLogin);
  r.post('/api/dev/login', devLogin);
  return r;
}

const router = buildRouter();

export async function handleApp(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://app.local');
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api' || path.startsWith('/api/')) {
    // CSRF: state-changing requests must carry a custom header a cross-site HTML form cannot set,
    // on top of SameSite cookies (spec §4, §8).
    if (method !== 'GET' && method !== 'HEAD' && !req.headers['x-requested-with']) {
      sendJson(res, 403, { error: 'missing X-Requested-With header' });
      return;
    }
    const route = router.match(method, path);
    if (!route) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    try {
      await route.handler(req, res, ctx, route.params);
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
      } else {
        console.error('api error:', err);
        sendJson(res, 500, { error: 'internal server error' });
      }
    }
    return;
  }

  // Static SPA with client-side routing fallback to index.html.
  const served = await serveStatic(res, ctx.config.publicDir, path, {
    headers: { 'content-security-policy': APP_CSP, 'cache-control': 'no-cache' },
    spaFallback: true,
  });
  if (!served) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}
