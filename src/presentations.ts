import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Ctx } from './context.ts';
import type { Params } from './router.ts';
import { HttpError, readJson, sendJson } from './http.ts';
import { requireSession } from './auth.ts';
import { validateTitle, validateWriteup } from './validate.ts';

// Presentation CRUD + publish. Every handler enforces ownership: a user only ever sees or mutates
// their own rows (spec §7, §10).

interface PresentationRow {
  id: number;
  user_id: number;
  title: string;
  source_writeup: string;
  status: string;
  slug: string | null;
  created_at: number;
  updated_at: number;
}

function publicView(row: PresentationRow, publishedHost: string) {
  return {
    id: row.id,
    title: row.title,
    sourceWriteup: row.source_writeup,
    status: row.status,
    slug: row.slug,
    // Path-based on the single dedicated published host: https://presentations.<base>/p/<slug>
    url: row.slug && row.status === 'published' ? `https://${publishedHost}/p/${row.slug}` : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Load a presentation, enforcing ownership. 404 (not 403) so non-owners can't probe existence.
function ownedOr404(ctx: Ctx, id: number, userId: number): PresentationRow {
  const row = ctx.db.prepare('SELECT * FROM presentations WHERE id = ?').get(id) as PresentationRow | undefined;
  if (!row || row.user_id !== userId) throw new HttpError(404, 'presentation not found');
  return row;
}

function parseId(params: Params): number {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'presentation not found');
  return id;
}

// GET /api/presentations
export function list(req: IncomingMessage, res: ServerResponse, ctx: Ctx): void {
  const session = requireSession(req, ctx);
  const rows = ctx.db
    .prepare('SELECT * FROM presentations WHERE user_id = ? ORDER BY updated_at DESC')
    .all(session.userId) as PresentationRow[];
  sendJson(res, 200, { presentations: rows.map((r) => publicView(r, ctx.config.publishedHost)) });
}

// POST /api/presentations { title, sourceWriteup }
export async function create(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const session = requireSession(req, ctx);
  const body = await readJson(req, ctx.config.maxBodyBytes);
  const title = validateTitle(body.title, ctx.config.maxTitleLen);
  const writeup = validateWriteup(body.sourceWriteup, ctx.config.maxWriteupLen);
  const now = Date.now();
  const info = ctx.db
    .prepare(
      `INSERT INTO presentations (user_id, title, source_writeup, status, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?)`,
    )
    .run(session.userId, title, writeup, now, now);
  const row = ctx.db.prepare('SELECT * FROM presentations WHERE id = ?').get(Number(info.lastInsertRowid)) as PresentationRow;
  sendJson(res, 201, { presentation: publicView(row, ctx.config.publishedHost) });
}

// GET /api/presentations/:id
export function detail(req: IncomingMessage, res: ServerResponse, ctx: Ctx, params: Params): void {
  const session = requireSession(req, ctx);
  const row = ownedOr404(ctx, parseId(params), session.userId);
  sendJson(res, 200, { presentation: publicView(row, ctx.config.publishedHost) });
}

// PATCH /api/presentations/:id { title?, sourceWriteup? }
export async function update(req: IncomingMessage, res: ServerResponse, ctx: Ctx, params: Params): Promise<void> {
  const session = requireSession(req, ctx);
  const row = ownedOr404(ctx, parseId(params), session.userId);
  const body = await readJson(req, ctx.config.maxBodyBytes);

  const title = body.title === undefined ? row.title : validateTitle(body.title, ctx.config.maxTitleLen);
  const writeup =
    body.sourceWriteup === undefined ? row.source_writeup : validateWriteup(body.sourceWriteup, ctx.config.maxWriteupLen);

  ctx.db
    .prepare('UPDATE presentations SET title = ?, source_writeup = ?, updated_at = ? WHERE id = ?')
    .run(title, writeup, Date.now(), row.id);
  const updated = ctx.db.prepare('SELECT * FROM presentations WHERE id = ?').get(row.id) as PresentationRow;
  sendJson(res, 200, { presentation: publicView(updated, ctx.config.publishedHost) });
}

// POST /api/presentations/:id/publish — enqueue generation, return immediately (async).
export function publish(req: IncomingMessage, res: ServerResponse, ctx: Ctx, params: Params): void {
  const session = requireSession(req, ctx);
  const row = ownedOr404(ctx, parseId(params), session.userId);
  if (row.status === 'queued' || row.status === 'generating') {
    throw new HttpError(409, 'this presentation is already being published');
  }
  const now = Date.now();
  ctx.db.prepare(`UPDATE presentations SET status = 'queued', updated_at = ? WHERE id = ?`).run(now, row.id);
  ctx.queue.enqueue(row.id, 'generate', { presentationId: row.id }, now);
  sendJson(res, 202, { ok: true, status: 'queued' });
}
