import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareCitations, toContractCitation, deterministicFindings, synthesizeFindings,
} from './synthesize.mjs';

const ranked = [
  { title: 'Paper One', authors: ['Jane Smith'], year: 2025, venue: 'Nature', doi: '10.1/a', url: 'u1', abstract: 'Abstract one.', sources: ['crossref'] },
  { title: 'Paper Two', authors: ['John Doe'], year: 2024, venue: 'Science', doi: '10.1/b', url: 'u2', abstract: 'Abstract two.', sources: ['openalex'] },
];

test('prepareCitations assigns stable ids and retains sources/abstract', () => {
  const { citations, byId } = prepareCitations(ranked);
  assert.equal(citations[0].id, 'smith2025');
  assert.equal(citations[1].id, 'doe2024');
  assert.deepEqual(byId.get('smith2025').sources, ['crossref']);
  assert.equal(byId.get('smith2025').abstract, 'Abstract one.');
});

test('prepareCitations drops candidates without a usable title', () => {
  const { citations } = prepareCitations([
    { title: 'Good Paper', authors: ['A'], year: 2025, doi: '10.1/g' },
    { title: '', authors: ['B'], year: 2024, doi: '10.1/empty' },
    { title: '   ', authors: ['C'], year: 2023 },
    { authors: ['D'], year: 2022 },
  ]);
  assert.equal(citations.length, 1);
  assert.equal(citations[0].title, 'Good Paper');
});

test('toContractCitation drops internal fields', () => {
  const { citations } = prepareCitations(ranked);
  const c = toContractCitation(citations[0]);
  assert.deepEqual(Object.keys(c).sort(), ['authors', 'doi', 'id', 'title', 'url', 'venue', 'year'].sort());
  assert.equal(c.sources, undefined);
  assert.equal(c.abstract, undefined);
});

test('deterministicFindings produces one cited finding per candidate', () => {
  const { citations } = prepareCitations(ranked);
  const findings = deterministicFindings(citations);
  assert.equal(findings.length, 2);
  assert.deepEqual(findings[0].citations, ['smith2025']);
  assert.ok(findings[0].importance >= 1 && findings[0].importance <= 5);
  // every cited id exists in the citation set (grounding precondition)
  const ids = new Set(citations.map((c) => c.id));
  for (const f of findings) for (const id of f.citations) assert.ok(ids.has(id));
});

test('synthesizeFindings falls back to deterministic without an llm', async () => {
  const { citations } = prepareCitations(ranked);
  const findings = await synthesizeFindings({ topic: 'T', citations });
  assert.equal(findings.length, 2);
});

test('synthesizeFindings coerces and clamps llm output', async () => {
  const { citations } = prepareCitations(ranked);
  const llm = { json: async () => ({ findings: [
    { claim: 'C', detail: 'D', importance: 99, citations: ['smith2025', 7] }, // importance clamped, non-string id dropped
    { claim: 'bad' }, // missing citations array → filtered out
  ] }) };
  const findings = await synthesizeFindings({ topic: 'T', citations, llm });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].importance, 5);
  assert.deepEqual(findings[0].citations, ['smith2025']);
});

test('synthesizeFindings recovers from a throwing llm', async () => {
  const { citations } = prepareCitations(ranked);
  const llm = { json: async () => { throw new Error('boom'); } };
  const findings = await synthesizeFindings({ topic: 'T', citations, llm });
  assert.equal(findings.length, 2); // deterministic fallback
});
