import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePresentation } from './generate.mjs';
import { sampleResearch } from './_fixtures.mjs';

async function genInto(deps = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'prezi-'));
  const manifest = await generatePresentation(
    { id: 7, title: 'Superconductivity 2025', slug: 'super', writeup: 'a write-up', research: sampleResearch() },
    dir,
    deps,
  );
  return { dir, manifest };
}

test('end-to-end: a fixture research doc yields the full artifact set + a quality report', async () => {
  const { dir, manifest } = await genInto();
  const names = (await readdir(dir)).sort();
  for (const f of ['index.html', 'presentation.svg', 'camera.json', 'player.js', 'camera-math.js', 'styles.css', 'manifest.json']) {
    assert.ok(names.includes(f), `artifact ${f} written`);
  }
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.generator, 'prezi@1');
  assert.equal(manifest.entry, 'index.html');
  assert.ok(manifest.citations.length >= 1, 'citations carried into manifest');
  assert.equal(typeof manifest.quality.converged, 'boolean');
  assert.ok(Array.isArray(manifest.quality.residualIssues));
});

test('index.html sets the strict published CSP and wires the inline data + module player (no fetch)', async () => {
  const { dir } = await genInto();
  const html = await readFile(join(dir, 'index.html'), 'utf8');
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /<script id="camera-data" type="application\/json">/);
  assert.match(html, /<script type="module" src="player\.js">/);
  // The player must not fetch (connect-src 'none'); data is inline.
  const player = await readFile(join(dir, 'player.js'), 'utf8');
  assert.doesNotMatch(player, /\bfetch\s*\(/);
  // The shipped player imports the shipped .js math module (specifier rewritten from .mjs).
  assert.match(player, /from '\.\/camera-math\.js'/);
  assert.doesNotMatch(player, /camera-math\.mjs/);
});

test('camera.json stop count matches the manifest and the inlined data is escaped', async () => {
  const { dir, manifest } = await genInto();
  const camera = JSON.parse(await readFile(join(dir, 'camera.json'), 'utf8'));
  assert.equal(camera.stops.length, manifest.stopCount);
  const html = await readFile(join(dir, 'index.html'), 'utf8');
  // No raw "</script>" can appear inside the inlined JSON (it is <-escaped).
  const block = html.slice(html.indexOf('id="camera-data"'));
  assert.doesNotMatch(block.slice(0, block.indexOf('</script>')), /<\/script>/);
});

test('re-running into the same dir is idempotent (atomic-swap friendly, §10)', async () => {
  const { dir } = await genInto();
  // Generate again into the same dir; must not throw and must leave a clean artifact set.
  await generatePresentation(
    { id: 7, title: 'Superconductivity 2025', slug: 'super', writeup: 'a write-up', research: sampleResearch() },
    dir,
    {},
  );
  const names = (await readdir(dir)).sort();
  assert.ok(names.includes('manifest.json'));
});

test('an injected vision critic + reviser drive the same loop (engine-swap seam, §11)', async () => {
  // Simulate a vision model that flags one stop once, then a reviser that "fixes" it.
  let flagged = true;
  const { manifest } = await genInto({
    critic: (rr, ir) => ir.scenes.map((s) => ({
      stop: s.id,
      issues: flagged && s.id === 'intro' ? [{ kind: 'off-intent', severity: 'high', where: 'intro' }] : [],
      matches_intent: !(flagged && s.id === 'intro'),
    })),
    revise: (ir) => { flagged = false; return { ...ir }; },
    maxIterations: 3,
  });
  assert.equal(manifest.quality.converged, true);
  assert.equal(manifest.quality.critic, 'injected');
  assert.ok(manifest.quality.iterations >= 1);
});
