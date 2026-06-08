import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Ctx } from './context.ts';
import { serveStatic } from './static.ts';

// The published-presentation origin (<slug>.themultiverse.school). Static, read-only, NO cookies,
// strict CSP — origin-isolated from the control-plane app (spec §6, #0 §B4).

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
  const row = ctx.db
    .prepare(`SELECT id FROM presentations WHERE slug = ? AND status = 'published'`)
    .get(slug) as { id: number } | undefined;
  if (!row) {
    notFound(res);
    return;
  }

  const url = new URL(req.url ?? '/', 'http://published.local');
  const dir = join(ctx.config.dataDir, 'presentations', String(row.id));
  const served = await serveStatic(res, dir, url.pathname, { headers: PUBLISHED_HEADERS, spaFallback: false });
  if (!served) notFound(res);
}
