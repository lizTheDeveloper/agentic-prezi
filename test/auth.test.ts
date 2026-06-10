import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp, makeClient, signIn } from './helpers.ts';
import type { TestApp } from './helpers.ts';

let current: TestApp | null = null;
async function boot() { current = await bootTestApp(); return current; }
afterEach(async () => { if (current) { await current.app.close(); current = null; } });

test('health check responds ok', async () => {
  const t = await boot();
  const res = await t.client.request('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
});

test('a valid School session cookie authenticates the user (SSO)', async () => {
  const t = await boot();
  const c = signIn(t, 'Alice@Example.com');
  const me = await c.request('GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, 'alice@example.com'); // normalized lowercase
});

test('no cookie → unauthenticated; protected endpoints 401', async () => {
  const t = await boot();
  const c = makeClient(t.port);
  assert.equal((await c.request('GET', '/api/me')).status, 401);
  assert.equal((await c.request('GET', '/api/presentations')).status, 401);
});

test('an unknown / malformed session id is rejected', async () => {
  const t = await boot();
  const c = makeClient(t.port);
  c.jar.cookie = 'session=no-such-sid';
  assert.equal((await c.request('GET', '/api/me')).status, 401);
  // control chars / illegal charset never reach Redis
  const c2 = makeClient(t.port);
  c2.jar.cookie = 'session=bad%0d%0avalue';
  assert.equal((await c2.request('GET', '/api/me')).status, 401);
});

test('an expired School session blob is rejected', async () => {
  const t = await boot();
  const c = signIn(t, 'carol@example.com', { expiresSec: Math.floor(Date.now() / 1000) - 10 });
  assert.equal((await c.request('GET', '/api/me')).status, 401);
});

test('login-url endpoint reports auth state + where to send the browser', async () => {
  const t = await boot();
  const anon = await makeClient(t.port).request('GET', '/api/auth/login-url');
  assert.equal(anon.status, 200);
  assert.equal(anon.json.authenticated, false);
  assert.equal(anon.json.loginUrl, 'https://themultiverse.school/login');

  const c = signIn(t, 'dora@example.com');
  const authed = await c.request('GET', '/api/auth/login-url');
  assert.equal(authed.json.authenticated, true);
});

test('logout points the browser at the School logout', async () => {
  const t = await boot();
  const c = signIn(t, 'frank@example.com');
  const res = await c.request('POST', '/api/auth/logout');
  assert.equal(res.status, 200);
  assert.equal(res.json.redirect, 'https://themultiverse.school/logout');
});

test('non-GET /api without X-Requested-With is rejected (CSRF)', async () => {
  const t = await boot();
  const c = signIn(t, 'eve@example.com');
  const res = await c.request('POST', '/api/presentations', { body: { title: 'x', sourceWriteup: 'y' }, csrf: false });
  assert.equal(res.status, 403);
});
