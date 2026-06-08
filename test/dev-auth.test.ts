import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.ts';
import type { App } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';
import { CaptureEmail, makeClient } from './helpers.ts';

// Boot an app with arbitrary env overrides on top of the dev defaults.
function bootWith(env: Record<string, string>): App {
  const dataDir = mkdtempSync(join(tmpdir(), 'prezi-devauth-'));
  const config = loadConfig({
    DB_PATH: ':memory:',
    DATA_DIR: dataDir,
    BASE_DOMAIN: 'themultiverse.school',
    COOKIE_SECURE: 'false',
    DEV_MODE: 'true',
    PUBLIC_DIR: 'public',
    PORT: '0',
    ...env,
  });
  return createApp({ config, email: new CaptureEmail(), worker: { pollMs: 1e9 } });
}

test('dev bypass: POST mints a session without the email step when enabled', async () => {
  const app = bootWith({ DEV_AUTH_BYPASS: '1' });
  const port = await app.listen(0);
  try {
    const client = makeClient(port);
    const res = await client.request('POST', '/api/dev/login', { body: { email: 'dev@example.com' } });
    assert.equal(res.status, 200);
    assert.equal(res.json.devBypass, true);
    const me = await client.request('GET', '/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, 'dev@example.com');
  } finally {
    await app.close();
  }
});

test('dev bypass: GET works (browser-friendly) and defaults the email', async () => {
  const app = bootWith({ DEV_AUTH_BYPASS: '1' });
  const port = await app.listen(0);
  try {
    const client = makeClient(port);
    const res = await client.request('GET', '/api/dev/login');
    assert.equal(res.status, 200);
    const me = await client.request('GET', '/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, 'dev@localhost');
  } finally {
    await app.close();
  }
});

test('dev bypass: 404 when disabled (the default)', async () => {
  const app = bootWith({}); // DEV_AUTH_BYPASS unset
  const port = await app.listen(0);
  try {
    const res = await makeClient(port).request('GET', '/api/dev/login');
    assert.equal(res.status, 404);
  } finally {
    await app.close();
  }
});

test('config refuses DEV_AUTH_BYPASS under NODE_ENV=production', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', DEV_AUTH_BYPASS: '1' }),
    /production/i,
  );
});
