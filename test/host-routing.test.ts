import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, signIn } from './helpers.ts';
import type { TestApp } from './helpers.ts';

let current: TestApp | null = null;
afterEach(async () => { if (current) { await current.app.close(); current = null; } });

test('app Host serves the SPA shell', async () => {
  const t = (current = await bootTestApp());
  const res = await t.client.request('GET', '/', { host: 'app.themultiverse.school' });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'] ?? '', /text\/html/);
  assert.match(res.text, /agentic-prezi/);
  assert.match(res.headers['content-security-policy'] ?? '', /default-src 'self'/);
});

test('unknown SPA route falls back to index.html', async () => {
  const t = (current = await bootTestApp());
  const res = await t.client.request('GET', '/editor/123', { host: 'app.themultiverse.school' });
  assert.equal(res.status, 200);
  assert.match(res.text, /app\.js/);
});

test('unknown slug Host returns 404', async () => {
  const t = (current = await bootTestApp());
  const res = await t.client.request('GET', '/', { host: 'no-such-slug.themultiverse.school' });
  assert.equal(res.status, 404);
});

test('slug Host serves the published artifacts with a strict CSP and no cookies', async () => {
  const t = (current = await bootTestApp());
  const c = await signIn(t, 'host@example.com');
  const id = (await c.request('POST', '/api/presentations', { body: { title: 'Routed', sourceWriteup: 'hi' } }))
    .json.presentation.id;
  await c.request('POST', `/api/presentations/${id}/publish`);
  await t.app.worker.drain();
  const slug = (await c.request('GET', `/api/presentations/${id}`)).json.presentation.slug;

  const host = `${slug}.themultiverse.school`;
  const index = await t.client.request('GET', '/', { host });
  assert.equal(index.status, 200);
  assert.match(index.headers['content-type'] ?? '', /text\/html/);
  const csp = index.headers['content-security-policy'] ?? '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(index.headers['set-cookie'], undefined); // published origin never sets cookies

  const manifest = await t.client.request('GET', '/manifest.json', { host });
  assert.equal(manifest.status, 200);
  assert.equal(manifest.json.slug, slug);

  // traversal attempt stays contained
  const escape = await t.client.request('GET', '/../../app.db', { host });
  assert.equal(escape.status, 404);
});

test('published host serves presentations path-based at /p/<slug>/ (the deploy routing)', async () => {
  const t = (current = await bootTestApp());
  const c = await signIn(t, 'pathed@example.com');
  const id = (await c.request('POST', '/api/presentations', { body: { title: 'Pathed', sourceWriteup: 'hi' } }))
    .json.presentation.id;
  await c.request('POST', `/api/presentations/${id}/publish`);
  await t.app.worker.drain();
  const detail = (await c.request('GET', `/api/presentations/${id}`)).json.presentation;
  const slug = detail.slug;

  // The published URL handed to the user is path-based on the single dedicated host.
  assert.equal(detail.url, `https://presentations.themultiverse.school/p/${slug}`);

  const host = 'presentations.themultiverse.school';

  // Bare /p/<slug> redirects to a trailing slash so the index's relative asset refs resolve.
  const bare = await t.client.request('GET', `/p/${slug}`, { host });
  assert.equal(bare.status, 301);
  assert.equal(bare.headers['location'], `/p/${slug}/`);

  // /p/<slug>/ serves the index with the strict, cookieless published CSP.
  const index = await t.client.request('GET', `/p/${slug}/`, { host });
  assert.equal(index.status, 200);
  assert.match(index.headers['content-type'] ?? '', /text\/html/);
  const csp = index.headers['content-security-policy'] ?? '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'none'/);
  assert.equal(index.headers['set-cookie'], undefined);

  // Assets resolve under the slug path.
  const manifest = await t.client.request('GET', `/p/${slug}/manifest.json`, { host });
  assert.equal(manifest.status, 200);
  assert.equal(manifest.json.slug, slug);

  // Unknown slug, malformed slug, and traversal all 404 — never leak or escape.
  assert.equal((await t.client.request('GET', '/p/no-such-slug/', { host })).status, 404);
  assert.equal((await t.client.request('GET', '/p/Bad_Slug!/', { host })).status, 404);
  assert.equal((await t.client.request('GET', `/p/${slug}/../../app.db`, { host })).status, 404);
  // The app SPA must NOT be served from the published host.
  assert.equal((await t.client.request('GET', '/', { host })).status, 404);
});
