import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makePreziGenerator } from './generate.mjs';
import { sampleResearch } from './_fixtures.mjs';

test('makePreziGenerator (#2→#3→#1 seam): an injected research doc produces the full artifact set', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'seam-'));
  const outDir = join(dir, 'out');
  try {
    const gen = makePreziGenerator({ research: sampleResearch(), maxIterations: 1 });
    const manifest = await gen({ id: 7, title: 'Superconductivity', slug: 'sc', sourceWriteup: 'a write-up' }, outDir);

    assert.equal(manifest.generator, 'prezi@1');
    assert.equal(manifest.presentationId, 7);
    assert.equal(manifest.entry, 'index.html');
    for (const f of ['index.html', 'presentation.svg', 'camera.json', 'player.js', 'manifest.json']) {
      assert.ok(manifest.artifacts.includes(f), `manifest lists ${f}`);
    }
    // The artifacts are actually on disk and reference the research's citations.
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    assert.match(html, /Content-Security-Policy/);
    assert.ok(manifest.citations.some((c) => c.id === 'lee2025'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('makePreziGenerator threads an llm into Compose refinement (research short-circuited)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'seam-'));
  const outDir = join(dir, 'out');
  try {
    let called = false;
    const llm = { json: async () => { called = true; return { scenes: [{ id: 'intro', heading: 'Refined Hook' }] }; } };
    const gen = makePreziGenerator({ research: sampleResearch(), llm, maxIterations: 1 });
    await gen({ id: 1, title: 'T', slug: 't', sourceWriteup: 'w' }, outDir);
    assert.equal(called, true, 'compose refinement called the injected llm');
    const svg = await readFile(join(outDir, 'presentation.svg'), 'utf8');
    assert.match(svg, /Refined Hook/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
