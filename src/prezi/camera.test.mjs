import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitViewBox, compileCamera } from './camera.mjs';
import { compose } from './compose.mjs';
import { sampleResearch } from './_fixtures.mjs';

test('fitViewBox letterboxes a bbox to the target aspect and contains it', () => {
  const bbox = { x: 100, y: 100, w: 400, h: 100 }; // wide
  const vb = fitViewBox(bbox, 1, 0); // square target, no padding
  assert.ok(Math.abs(vb.w / vb.h - 1) < 1e-9, 'result has the target aspect');
  // Contains the original bbox (never crops).
  assert.ok(vb.x <= bbox.x && vb.y <= bbox.y);
  assert.ok(vb.x + vb.w >= bbox.x + bbox.w && vb.y + vb.h >= bbox.y + bbox.h);
  // Centred on the bbox centre.
  assert.ok(Math.abs((vb.x + vb.w / 2) - (bbox.x + bbox.w / 2)) < 1e-6);
});

test('compileCamera produces one stop per tour entry, in order, with viewBoxes', () => {
  const { ir } = compose(sampleResearch(), { title: 'T' });
  const cam = compileCamera(ir);
  assert.equal(cam.stops.length, ir.tour.length);
  cam.stops.forEach((s, i) => {
    assert.equal(s.scene, ir.tour[i].scene);
    for (const k of ['x', 'y', 'w', 'h']) assert.equal(typeof s.viewBox[k], 'number');
  });
});

test('stop ids are unique so deep links (#id) are unambiguous', () => {
  const ir = {
    canvas: { width: 1000, height: 1000 },
    scenes: [{ id: 'a', parent: null, bbox: { x: 0, y: 0, w: 500, h: 500 }, intent: 'i', blocks: [{ type: 'body', text: 'x' }] }],
    tour: [{ scene: 'a' }, { scene: 'a' }, { scene: 'a' }], // same scene visited 3×
    citations: [],
  };
  const cam = compileCamera(ir);
  const ids = cam.stops.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'all stop ids unique');
});
