import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, refineNarrative } from './compose.mjs';
import { validateIr } from './ir-schema.mjs';
import { sampleResearch } from './_fixtures.mjs';

test('refineNarrative with no llm returns the IR unchanged', async () => {
  const { ir } = compose(sampleResearch(), { title: 'T' });
  assert.equal(await refineNarrative(ir, {}), ir);
});

test('refineNarrative rewrites wording but keeps structure, layout, citations, and validity', async () => {
  const { ir } = compose(sampleResearch(), { title: 'T' });
  const intro = ir.scenes.find((s) => s.id === 'intro');
  const llm = {
    json: async () => ({
      scenes: [{ id: 'intro', heading: 'A Sharper Hook', body: 'Tighter intro copy.', intent: 'New intent' }],
    }),
  };
  const refined = await refineNarrative(ir, { llm });
  assert.deepEqual(validateIr(refined), { valid: true, errors: [] });
  // Same scenes, same layout (bboxes), same tour, same citations — only text changed.
  assert.equal(refined.scenes.length, ir.scenes.length);
  assert.deepEqual(refined.tour, ir.tour);
  assert.deepEqual(refined.citations, ir.citations);
  const r = refined.scenes.find((s) => s.id === 'intro');
  assert.deepEqual(r.bbox, intro.bbox);
  assert.equal(r.blocks.find((b) => b.type === 'heading').text, 'A Sharper Hook');
  assert.equal(r.blocks.find((b) => b.type === 'body').text, 'Tighter intro copy.');
  assert.equal(r.intent, 'New intent');
});

test('refineNarrative truncates over-long refined text to the caps (no reintroduced overflow)', async () => {
  const { ir } = compose(sampleResearch(), { title: 'T' });
  const llm = { json: async () => ({ scenes: [{ id: 'intro', heading: 'X'.repeat(500) }] }) };
  const refined = await refineNarrative(ir, { llm, headingMax: 120 });
  const heading = refined.scenes.find((s) => s.id === 'intro').blocks.find((b) => b.type === 'heading').text;
  assert.ok(heading.length <= 120, `heading length ${heading.length} <= 120`);
});

test('refineNarrative is fail-open: an llm error keeps the deterministic IR', async () => {
  const { ir } = compose(sampleResearch(), { title: 'T' });
  const llm = { json: async () => { throw new Error('provider down'); } };
  assert.equal(await refineNarrative(ir, { llm }), ir);
});

test('refineNarrative ignores ids it was not given and malformed replies', async () => {
  const { ir } = compose(sampleResearch(), { title: 'T' });
  assert.equal(await refineNarrative(ir, { llm: { json: async () => ({}) } }), ir);
  // unknown id → no change applied; original returned structurally intact
  const refined = await refineNarrative(ir, { llm: { json: async () => ({ scenes: [{ id: 'ghost', heading: 'no' }] }) } });
  assert.deepEqual(validateIr(refined), { valid: true, errors: [] });
  assert.equal(refined.scenes.find((s) => s.id === 'intro').blocks.find((b) => b.type === 'heading').text,
    ir.scenes.find((s) => s.id === 'intro').blocks.find((b) => b.type === 'heading').text);
});
