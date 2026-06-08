import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheKey, isFresh, withCache, DEFAULT_TTL_MS } from './cache.mjs';

test('cacheKey is stable and query-normalized', () => {
  assert.equal(cacheKey('openalex', 'Deep   Learning'), cacheKey('openalex', 'deep learning'));
  assert.notEqual(cacheKey('openalex', 'a'), cacheKey('crossref', 'a'));
  assert.ok(cacheKey('openalex', 'x').startsWith('openalex-'));
});

test('isFresh respects TTL', () => {
  const now = 1_000_000;
  assert.equal(isFresh({ at: now - 1000 }, { now, ttlMs: DEFAULT_TTL_MS }), true);
  assert.equal(isFresh({ at: now - DEFAULT_TTL_MS - 1 }, { now, ttlMs: DEFAULT_TTL_MS }), false);
  assert.equal(isFresh(null, { now }), false);
});

test('withCache bypasses disk entirely when disabled', async () => {
  let calls = 0;
  const producer = async () => { calls++; return [1, 2, 3]; };
  const a = await withCache('x', 'q', producer, { enabled: false });
  const b = await withCache('x', 'q', producer, { enabled: false });
  assert.deepEqual(a, [1, 2, 3]);
  assert.equal(calls, 2); // no caching → producer runs each time
});
