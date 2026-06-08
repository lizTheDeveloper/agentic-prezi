import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCritique, geometricCritique, refineLoop, hasHighSeverity } from './critique.mjs';
import { compileSvg } from './svg.mjs';
import { compose, deterministicRevise } from './compose.mjs';
import { sampleResearch } from './_fixtures.mjs';

test('validateCritique enforces the §5.1 structured-output schema', () => {
  assert.deepEqual(validateCritique({ stop: 'a', issues: [], matches_intent: true }), []);
  const errs = validateCritique({ stop: '', issues: [{ kind: 'bogus', severity: 'huge' }], matches_intent: 'yes' });
  assert.ok(errs.some((e) => /stop/.test(e)));
  assert.ok(errs.some((e) => /kind/.test(e)));
  assert.ok(errs.some((e) => /severity/.test(e)));
  assert.ok(errs.some((e) => /matches_intent/.test(e)));
});

// A deliberately-clipped fixture: a short heading fits, but a huge body block overflows the box —
// so the geometric critic flags it and the deterministic reviser CAN converge by shrinking the body.
function clippedIr() {
  return {
    canvas: { width: 1200, height: 1200 },
    scenes: [{
      id: 'cramped', parent: null, bbox: { x: 0, y: 0, w: 700, h: 520 }, intent: 'too much text',
      blocks: [{ type: 'heading', text: 'Title' }, { type: 'body', text: 'lorem ipsum '.repeat(200) }],
    }],
    tour: [{ scene: 'cramped' }],
    citations: [],
  };
}

test('geometricCritique yields a HIGH clipping issue for an overflowing scene', () => {
  const ir = clippedIr();
  const { layout } = compileSvg(ir);
  const critiques = geometricCritique(layout, ir);
  for (const c of critiques) assert.deepEqual(validateCritique(c), [], 'critique conforms to schema');
  assert.ok(hasHighSeverity(critiques), 'has a high-severity issue');
  assert.ok(critiques[0].issues.some((i) => i.kind === 'clipping' && i.severity === 'high'));
});

test('a well-composed deck has no high-severity geometric issues', () => {
  const { ir } = compose(sampleResearch(), { title: 'T' });
  const { layout } = compileSvg(ir);
  assert.equal(hasHighSeverity(geometricCritique(layout, ir)), false);
});

test('refineLoop terminates within N and converges by shrinking overflowing text', async () => {
  const ir = clippedIr();
  const result = await refineLoop(ir, {
    render: (doc) => ({ ...compileSvg(doc), ir: doc }),
    critic: (rr, doc) => geometricCritique(rr.layout, doc),
    revise: deterministicRevise,
    maxIterations: 6,
  });
  assert.ok(result.iterations <= 6, 'bounded by N');
  assert.equal(result.converged, true, 'converged after shrinking');
  assert.equal(hasHighSeverity(result.critiques), false);
});

test('non-convergence is reported, never hangs (reviser that cannot fix anything)', async () => {
  const ir = clippedIr();
  const result = await refineLoop(ir, {
    render: (doc) => ({ ...compileSvg(doc), ir: doc }),
    critic: (rr, doc) => geometricCritique(rr.layout, doc),
    revise: (doc) => doc, // no-op reviser → cannot converge
    maxIterations: 4,
  });
  assert.equal(result.converged, false);
  assert.ok(result.residualIssues.length > 0, 'residual issues recorded');
});

test('the loop is bounded even if the reviser keeps changing without fixing', async () => {
  const ir = clippedIr();
  let n = 0;
  const result = await refineLoop(ir, {
    render: (doc) => ({ ...compileSvg(doc), ir: doc }),
    critic: (rr, doc) => geometricCritique(rr.layout, doc),
    revise: (doc) => ({ ...doc, _churn: n++ }), // always "changes" but never fixes overflow
    maxIterations: 3,
  });
  assert.equal(result.iterations, 3, 'stops exactly at the cap');
  assert.equal(result.converged, false);
});
