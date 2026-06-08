import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateIr } from './ir-schema.mjs';

// A minimal valid IR: two top-level scenes + one nested detail, a tour, a citation.
function validIr() {
  return {
    canvas: { width: 1000, height: 1000 },
    scenes: [
      { id: 'a', parent: null, bbox: { x: 0, y: 0, w: 400, h: 400 }, intent: 'hook', blocks: [{ type: 'heading', text: 'Title' }] },
      { id: 'b', parent: null, bbox: { x: 500, y: 0, w: 400, h: 400 }, intent: 'finding', blocks: [{ type: 'body', text: 'x' }, { type: 'citation', refId: 'c1' }] },
      { id: 'b.d', parent: 'b', bbox: { x: 560, y: 60, w: 200, h: 200 }, intent: 'detail', blocks: [{ type: 'body', text: 'deep' }] },
    ],
    tour: [{ scene: 'a', transition: 'zoom' }, { scene: 'b', transition: 'pan' }, { scene: 'b.d', transition: 'zoom' }],
    citations: [{ id: 'c1', title: 'Paper', authors: ['A'], year: 2025 }],
  };
}

test('a well-formed IR validates', () => {
  assert.deepEqual(validateIr(validIr()), { valid: true, errors: [] });
});

test('overlapping sibling scenes are rejected', () => {
  const ir = validIr();
  ir.scenes[1].bbox = { x: 100, y: 100, w: 400, h: 400 }; // now overlaps scene "a"
  const { valid, errors } = validateIr(ir);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /overlap/.test(e)), errors.join('; '));
});

test('a child whose bbox escapes its parent is rejected', () => {
  const ir = validIr();
  ir.scenes[2].bbox = { x: 0, y: 0, w: 200, h: 200 }; // outside parent "b"
  const { valid, errors } = validateIr(ir);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /contained within parent/.test(e)), errors.join('; '));
});

test('over-nesting beyond the depth cap is rejected', () => {
  const ir = validIr();
  // Build a chain a→b→c→d→e (depth 4 > default cap 3), all nested + contained.
  ir.canvas = { width: 1000, height: 1000 };
  ir.scenes = [
    { id: 'a', parent: null, bbox: { x: 0, y: 0, w: 1000, h: 1000 }, intent: 'i', blocks: [{ type: 'body', text: 'x' }] },
    { id: 'b', parent: 'a', bbox: { x: 50, y: 50, w: 800, h: 800 }, intent: 'i', blocks: [{ type: 'body', text: 'x' }] },
    { id: 'c', parent: 'b', bbox: { x: 100, y: 100, w: 600, h: 600 }, intent: 'i', blocks: [{ type: 'body', text: 'x' }] },
    { id: 'd', parent: 'c', bbox: { x: 150, y: 150, w: 400, h: 400 }, intent: 'i', blocks: [{ type: 'body', text: 'x' }] },
    { id: 'e', parent: 'd', bbox: { x: 200, y: 200, w: 200, h: 200 }, intent: 'i', blocks: [{ type: 'body', text: 'x' }] },
  ];
  ir.tour = [{ scene: 'a' }];
  const { valid, errors } = validateIr(ir);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /nesting depth/.test(e)), errors.join('; '));
});

test('a citation block referencing an unknown id is rejected', () => {
  const ir = validIr();
  ir.scenes[1].blocks[1].refId = 'nope';
  const { valid, errors } = validateIr(ir);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /not present in citations/.test(e)), errors.join('; '));
});

test('a tour stop pointing at a non-existent scene is rejected', () => {
  const ir = validIr();
  ir.tour.push({ scene: 'ghost' });
  const { valid, errors } = validateIr(ir);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /is not a scene/.test(e)), errors.join('; '));
});

test('a parent cycle is rejected (no infinite recursion)', () => {
  const ir = validIr();
  ir.scenes = [
    { id: 'x', parent: 'y', bbox: { x: 0, y: 0, w: 100, h: 100 }, intent: 'i', blocks: [{ type: 'body', text: 'x' }] },
    { id: 'y', parent: 'x', bbox: { x: 0, y: 0, w: 100, h: 100 }, intent: 'i', blocks: [{ type: 'body', text: 'x' }] },
  ];
  ir.tour = [{ scene: 'x' }];
  const { valid, errors } = validateIr(ir);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /cycle/.test(e)), errors.join('; '));
});
