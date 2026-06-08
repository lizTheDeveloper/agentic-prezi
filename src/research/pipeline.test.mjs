import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runResearch } from './pipeline.mjs';
import { validateFindingsDoc } from './schema.mjs';

// Fixture adapters — return a small, deterministic corpus (no network).
function corpusAdapter(name, works) {
  return { name, search: async () => works.map((w) => ({ ...w, source: name })) };
}

const NOW_YEAR = 2026;
const cacheOff = { enabled: false };

const richCorpus = [
  { title: 'CRISPR Therapy for Sickle Cell', authors: ['Jane Smith'], year: 2025, venue: 'Nature', doi: '10.1/scd', url: 'https://doi.org/10.1/scd', abstract: 'A trial of CRISPR for sickle cell disease.', citedByCount: 120 },
  { title: 'Base Editing Advances', authors: ['John Doe'], year: 2024, venue: 'Cell', doi: '10.1/be', url: 'https://doi.org/10.1/be', abstract: 'Base editing improves precision.', citedByCount: 80 },
  { title: 'Off-target Effects Review', authors: ['Mei Chen'], year: 2026, venue: 'Science', doi: '10.1/off', url: 'https://doi.org/10.1/off', abstract: 'Reviewing off-target safety concerns.', citedByCount: 30 },
  { title: 'Delivery Vectors for Gene Editing', authors: ['Omar Farouk'], year: 2025, venue: 'NBT', doi: '10.1/dv', url: 'https://doi.org/10.1/dv', abstract: 'AAV and LNP delivery.', citedByCount: 45 },
];

test('end-to-end: produces a valid, fully-grounded findings doc', async () => {
  const adapters = [corpusAdapter('openalex', richCorpus), corpusAdapter('crossref', richCorpus)];
  const { doc, validation, trace } = await runResearch(
    'CRISPR gene editing therapies for sickle cell disease and their safety.',
    { adapters, resolver: async () => true, cache: cacheOff, nowYear: NOW_YEAR },
  );
  assert.equal(validation.valid, true, validation.errors.join('; '));
  assert.ok(!doc.insufficient_sources);
  assert.ok(doc.findings.length >= 3);
  // every cited id resolves to a citation in the table (⚑)
  const ids = new Set(doc.citations.map((c) => c.id));
  for (const f of doc.findings) for (const id of f.citations) assert.ok(ids.has(id));
  // importance is sorted descending
  for (let i = 1; i < doc.findings.length; i++) {
    assert.ok(doc.findings[i - 1].importance >= doc.findings[i].importance);
  }
  assert.ok(trace.stages.verify.keptFindings >= 3);
});

test('end-to-end: unresolvable sources → clean insufficient_sources doc', async () => {
  const adapters = [corpusAdapter('openalex', richCorpus)];
  const { doc, validation } = await runResearch(
    'CRISPR safety.',
    { adapters, resolver: async () => false, cache: cacheOff, nowYear: NOW_YEAR }, // nothing resolves
  );
  assert.equal(validation.valid, true, validation.errors.join('; '));
  assert.equal(doc.insufficient_sources, true);
  assert.equal(doc.findings.length, 0);
  assert.equal(doc.citations.length, 0);
  assert.ok(doc.topic);
});

test('end-to-end: empty corpus still yields a valid (insufficient) doc', async () => {
  const { doc, validation } = await runResearch('obscure topic', {
    adapters: [corpusAdapter('openalex', [])],
    resolver: async () => true,
    cache: cacheOff,
    nowYear: NOW_YEAR,
  });
  assert.equal(validation.valid, true, validation.errors.join('; '));
  assert.equal(doc.insufficient_sources, true);
});

test('end-to-end: an llm that fabricates a citation id cannot poison the doc (⚑)', async () => {
  const adapters = [corpusAdapter('openalex', richCorpus), corpusAdapter('crossref', richCorpus)];
  const llm = {
    json: async ({ system }) => {
      // scope call has no "synthesis" system text → return scope shape
      if (/scoping/i.test(system)) return { topic: 'CRISPR', sub_queries: ['crispr therapy'], narrative_outline: ['a', 'b'] };
      // synthesis: cite a mix of real and fabricated ids
      return { findings: [
        { claim: 'Real claim', detail: 'd', importance: 5, citations: ['smith2025', 'FABRICATED-1'] },
        { claim: 'All fake', detail: 'd', importance: 4, citations: ['GHOST-2'] },
      ] };
    },
  };
  const { doc, validation, trace } = await runResearch('CRISPR', {
    adapters, llm, resolver: async () => true, cache: cacheOff, nowYear: NOW_YEAR,
  });
  assert.equal(validation.valid, true, validation.errors.join('; '));
  // fabricated ids rejected; the all-fake finding dropped entirely
  assert.ok(trace.stages.verify.rejectedCitationIds.includes('FABRICATED-1'));
  assert.ok(trace.stages.verify.rejectedCitationIds.includes('GHOST-2'));
  const ids = new Set(doc.citations.map((c) => c.id));
  for (const f of doc.findings) for (const id of f.citations) assert.ok(ids.has(id));
  assert.ok(!doc.findings.some((f) => f.claim === 'All fake'));
});

test('runResearch output always satisfies the contract validator', async () => {
  const adapters = [corpusAdapter('openalex', richCorpus)];
  const { doc } = await runResearch('CRISPR delivery vectors', {
    adapters, resolver: async () => true, cache: cacheOff, nowYear: NOW_YEAR,
  });
  assert.equal(validateFindingsDoc(doc).valid, true);
});
