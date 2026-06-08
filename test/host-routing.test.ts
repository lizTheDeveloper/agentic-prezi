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
