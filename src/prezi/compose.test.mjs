import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose } from './compose.mjs';
import { validateIr } from './ir-schema.mjs';
import { sampleResearch } from './_fixtures.mjs';

test('compose turns a research doc into a valid scene-graph IR', () => {
  const { ir } = compose(sampleResearch(), { title: 'Super Talk' });
  assert.deepEqual(validateIr(ir), { valid: true, errors: [] });
  assert.equal(ir.scenes[0].id, 'intro');
  assert.ok(ir.scenes.some((s) => s.id === 'closing'));
});

test('nesting is present (the Prezi signature): a finding with a figure gets a child detail scene', () => {
  const { ir } = compose(sampleResearch(), { title: 'T' });
  const nested = ir.scenes.filter((s) => s.parent !== null);
  assert.ok(nested.length >= 1, 'at least one nested detail scene');
  const detail = nested.find((s) => s.id === 'f1.detail');
  assert.ok(detail && detail.parent === 'f1', 'figure detail nests under its finding');
});

test('citations are threaded only when referenced and resolve to citations[]', () => {
  const { ir } = compose(sampleResearch(), { title: 'T' });
  const ids = new Set(ir.citations.map((c) => c.id));
  for (const s of ir.scenes) {
    for (const b of s.blocks) {
      if (b.type === 'citation') assert.ok(ids.has(b.refId), `refId ${b.refId} present in citations[]`);
    }
  }
  // Every declared citation is actually used by some scene (no dangling references).
  const used = new Set();
  for (const s of ir.scenes) for (const b of s.blocks) if (b.type === 'citation') used.add(b.refId);
  for (const id of ids) assert.ok(used.has(id), `citation ${id} is used`);
});

test('the stop count is capped (§10)', () => {
  const big = sampleResearch();
  big.findings = Array.from({ length: 50 }, (_, i) => ({ claim: `c${i}`, detail: `d${i}`, importance: 3, citations: ['lee2025'] }));
  const { ir } = compose(big, { title: 'T', maxStops: 10 });
  assert.ok(ir.scenes.filter((s) => s.parent === null).length <= 10, 'root scenes capped at maxStops');
  assert.deepEqual(validateIr(ir, { caps: { maxScenes: 100, maxDepth: 3, maxBlocksPerScene: 12 } }).valid, true);
});

test('an insufficient-sources doc still composes a valid IR (no citation blocks)', () => {
  const doc = { topic: 'Obscure topic', narrative_outline: ['intro', 'outro'], findings: [], citations: [], insufficient_sources: true };
  const { ir } = compose(doc, { title: 'Thin' });
  assert.deepEqual(validateIr(ir).valid, true);
  assert.equal(ir.citations.length, 0);
});
