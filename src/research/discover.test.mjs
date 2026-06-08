import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discover } from './discover.mjs';

const cacheOff = { cache: { enabled: false } };

function stubAdapter(name, byQuery) {
  return { name, search: async (q) => byQuery[q] ?? [] };
}

test('discover fans out across adapters and dedups by DOI', async () => {
  const a = stubAdapter('openalex', { q1: [{ title: 'Shared', doi: '10.1/x', source: 'openalex' }] });
  const b = stubAdapter('crossref', { q1: [{ title: 'shared', doi: 'https://doi.org/10.1/X', source: 'crossref' }] });
  const { candidates, errors } = await discover(['q1'], [a, b], cacheOff);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].sources.sort(), ['crossref', 'openalex']);
  assert.deepEqual(errors, []);
});

test('discover collects per-adapter errors without failing the run', async () => {
  const good = stubAdapter('openalex', { q1: [{ title: 'A', doi: '10.1/a', source: 'openalex' }] });
  const bad = { name: 'crossref', search: async () => { throw new Error('429 rate limited'); } };
  const { candidates, errors } = await discover(['q1'], [good, bad], cacheOff);
  assert.equal(candidates.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].adapter, 'crossref');
});

test('discover unions sources for a work surfaced across multiple sub-queries', async () => {
  const a = stubAdapter('openalex', {
    q1: [{ title: 'Work', doi: '10.1/w', source: 'openalex' }],
    q2: [{ title: 'Work', doi: '10.1/w', source: 'openalex' }],
  });
  const { candidates } = await discover(['q1', 'q2'], [a], cacheOff);
  assert.equal(candidates.length, 1); // deduped, not double-counted
});
