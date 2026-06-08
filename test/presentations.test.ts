import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, signIn } from './helpers.ts';
import type { TestApp } from './helpers.ts';

let current: TestApp | null = null;
async function boot() { current = await bootTestApp(); return current; }
afterEach(async () => { if (current) { await current.app.close(); current = null; } });

test('create, list, fetch and edit a presentation', async () => {
  const t = await boot();
  const c = await signIn(t, 'author@example.com');

  const created = await c.request('POST', '/api/presentations', {
    body: { title: 'Quantum Foam', sourceWriteup: 'Bubbles all the way down.' },
  });
  assert.equal(created.status, 201);
  const id = created.json.presentation.id;
  assert.equal(created.json.presentation.status, 'draft');

  const listed = await c.request('GET', '/api/presentations');
  assert.equal(listed.json.presentations.length, 1);

  const patched = await c.request('PATCH', `/api/presentations/${id}`, { body: { title: 'Quantum Foam 2' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.presentation.title, 'Quantum Foam 2');
  assert.equal(patched.json.presentation.sourceWriteup, 'Bubbles all the way down.'); // unchanged
});

test('title is required, write-up size is bounded', async () => {
  const t = await boot();
  const c = await signIn(t, 'val@example.com');
  assert.equal((await c.request('POST', '/api/presentations', { body: { title: '   ' } })).status, 400);
  const huge = 'x'.repeat(60_000);
  assert.equal(
    (await c.request('POST', '/api/presentations', { body: { title: 'ok', sourceWriteup: huge } })).status,
    400,
  );
});

test('a user cannot read, edit, or publish another user\'s presentation', async () => {
  const t = await boot();
  const alice = await signIn(t, 'alice@example.com');
  const bob = await signIn(t, 'bob@example.com');

  const created = await alice.request('POST', '/api/presentations', { body: { title: 'Secret' } });
  const id = created.json.presentation.id;

  assert.equal((await bob.request('GET', `/api/presentations/${id}`)).status, 404);
  assert.equal((await bob.request('PATCH', `/api/presentations/${id}`, { body: { title: 'hax' } })).status, 404);
  assert.equal((await bob.request('POST', `/api/presentations/${id}/publish`)).status, 404);

  // bob's own list stays empty
  assert.equal((await bob.request('GET', '/api/presentations')).json.presentations.length, 0);
});
