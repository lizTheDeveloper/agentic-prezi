import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCandidate, rankAndCap, DEFAULT_WEIGHTS } from './rank.mjs';

const NOW_YEAR = 2026;

test('recent peer-reviewed work outscores old preprint', () => {
  const recent = { title: 'recent', year: 2026, source: 'crossref', citedByCount: 0 };
  const oldPre = { title: 'old', year: 2012, source: 'arxiv', citedByCount: 0 };
  assert.ok(scoreCandidate(recent, { nowYear: NOW_YEAR }) > scoreCandidate(oldPre, { nowYear: NOW_YEAR }));
});

test('credibility: crossref > arxiv for same year', () => {
  const a = { title: 'x', year: 2025, source: 'crossref', citedByCount: 0 };
  const b = { title: 'x', year: 2025, source: 'arxiv', citedByCount: 0 };
  assert.ok(scoreCandidate(a, { nowYear: NOW_YEAR }) > scoreCandidate(b, { nowYear: NOW_YEAR }));
});

test('high citation count boosts impact score', () => {
  const lots = { title: 'x', year: 2024, source: 'openalex', citedByCount: 1000 };
  const none = { title: 'x', year: 2024, source: 'openalex', citedByCount: 0 };
  assert.ok(scoreCandidate(lots, { nowYear: NOW_YEAR }) > scoreCandidate(none, { nowYear: NOW_YEAR }));
});

test('rankAndCap sorts desc and caps to topK', () => {
  const cands = [
    { title: 'old', year: 2010, source: 'arxiv', citedByCount: 0 },
    { title: 'new', year: 2026, source: 'crossref', citedByCount: 50 },
    { title: 'mid', year: 2020, source: 'openalex', citedByCount: 5 },
  ];
  const ranked = rankAndCap(cands, { topK: 2, nowYear: NOW_YEAR });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].title, 'new');
  assert.ok(ranked[0]._score >= ranked[1]._score);
});

test('explicit preprint type overrides source credibility', () => {
  const pre = { title: 'x', year: 2025, source: 'openalex', type: 'preprint', citedByCount: 0 };
  const art = { title: 'x', year: 2025, source: 'openalex', type: 'article', citedByCount: 0 };
  assert.ok(scoreCandidate(art, { nowYear: NOW_YEAR }) > scoreCandidate(pre, { nowYear: NOW_YEAR }));
});

test('weights are tunable (open item §10.1)', () => {
  const c = { title: 'x', year: 2010, source: 'crossref', citedByCount: 0 };
  const recencyHeavy = scoreCandidate(c, { nowYear: NOW_YEAR, weights: { recency: 1, credibility: 0, impact: 0 } });
  const credHeavy = scoreCandidate(c, { nowYear: NOW_YEAR, weights: { recency: 0, credibility: 1, impact: 0 } });
  assert.ok(credHeavy > recencyHeavy); // old but credible scores higher under cred weighting
});

test('DEFAULT_WEIGHTS sum to 1', () => {
  const sum = DEFAULT_WEIGHTS.recency + DEFAULT_WEIGHTS.credibility + DEFAULT_WEIGHTS.impact;
  assert.ok(Math.abs(sum - 1) < 1e-9);
});
