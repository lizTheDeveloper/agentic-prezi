import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enforceProvenance, filterResolvable, independentSourceCount, groundFindings,
} from './ground.mjs';

const alwaysResolve = async () => true;
const neverResolve = async () => false;

// citations carry `sources` for the adversarial cross-check
const cites = [
  { id: 'a', title: 'A', doi: '10.1/a', sources: ['crossref'] },
  { id: 'b', title: 'B', doi: '10.1/b', sources: ['openalex'] },
  { id: 'c', title: 'C', doi: '10.1/c', sources: ['arxiv'] },
];

test('enforceProvenance strips ids not in the candidate set (⚑)', () => {
  const { findings, rejectedIds } = enforceProvenance(
    [{ claim: 'x', citations: ['a', 'ghost', 'b'] }],
    new Set(['a', 'b']),
  );
  assert.deepEqual(findings[0].citations, ['a', 'b']);
  assert.deepEqual(rejectedIds, ['ghost']);
});

test('filterResolvable drops citations that do not resolve', async () => {
  const resolver = async (c) => c.id !== 'b';
  const { resolved, dropped } = await filterResolvable(cites, resolver);
  assert.deepEqual(resolved.map((c) => c.id), ['a', 'c']);
  assert.deepEqual(dropped.map((c) => c.id), ['b']);
});

test('independentSourceCount counts distinct sources across citations', () => {
  const byId = new Map(cites.map((c) => [c.id, c]));
  assert.equal(independentSourceCount({ citations: ['a', 'b'] }, byId), 2); // crossref + openalex
  assert.equal(independentSourceCount({ citations: ['a'] }, byId), 1);
});

test('groundFindings drops a finding whose only citation is unresolvable', async () => {
  const findings = [{ claim: 'lonely', detail: 'd', importance: 3, citations: ['a'] }];
  const g = await groundFindings(findings, cites, neverResolve);
  assert.equal(g.findings.length, 0);
  assert.equal(g.dropped.findings.length, 1);
  assert.equal(g.dropped.findings[0].reason, 'no-resolvable-citation');
});

test('groundFindings rejects a model-invented citation id (⚑)', async () => {
  const findings = [{ claim: 'x', detail: 'd', importance: 3, citations: ['a', 'fabricated'] }];
  const g = await groundFindings(findings, cites, alwaysResolve);
  assert.deepEqual(g.rejectedIds, ['fabricated']);
  assert.deepEqual(g.findings[0].citations, ['a']);
});

test('groundFindings downgrades a high-importance single-source claim', async () => {
  // importance 5 but only one source ('a' → crossref) → downgraded to 3
  const findings = [{ claim: 'big', detail: 'd', importance: 5, citations: ['a'] }];
  const g = await groundFindings(findings, cites, alwaysResolve, { minSourcesForHighImportance: 2, highImportanceThreshold: 4 });
  assert.equal(g.findings[0].importance, 3);
});

test('groundFindings keeps a high-importance claim with two independent sources', async () => {
  const findings = [{ claim: 'big', detail: 'd', importance: 5, citations: ['a', 'b'] }];
  const g = await groundFindings(findings, cites, alwaysResolve);
  assert.equal(g.findings[0].importance, 5);
});

test('groundFindings only emits citations still referenced by kept findings', async () => {
  const findings = [{ claim: 'x', detail: 'd', importance: 2, citations: ['a'] }];
  const g = await groundFindings(findings, cites, alwaysResolve);
  assert.deepEqual(g.citations.map((c) => c.id), ['a']);
});
