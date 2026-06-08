import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, lerp, easeInOutCubic, lerpViewBox, viewBoxToString,
  fitToViewport, nextIndex, prevIndex, resolveStopIndex, stopAtPoint,
} from './camera-math.mjs';

test('lerp / clamp basics', () => {
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
});

test('easeInOutCubic maps endpoints and is monotonic over [0,1]', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  let prev = -1;
  for (let t = 0; t <= 1.0001; t += 0.1) {
    const v = easeInOutCubic(t);
    assert.ok(v >= prev - 1e-9, `monotonic at ${t}`);
    prev = v;
  }
});

test('lerpViewBox hits both endpoints', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  const b = { x: 200, y: 50, w: 400, h: 300 };
  assert.deepEqual(lerpViewBox(a, b, 0), a);
  assert.deepEqual(lerpViewBox(a, b, 1), b);
  assert.equal(viewBoxToString(a), '0 0 100 100');
});

test('fitToViewport widens a viewBox for a wider viewport, keeping the centre', () => {
  const vb = { x: 0, y: 0, w: 100, h: 100 }; // aspect 1
  const fit = fitToViewport(vb, 2); // viewport twice as wide
  assert.ok(Math.abs(fit.w / fit.h - 2) < 1e-9);
  assert.equal(fit.x + fit.w / 2, 50, 'centre x preserved');
  assert.equal(fit.h, 100, 'height unchanged when widening');
});

test('nav indices clamp at both ends (no wrap)', () => {
  assert.equal(nextIndex(0, 3), 1);
  assert.equal(nextIndex(2, 3), 2);
  assert.equal(prevIndex(0, 3), 0);
  assert.equal(prevIndex(2, 3), 1);
});

test('resolveStopIndex finds a stop by hash, -1 when absent', () => {
  const stops = [{ id: 'intro' }, { id: 'f1' }, { id: 'f1~2' }];
  assert.equal(resolveStopIndex(stops, '#f1'), 1);
  assert.equal(resolveStopIndex(stops, 'f1~2'), 2);
  assert.equal(resolveStopIndex(stops, '#nope'), -1);
  assert.equal(resolveStopIndex(stops, ''), -1);
});

test('stopAtPoint picks the deepest (smallest) scene under the point', () => {
  const stops = [{ scene: 'big' }, { scene: 'small' }];
  const bboxes = { big: { x: 0, y: 0, w: 1000, h: 1000 }, small: { x: 100, y: 100, w: 100, h: 100 } };
  assert.equal(stopAtPoint(stops, bboxes, 150, 150), 1, 'inside small → small');
  assert.equal(stopAtPoint(stops, bboxes, 500, 500), 0, 'only inside big → big');
  assert.equal(stopAtPoint(stops, bboxes, 2000, 2000), -1, 'outside all → -1');
});
