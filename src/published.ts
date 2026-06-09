import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Ctx } from './context.ts';
import { serveStatic } from './static.ts';

// The published-presentation origin. Static, read-only, NO cookies, strict CSP — origin-isolated
// from the control-plane app (spec §6, #0 §B4). Two routings resolve to the same server core:
//   • path-based on the dedicated published host:  presentations.<base>/p/<slug>/...  (the deploy)
//   • legacy host-based:                           <slug>.<base>/...                  (kept for tests)
// A single explicit `presentations.` record avoids a wildcard that would swallow sibling
// deployments' subdomains; per-presentation paths avoid a two-level wildcard cert.

// Slug charset mirrors slugify(): lowercase alphanumerics + hyphens. Validated before any
// filesystem lookup so a path segment can never carry traversal or unexpected characters.
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

const PUBLISHED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; " +
  "frame-ancestors 'none'; object-src 'none'";

const PUBLISHED_HEADERS: Record<string, string> = {
  'content-security-policy': PUBLISHED_CSP,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'cache-control': 'public, max-age=60',
};

// Extract the single-label slug from "<slug>.<baseDomain>".
export function slugFromHost(hostname: string, baseDomain: string): string | null {
  const suffix = '.' + baseDomain;
  if (!hostname.endsWith(suffix)) return null;
  const slug = hostname.slice(0, -suffix.length);
  if (!slug || slug.includes('.')) return null;
  return slug;
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
  res.end('Presentation not found');
}

// Parse a path-based published URL: /p/<slug>[/asset...]. Returns the slug and the asset
// sub-path, or a redirect when the slug has no trailing slash (so the index's relative asset
// refs resolve under /p/<slug>/). Returns null for anything that isn't a valid published path.
export function parsePublishedPath(pathname: string): { slug: string; assetPath: string } | { redirectTo: string } | null {
  if (!pathname.startsWith('/p/')) return null;
  const rest = pathname.slice(3);
  const slash = rest.indexOf('/');
  const slug = slash === -1 ? rest : rest.slice(0, slash);
  if (!SLUG_RE.test(slug)) return null;
  if (slash === -1) return { redirectTo: `/p/${slug}/` }; // bare /p/<slug> → add trailing slash
  const remainder = rest.slice(slash + 1);
  return { slug, assetPath: remainder === '' ? '/' : `/${remainder}` };
}

// Core: look up a published presentation by slug and serve `assetPath` from its artifact dir.
async function servePublished(res: ServerResponse, ctx: Ctx, slug: string, assetPath: string): Promise<void> {
  const row = ctx.db
    .prepare(`SELECT id FROM presentations WHERE slug = ? AND status = 'published'`)
    .get(slug) as { id: number } | undefined;
  if (!row) {
    notFound(res);
    return;
  }
  const dir = join(ctx.config.dataDir, 'presentations', String(row.id));
  const served = await serveStatic(res, dir, assetPath, { headers: PUBLISHED_HEADERS, spaFallback: false });
  if (!served) notFound(res);
}

// Path-based entry (presentations.<base>/p/<slug>/...) — the production routing.
export async function handlePublishedPath(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://published.local');
  const parsed = parsePublishedPath(url.pathname);
  if (!parsed) {
    notFound(res);
    return;
  }
  if ('redirectTo' in parsed) {
    res.writeHead(301, { location: parsed.redirectTo, 'x-content-type-options': 'nosniff' });
    res.end();
    return;
  }
  await servePublished(res, ctx, parsed.slug, parsed.assetPath);
}

// Legacy host-based entry (<slug>.<base>/...). Kept for backward compatibility / tests.
export async function handlePublished(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: Ctx,
  hostname: string,
): Promise<void> {
  const slug = slugFromHost(hostname, ctx.config.baseDomain);
  if (!slug) {
    notFound(res);
    return;
  }
  const url = new URL(req.url ?? '/', 'http://published.local');
  await servePublished(res, ctx, slug, url.pathname);
}
