import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkShapeSvg, isSafeShapeSvg } from './shape-guard.mjs';
import { validateIr } from './ir-schema.mjs';
import { compileSvg } from './svg.mjs';

test('accepts inert vector geometry', () => {
  assert.equal(isSafeShapeSvg('<path d="M0 0 L10 10 Z" fill="#fff" stroke="#000" stroke-width="2"/>'), true);
  assert.equal(isSafeShapeSvg('<rect x="0" y="0" width="10" height="10" rx="2" fill-opacity="0.5"/>'), true);
  assert.equal(isSafeShapeSvg('<g transform="translate(5,5)"><circle cx="0" cy="0" r="4"/></g>'), true);
  assert.equal(isSafeShapeSvg('<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient></defs><rect width="5" height="5" fill="url(#g)"/>'), true);
});

test('rejects script and event handlers', () => {
  assert.equal(checkShapeSvg('<script>alert(1)</script>').safe, false);
  assert.equal(checkShapeSvg('<rect width="1" height="1" onload="alert(1)"/>').safe, false);
  assert.equal(checkShapeSvg('<rect width="1" height="1" onclick="x()"/>').safe, false);
});

test('rejects foreignObject, image, use, and anchors (external/active content)', () => {
  for (const frag of [
    '<foreignObject><body>hi</body></foreignObject>',
    '<image href="https://evil.test/x.png"/>',
    '<use href="#x"/>',
    '<a href="https://evil.test"><rect width="1" height="1"/></a>',
  ]) {
    assert.equal(checkShapeSvg(frag).safe, false, frag);
  }
});

test('rejects external/javascript/data references and url() that is not a fragment ref', () => {
  assert.equal(checkShapeSvg('<rect width="1" height="1" fill="url(https://evil.test/x)"/>').safe, false);
  assert.equal(checkShapeSvg('<rect width="1" height="1" clip-path="url(http://evil/x)"/>').safe, false);
  assert.equal(checkShapeSvg('<rect width="1" height="1" fill="url(#ok)"/>').safe, true);
});

test('rejects comments, CDATA, and disguised/malformed tags', () => {
  assert.equal(checkShapeSvg('<!-- comment --><rect width="1" height="1"/>').safe, false);
  assert.equal(checkShapeSvg('<![CDATA[<script>x</script>]]>').safe, false);
  assert.equal(checkShapeSvg('< script>alert(1)</script>').safe, false); // stray < survives tag strip
});

test('rejects unknown attributes', () => {
  assert.equal(checkShapeSvg('<rect width="1" height="1" style="fill:url(javascript:x)"/>').safe, false);
});

test('validateIr rejects an IR whose shape block is unsafe', () => {
  const ir = {
    canvas: { width: 1000, height: 1000 },
    citations: [],
    scenes: [{
      id: 's1', parent: null, intent: 'x', bbox: { x: 0, y: 0, w: 500, h: 500 },
      blocks: [{ type: 'shape', svg: '<rect width="1" height="1" onload="x()"/>' }],
    }],
    tour: [{ scene: 's1', transition: 'zoom' }],
  };
  const { valid, errors } = validateIr(ir);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /unsafe shape rejected/.test(e)), errors.join('; '));
});

test('validateIr accepts an IR with a safe shape block', () => {
  const ir = {
    canvas: { width: 1000, height: 1000 },
    citations: [],
    scenes: [{
      id: 's1', parent: null, intent: 'x', bbox: { x: 0, y: 0, w: 500, h: 500 },
      blocks: [{ type: 'shape', svg: '<circle cx="10" cy="10" r="5" fill="#fff"/>' }],
    }],
    tour: [{ scene: 's1', transition: 'zoom' }],
  };
  assert.equal(validateIr(ir).valid, true);
});

test('compileSvg emits safe shapes and drops unsafe ones (defense-in-depth)', () => {
  const mk = (svg) => ({
    canvas: { width: 1000, height: 1000 },
    citations: [],
    scenes: [{ id: 's1', parent: null, intent: 'x', bbox: { x: 0, y: 0, w: 800, h: 800 }, blocks: [{ type: 'shape', svg }] }],
    tour: [{ scene: 's1', transition: 'zoom' }],
  });
  const safe = compileSvg(mk('<circle cx="10" cy="10" r="5"/>'));
  assert.match(safe.svg, /<circle cx="10"/);
  assert.ok(safe.layout.byId.get('s1').items.some((it) => it.kind === 'shape' && !it.dropped));

  const unsafe = compileSvg(mk('<rect width="1" height="1" onclick="x()"/>'));
  assert.doesNotMatch(unsafe.svg, /onclick/);
  assert.ok(unsafe.layout.byId.get('s1').items.some((it) => it.kind === 'shape' && it.dropped));
});
