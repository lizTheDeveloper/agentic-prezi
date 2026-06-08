import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSvg } from './svg.mjs';
import { compose } from './compose.mjs';
import { sampleResearch } from './_fixtures.mjs';

test('untrusted research text is escaped, never injected, into the SVG', () => {
  const doc = sampleResearch();
  doc.findings[0].claim = 'Inject <script>alert(1)</script> & "quotes"';
  const { ir } = compose(doc, { title: 'T' });
  const { svg } = compileSvg(ir);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /&amp;/);
});

test('emits one <g> group per scene with a data-bbox the player can read', () => {
  const { ir } = compose(sampleResearch(), { title: 'T' });
  const { svg } = compileSvg(ir);
  const groups = svg.match(/<g data-scene=/g) || [];
  assert.equal(groups.length, ir.scenes.length);
  assert.match(svg, /data-bbox="\d+,\d+,\d+,\d+"/);
});

test('the root viewBox spans the whole canvas and uses no CSP-blocked styling', () => {
  const { ir } = compose(sampleResearch(), { title: 'T' });
  const { svg } = compileSvg(ir);
  assert.match(svg, new RegExp(`viewBox="0 0 ${ir.canvas.width} ${ir.canvas.height}"`));
  // style-src 'self' blocks inline <style> and style="" — the compiler must use only attributes.
  assert.doesNotMatch(svg, /<style[\s>]/);
  assert.doesNotMatch(svg, /\sstyle="/);
});

test('the layout report flags overflow when text cannot fit its box', () => {
  const ir = {
    canvas: { width: 1000, height: 1000 },
    scenes: [{
      id: 'tiny', parent: null, bbox: { x: 0, y: 0, w: 240, h: 120 }, intent: 'cramped',
      blocks: [{ type: 'body', text: 'word '.repeat(400) }],
    }],
    tour: [{ scene: 'tiny' }],
    citations: [],
  };
  const { layout } = compileSvg(ir);
  assert.equal(layout.scenes[0].overflow, true);
});
