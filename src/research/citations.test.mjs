import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDoi, normalizeTitle, citationKey, makeCitationId, dedupCandidates, toCitation,
} from './citations.mjs';

test('normalizeDoi strips url/doi prefixes and lowercases', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1/AbC'), '10.1/abc');
  assert.equal(normalizeDoi('doi:10.2/x'), '10.2/x');
  assert.equal(normalizeDoi('http://dx.doi.org/10.3/y'), '10.3/y');
  assert.equal(normalizeDoi('not-a-doi'), null);
  assert.equal(normalizeDoi(null), null);
});

test('normalizeTitle collapses punctuation and whitespace', () => {
  assert.equal(normalizeTitle('  The   Quick: Brown-Fox! '), 'the quick brown fox');
});

test('citationKey prefers DOI, falls back to title+year', () => {
  assert.equal(citationKey({ doi: '10.1/x', title: 'T', year: 2020 }), 'doi:10.1/x');
  assert.equal(citationKey({ title: 'Cats and Dogs', year: 2021 }), 'title:cats and dogs|2021');
  assert.equal(citationKey({ title: '', year: 2021 }), null);
});

test('makeCitationId mints surnameYear and de-dupes with suffixes', () => {
  const taken = new Set();
  const a = makeCitationId({ authors: ['Jane Smith'], year: 2025 }, taken); taken.add(a);
  const b = makeCitationId({ authors: ['John Smith'], year: 2025 }, taken); taken.add(b);
  assert.equal(a, 'smith2025');
  assert.equal(b, 'smith2025a');
});

test('makeCitationId handles "Family, Given" and missing data', () => {
  assert.equal(makeCitationId({ authors: ['Smith, Jane'], year: 2024 }), 'smith2024');
  assert.equal(makeCitationId({ authors: [], year: null }), 'anonnd');
});

test('dedupCandidates merges by DOI and unions sources', () => {
  const merged = dedupCandidates([
    { title: 'Paper A', doi: '10.1/x', authors: ['A'], year: 2024, source: 'openalex', citedByCount: 5 },
    { title: 'paper a', doi: 'https://doi.org/10.1/X', authors: ['A', 'B'], year: 2024, source: 'crossref', citedByCount: 9 },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources.sort(), ['crossref', 'openalex']);
  assert.equal(merged[0].citedByCount, 9);       // max
  assert.deepEqual(merged[0].authors, ['A', 'B']); // richer author list
});

test('dedupCandidates merges by normalized title+year when no DOI', () => {
  const merged = dedupCandidates([
    { title: 'Deep Learning Survey', year: 2023, source: 'arxiv' },
    { title: 'deep   learning survey', year: 2023, source: 'openalex' },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources.sort(), ['arxiv', 'openalex']);
});

test('dedupCandidates keeps keyless candidates separately', () => {
  const merged = dedupCandidates([{ title: '', year: null, source: 'web' }]);
  assert.equal(merged.length, 1);
});

test('toCitation projects to contract shape with normalized DOI', () => {
  const c = toCitation({ title: 'T', authors: ['A'], year: 2022, venue: 'V', doi: 'https://doi.org/10.1/Z', url: 'u' }, 'id1');
  assert.deepEqual(c, { id: 'id1', title: 'T', authors: ['A'], year: 2022, venue: 'V', doi: '10.1/z', url: 'u' });
});
