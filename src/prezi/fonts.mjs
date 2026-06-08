// Embedded typeface support (spec §7.1) — the correctness-critical font-fidelity layer.
//
// The "screenshots match what viewers see" guarantee only holds if the SAME font files render in
// the sandbox (Playwright/Chromium) and in a viewer's browser. So we SELF-HOST a small fixed set of
// faces from the presentation origin (`assets/fonts/…`), reference them by family name in the SVG,
// and declare them via @font-face in styles.css. This is CSP-clean under `default-src 'self'` with
// `font-src 'self'` (a CDN font would be BLOCKED). We do NOT convert text→paths (§7.1) — that would
// kill selectable text, accessibility, and live citation links.
//
// This module is the plumbing: turn a set of font files into the { faceCss, files, families } shape
// generatePresentation already consumes as `deps.fonts`. The actual licensed binaries are pinned
// into the build/sandbox image (#4); this stays asset-agnostic and unit-testable offline.

import { readFile, readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';

const FORMAT_BY_EXT = { '.woff2': 'woff2', '.woff': 'woff', '.ttf': 'truetype', '.otf': 'opentype' };

/**
 * Build the @font-face CSS for a set of faces. Each src path is resolved relative to styles.css
 * (which sits beside `assets/`), i.e. `assets/fonts/<file>` — same-origin, CSP-clean.
 * @param faces [{ family, file, weight?, style?, display? }]
 * @returns string
 */
export function buildFontFaceCss(faces) {
  return faces.map((f) => {
    const ext = extname(f.file).toLowerCase();
    const format = FORMAT_BY_EXT[ext] || 'truetype';
    const weight = f.weight ?? 400;
    const style = f.style ?? 'normal';
    const display = f.display ?? 'swap';
    return [
      '@font-face {',
      `  font-family: '${f.family}';`,
      `  font-style: ${style};`,
      `  font-weight: ${weight};`,
      `  font-display: ${display};`,
      `  src: url('assets/fonts/${f.file}') format('${format}');`,
      '}',
    ].join('\n');
  }).join('\n');
}

/**
 * Assemble the `deps.fonts` object generatePresentation consumes, given the raw bytes of each face
 * plus which families to use for headings vs. body. The emitted SVG references `headingFamily`/
 * `bodyFamily`, which MUST match a declared @font-face family (with a fallback stack appended so a
 * missing face degrades instead of vanishing).
 *
 * @param spec { faces:[{family,file,bytes:Buffer,weight?,style?}], headingFamily, bodyFamily }
 * @returns { embedded, faceCss, files, families:{ headingFamily, bodyFamily } }
 */
export function makeFontDeps(spec) {
  const { faces, headingFamily, bodyFamily } = spec;
  if (!Array.isArray(faces) || faces.length === 0) throw new Error('makeFontDeps: at least one face is required');
  const files = {};
  for (const f of faces) {
    if (!f.file || f.bytes == null) throw new Error('makeFontDeps: each face needs { file, bytes }');
    files[f.file] = f.bytes;
  }
  return {
    embedded: true,
    faceCss: buildFontFaceCss(faces),
    files,
    families: {
      headingFamily: `'${headingFamily}', Georgia, serif`,
      bodyFamily: `'${bodyFamily}', system-ui, sans-serif`,
    },
  };
}

/**
 * Load a font set from a directory (the build/sandbox font dir, #4). `manifest` maps each filename
 * to { family, weight?, style? }; `headingFamily`/`bodyFamily` name the families to apply. Returns
 * the same `deps.fonts` shape as makeFontDeps. Pure plumbing — no network, stdlib only.
 *
 * @param dir       directory containing the font files
 * @param opts      { manifest:{ [file]:{family,weight?,style?} }, headingFamily, bodyFamily }
 */
export async function loadFontDeps(dir, opts = {}) {
  const { manifest, headingFamily, bodyFamily } = opts;
  const present = new Set(await readdir(dir));
  const entries = manifest ? Object.entries(manifest) : null;
  const files = entries
    ? entries.map(([file, meta]) => ({ file, meta }))
    : [...present].filter((n) => FORMAT_BY_EXT[extname(n).toLowerCase()]).map((file) => ({ file, meta: { family: basename(file, extname(file)) } }));

  const faces = [];
  for (const { file, meta } of files) {
    if (!present.has(file)) throw new Error(`loadFontDeps: font file not found: ${file}`);
    // eslint-disable-next-line no-await-in-loop
    const bytes = await readFile(join(dir, file));
    faces.push({ family: meta.family, file, weight: meta.weight, style: meta.style, bytes });
  }
  return makeFontDeps({
    faces,
    headingFamily: headingFamily ?? faces[0].family,
    bodyFamily: bodyFamily ?? faces[faces.length - 1].family,
  });
}
