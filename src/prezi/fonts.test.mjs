import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildFontFaceCss, makeFontDeps, loadFontDeps } from './fonts.mjs';
import { generatePresentation } from './generate.mjs';

test('buildFontFaceCss emits CSP-clean, same-origin @font-face rules', () => {
  const css = buildFontFaceCss([
    { family: 'Prezi Sans', file: 'prezi-sans.woff2', weight: 400 },
    { family: 'Prezi Display', file: 'prezi-display.woff2', weight: 700, style: 'normal' },
  ]);
  assert.match(css, /font-family: 'Prezi Sans'/);
  assert.match(css, /src: url\('assets\/fonts\/prezi-sans\.woff2'\) format\('woff2'\)/);
  assert.match(css, /font-weight: 700/);
  // No external origins (CSP default-src 'self').
  assert.doesNotMatch(css, /https?:\/\//);
});

test('makeFontDeps assembles the deps.fonts shape with fallback stacks', () => {
  const deps = makeFontDeps({
    faces: [{ family: 'Prezi Display', file: 'd.woff2', bytes: Buffer.from('x'), weight: 700 }],
    headingFamily: 'Prezi Display',
    bodyFamily: 'Prezi Display',
  });
  assert.equal(deps.embedded, true);
  assert.ok(deps.files['d.woff2'] instanceof Buffer);
  assert.match(deps.families.headingFamily, /^'Prezi Display', Georgia, serif$/);
  assert.match(deps.families.bodyFamily, /system-ui/);
});

test('makeFontDeps rejects an empty face set', () => {
  assert.throws(() => makeFontDeps({ faces: [] }), /at least one face/);
});

test('loadFontDeps reads files from a directory using a manifest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fonts-'));
  try {
    await writeFile(join(dir, 'sans.woff2'), Buffer.from('SANSBYTES'));
    await writeFile(join(dir, 'serif.woff2'), Buffer.from('SERIFBYTES'));
    const deps = await loadFontDeps(dir, {
      manifest: { 'serif.woff2': { family: 'Prezi Serif', weight: 700 }, 'sans.woff2': { family: 'Prezi Sans' } },
      headingFamily: 'Prezi Serif',
      bodyFamily: 'Prezi Sans',
    });
    assert.equal(deps.files['sans.woff2'].toString(), 'SANSBYTES');
    assert.match(deps.faceCss, /font-family: 'Prezi Serif'/);
    assert.match(deps.families.headingFamily, /Prezi Serif/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadFontDeps throws when a manifest file is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fonts-'));
  try {
    await assert.rejects(
      () => loadFontDeps(dir, { manifest: { 'nope.woff2': { family: 'X' } } }),
      /not found/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('generatePresentation embeds fonts: SVG references the family, files written, styles.css has @font-face', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prezi-'));
  const outDir = join(dir, 'out');
  try {
    const fonts = makeFontDeps({
      faces: [{ family: 'Prezi Display', file: 'display.woff2', bytes: Buffer.from('FONT'), weight: 700 }],
      headingFamily: 'Prezi Display',
      bodyFamily: 'Prezi Display',
    });
    const research = {
      topic: 'Test', narrative_outline: ['hook', 'end'],
      findings: [{ claim: 'A claim', detail: 'Some detail', importance: 5, citations: ['c1'] }],
      citations: [{ id: 'c1', title: 'Paper', authors: ['A'], year: 2025, venue: 'V', doi: '', url: '' }],
    };
    const manifest = await generatePresentation(
      { id: 1, title: 'Test', slug: 'test', writeup: 'w', research }, outDir, { fonts, maxIterations: 1 },
    );
    const { readFile } = await import('node:fs/promises');
    const svg = await readFile(join(outDir, 'presentation.svg'), 'utf8');
    const css = await readFile(join(outDir, 'styles.css'), 'utf8');
    assert.match(svg, /font-family="'Prezi Display'/);
    assert.match(css, /@font-face/);
    assert.match(css, /assets\/fonts\/display\.woff2/);
    assert.equal((await readFile(join(outDir, 'assets', 'fonts', 'display.woff2'), 'utf8')), 'FONT');
    assert.equal(manifest.fonts.embedded, true);
    assert.ok(manifest.artifacts.includes('assets/fonts/display.woff2'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
