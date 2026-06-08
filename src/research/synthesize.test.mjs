import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareCitations, toContractCitation, synthesizeFindings, sanitizeFigure,
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

test('synthesizeFindings throws without an llm (no fallback)', async () => {
  const { citations } = prepareCitations(ranked);
  await assert.rejects(() => synthesizeFindings({ topic: 'T', citations }), /llm is required/);
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

test('sanitizeFigure keeps a valid figure and drops malformed ones', () => {
  assert.deepEqual(sanitizeFigure({ caption: 'A chart', data_or_quote: '42%' }), { caption: 'A chart', data_or_quote: '42%' });
  assert.deepEqual(sanitizeFigure({ caption: 'only caption' }), { caption: 'only caption' });
  assert.equal(sanitizeFigure({}), null);
  assert.equal(sanitizeFigure([]), null);
  assert.equal(sanitizeFigure({ caption: 123 }), null);
  assert.equal(sanitizeFigure(null), null);
});

test('synthesizeFindings drops a malformed figure but keeps the finding (graceful, §7/§8)', async () => {
  const { citations } = prepareCitations(ranked);
  const llm = { json: async () => ({ findings: [
    { claim: 'C', detail: 'D', importance: 3, citations: ['smith2025'], figure: {} },        // bad → dropped
    { claim: 'E', detail: 'F', importance: 2, citations: ['doe2024'], figure: { caption: 'ok' } }, // good → kept
  ] }) };
  const findings = await synthesizeFindings({ topic: 'T', citations, llm });
  assert.equal(findings.length, 2);
  assert.equal(findings[0].figure, undefined);
  assert.deepEqual(findings[1].figure, { caption: 'ok' });
});

test('synthesizeFindings propagates a throwing llm (no fallback)', async () => {
  const { citations } = prepareCitations(ranked);
  const llm = { json: async () => { throw new Error('boom'); } };
  await assert.rejects(() => synthesizeFindings({ topic: 'T', citations, llm }), /boom/);
});
