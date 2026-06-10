import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../src/crypto.ts';
import { buildVerifyLink } from '../src/auth.ts';
import { loadConfig } from '../src/config.ts';
import { bootTestApp, makeClient, tokenFromLink } from './helpers.ts';
import type { TestApp } from './helpers.ts';

test('magic-link verify URL uses the configured app host + https in production', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    APP_HOST: 'presapp.themultiverse.school',
    COOKIE_SECURE: 'true',
    SENDGRID_API_KEY: 'SG.x',
    EMAIL_FROM: 'aethrix@themultiverse.school',
  });
  assert.equal(buildVerifyLink({ config } as never, 'TOK'), 'https://presapp.themultiverse.school/auth/verify?token=TOK');
});

test('magic-link verify URL falls back to app.<base> when APP_HOST is unset', () => {
  const config = loadConfig({ NODE_ENV: 'production', SENDGRID_API_KEY: 'SG.x', EMAIL_FROM: 'a@b.c' });
  assert.equal(buildVerifyLink({ config } as never, 'T'), 'https://app.themultiverse.school/auth/verify?token=T');
});

let current: TestApp | null = null;
async function boot() { current = await bootTestApp(); return current; }
afterEach(async () => { if (current) { await current.app.close(); current = null; } });

test('health check responds ok', async () => {
  const t = await boot();
  const res = await t.client.request('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
});

test('magic-link round trip signs the user in', async () => {
  const t = await boot();
  const c = makeClient(t.port);
  const req = await c.request('POST', '/api/auth/request', { body: { email: 'Alice@Example.com' } });
  assert.equal(req.status, 200);
  assert.equal(t.email.sent.length, 1);
  assert.equal(t.email.sent[0].email, 'alice@example.com'); // normalized

  const token = tokenFromLink(t.email.sent[0].link);
  const verify = await c.request('POST', '/api/auth/verify', { body: { token } });
  assert.equal(verify.status, 200);
  assert.match(String(verify.headers['set-cookie']), /session=/);

  const me = await c.request('GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, 'alice@example.com');
});

test('a magic token is single-use', async () => {
  const t = await boot();
  const c = makeClient(t.port);
  await c.request('POST', '/api/auth/request', { body: { email: 'bob@example.com' } });
  const token = tokenFromLink(t.email.sent[0].link);
  const c2 = makeClient(t.port);
  assert.equal((await c2.request('POST', '/api/auth/verify', { body: { token } })).status, 200);
  // second use of the same token must fail
  const c3 = makeClient(t.port);
  assert.equal((await c3.request('POST', '/api/auth/verify', { body: { token } })).status, 400);
});

test('an expired token is rejected', async () => {
  const t = await boot();
  // Insert a token whose expiry is already in the past.
  const token = 'expired-token-value';
  t.app.ctx.db
    .prepare('INSERT INTO users (email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING')
    .run('carol@example.com', Date.now());
  t.app.ctx.db
    .prepare('INSERT INTO magic_tokens (token_hash, email, expires_at, used_at) VALUES (?, ?, ?, NULL)')
    .run(sha256(token), 'carol@example.com', Date.now() - 1000);
  const c = makeClient(t.port);
  const res = await c.request('POST', '/api/auth/verify', { body: { token } });
  assert.equal(res.status, 400);
});

test('auth-request rate-limits per email but always responds neutrally', async () => {
  const t = await boot();
  const c = makeClient(t.port);
  for (let i = 0; i < 8; i++) {
    const res = await c.request('POST', '/api/auth/request', { body: { email: 'dora@example.com' } });
    assert.equal(res.status, 200); // never reveals throttling
  }
  // default RATE_LIMIT_MAX is 5 — no more than that many links are actually sent
  assert.equal(t.email.sent.length, 5);
});

test('invalid email still gets a neutral 200 (no enumeration)', async () => {
  const t = await boot();
  const c = makeClient(t.port);
  const res = await c.request('POST', '/api/auth/request', { body: { email: 'not-an-email' } });
  assert.equal(res.status, 200);
  assert.equal(t.email.sent.length, 0);
});

test('non-GET /api without X-Requested-With is rejected (CSRF)', async () => {
  const t = await boot();
  const c = makeClient(t.port);
  const res = await c.request('POST', '/api/auth/request', { body: { email: 'eve@example.com' }, csrf: false });
  assert.equal(res.status, 403);
});

test('protected endpoints require a session', async () => {
  const t = await boot();
  const c = makeClient(t.port);
  assert.equal((await c.request('GET', '/api/me')).status, 401);
  assert.equal((await c.request('GET', '/api/presentations')).status, 401);
});

test('logout clears the session', async () => {
  const t = await boot();
  const c = makeClient(t.port);
  await c.request('POST', '/api/auth/request', { body: { email: 'frank@example.com' } });
  await c.request('POST', '/api/auth/verify', { body: { token: tokenFromLink(t.email.sent[0].link) } });
  assert.equal((await c.request('GET', '/api/me')).status, 200);
  await c.request('POST', '/api/auth/logout');
  assert.equal((await c.request('GET', '/api/me')).status, 401);
});
