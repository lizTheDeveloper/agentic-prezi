import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutScenes } from './layout.mjs';
import { rectsOverlap, rectContains } from './util.mjs';

const canvas = { width: 12000, height: 6750 };

test('packs N roots into non-overlapping bboxes within the canvas', () => {
  const roots = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, children: [] }));
  const m = layoutScenes(roots, canvas);
  const boxes = [...m.values()];
  assert.equal(boxes.length, 7);
  const canvasBox = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  for (const b of boxes) assert.ok(rectContains(canvasBox, b), `within canvas: ${JSON.stringify(b)}`);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.ok(!rectsOverlap(boxes[i], boxes[j]), `no overlap ${i},${j}`);
    }
  }
});

test('children are fully contained within their parent', () => {
  const roots = [{ id: 'p', children: [{ id: 'c1', children: [] }, { id: 'c2', children: [] }] }];
  const m = layoutScenes(roots, canvas);
  const parent = m.get('p');
  for (const cid of ['c1', 'c2']) assert.ok(rectContains(parent, m.get(cid)), `${cid} inside parent`);
  assert.ok(!rectsOverlap(m.get('c1'), m.get('c2')), 'children do not overlap');
});

test('reserved margin keeps children strictly inside the parent frame', () => {
  const roots = [{ id: 'p', children: [{ id: 'c', children: [] }] }];
  const m = layoutScenes(roots, canvas, { margin: 100 });
  const p = m.get('p');
  const c = m.get('c');
  assert.ok(c.x > p.x && c.y > p.y, 'child inset from parent top-left');
  assert.ok(c.x + c.w < p.x + p.w && c.y + c.h < p.y + p.h, 'child inset from parent bottom-right');
});
