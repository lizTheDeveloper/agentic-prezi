import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bootTestApp, signIn } from './helpers.ts';
import type { TestApp } from './helpers.ts';

let current: TestApp | null = null;
afterEach(async () => { if (current) { await current.app.close(); current = null; } });

test('publishing a draft yields artifacts, a unique slug, and a retrievable presentation', async () => {
  const t = (current = await bootTestApp());
  const c = await signIn(t, 'pub@example.com');
  const created = await c.request('POST', '/api/presentations', {
    body: { title: 'My Talk', sourceWriteup: 'Hello <world> & "everyone".' },
  });
  const id = created.json.presentation.id;

  const pub = await c.request('POST', `/api/presentations/${id}/publish`);
  assert.equal(pub.status, 202);
  assert.equal((await c.request('GET', `/api/presentations/${id}`)).json.presentation.status, 'queued');

  await t.app.worker.drain();

  const detail = (await c.request('GET', `/api/presentations/${id}`)).json.presentation;
  assert.equal(detail.status, 'published');
  assert.ok(detail.slug, 'slug minted');
  assert.equal(detail.url, `https://presentations.themultiverse.school/p/${detail.slug}`);

  // artifacts written per the generator contract
  const dir = join(t.dataDir, 'presentations', String(id));
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.entry, 'index.html');
  assert.deepEqual(manifest.artifacts.sort(), ['index.html', 'manifest.json', 'presentation.svg', 'styles.css']);

  // user input is escaped, not injected, into the SVG
  const svg = await readFile(join(dir, 'presentation.svg'), 'utf8');
  assert.match(svg, /&lt;world&gt;/);
  assert.doesNotMatch(svg, /<world>/);
});

test('a generator failure marks the presentation failed (after retries exhausted)', async () => {
  const t = (current = await bootTestApp({
    pollMs: 1e9,
    retry: { maxAttempts: 2, backoffMs: 0 },
    generator: async () => { throw new Error('boom'); },
  }));
  const c = await signIn(t, 'fail@example.com');
  const id = (await c.request('POST', '/api/presentations', { body: { title: 'Doomed' } })).json.presentation.id;
  await c.request('POST', `/api/presentations/${id}/publish`);

  // first attempt fails and requeues; second attempt exhausts retries
  await t.app.worker.tick();
  assert.notEqual((await c.request('GET', `/api/presentations/${id}`)).json.presentation.status, 'failed');
  await t.app.worker.tick();
  assert.equal((await c.request('GET', `/api/presentations/${id}`)).json.presentation.status, 'failed');
});

test('publishing twice while in-flight is rejected', async () => {
  const t = (current = await bootTestApp());
  const c = await signIn(t, 'dup@example.com');
  const id = (await c.request('POST', '/api/presentations', { body: { title: 'Once' } })).json.presentation.id;
  assert.equal((await c.request('POST', `/api/presentations/${id}/publish`)).status, 202);
  assert.equal((await c.request('POST', `/api/presentations/${id}/publish`)).status, 409);
});
