// Top-level #3 orchestrator (spec §5): COMPOSE → refine loop (GENERATE → critique → REVISE) →
// emit the artifact set the #1 publish path serves at <slug>.themultiverse.school.
//
// Every engine-dependent stage is INJECTED with a deterministic, offline default (mirroring #2's
// §8 insulation): so this runs and unit-tests with zero network / no LLM / no browser, and the
// Hermes/Playwright/vision pieces drop in later as `deps` without touching the contract (§11).

import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { compose, refineNarrative, deterministicRevise } from './compose.mjs';
import { compileSvg } from './svg.mjs';
import { compileCamera } from './camera.mjs';
import { geometricCritique, refineLoop, LOOP_DEFAULTS } from './critique.mjs';
import { buildManifest } from './manifest.mjs';
import { escapeXml } from './util.mjs';

// Matches the locked-down published origin CSP (#0 §B4 / src/published.ts), with font-src 'self'
// for embedded faces (§7.1). The player uses inline data + same-origin module imports only — no
// fetch — so connect-src stays 'none'.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; " +
  "frame-ancestors 'none'; object-src 'none'";

const STYLES = `:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: #05060d; overflow: hidden; }
.stage { position: fixed; inset: 0; display: block; }
.stage svg { width: 100%; height: 100%; display: block; }
.hud { position: fixed; right: 12px; bottom: 10px; font: 14px system-ui, sans-serif;
  color: #8a96c8; background: rgba(5,6,13,.6); padding: 4px 10px; border-radius: 999px;
  user-select: none; pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .stage svg { transition: none !important; } }
`;

/** Inline the camera JSON safely into a non-executable <script> (escape the </script> sequence). */
function inlineJson(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function buildIndexHtml(title, svgInline, camera) {
  // Strip the XML prolog: the SVG is inlined into HTML, not served as a standalone document here.
  const svg = svgInline.replace(/^<\?xml[^>]*\?>\s*/, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${escapeXml(title)}</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<main class="stage">
${svg}</main>
<nav class="hud" aria-hidden="true"><span id="progress"></span></nav>
<script id="camera-data" type="application/json">${inlineJson(camera)}</script>
<script type="module" src="player.js"></script>
</body>
</html>
`;
}

// Read the player runtime sources and prepare them as shippable artifacts. player.js imports the
// pure math module; rewrite the .mjs specifier to the shipped .js filename (same source we test).
async function runtimeArtifacts() {
  const cam = new URL('./runtime/camera-math.mjs', import.meta.url);
  const ply = new URL('./runtime/player.mjs', import.meta.url);
  const cameraMath = await readFile(cam, 'utf8');
  let player = await readFile(ply, 'utf8');
  // Rewrite every .mjs reference (import specifier + the comment that documents it) to the shipped
  // .js filename, so the artifact carries no dangling .mjs reference.
  player = player.replaceAll('./camera-math.mjs', './camera-math.js');
  return { 'camera-math.js': cameraMath, 'player.js': player };
}

/**
 * Generate a full presentation from a research §4 doc + write-up, writing artifacts into `outDir`.
 *
 * @param input { id, title, slug, writeup, research }   research = §4 findings doc
 * @param outDir absolute output directory
 * @param deps  injectable stages (all optional):
 *   { llm, render, critic, revise, maxIterations, budget,
 *     composeOpts, fonts:{embedded, faceCss, files:{name:Buffer}} }
 * @returns the written manifest
 */
export async function generatePresentation(input, outDir, deps = {}) {
  const maxIterations = deps.maxIterations ?? LOOP_DEFAULTS.maxIterations;

  // COMPOSE (deterministic structure/layout) → OPTIONAL llm wording refinement (fail-open, §6).
  let { ir } = compose(input.research, { title: input.title, writeup: input.writeup, ...(deps.composeOpts || {}) });
  if (deps.llm) ir = await refineNarrative(ir, { llm: deps.llm });

  // Embedded-font family overrides (§7.1) flow into every SVG compile so the emitted markup
  // references the same faces styles.css declares (and the geometric critique sees what ships).
  const fontFamilies = deps.fonts?.families;

  // GENERATE + critique + REVISE (bounded loop). Defaults are the offline deterministic stages.
  const render = deps.render ?? ((doc) => ({ ...compileSvg(doc, { fonts: fontFamilies }), ir: doc }));
  const critic = deps.critic ?? ((rr, doc) => geometricCritique(rr.layout, doc));
  const revise = deps.revise ?? deterministicRevise;
  const loop = await refineLoop(ir, { render, critic, revise, maxIterations, budget: deps.budget });

  const finalIr = loop.ir;
  const { svg } = compileSvg(finalIr, { fonts: fontFamilies });
  const camera = compileCamera(finalIr);
  const indexHtml = buildIndexHtml(input.title, svg, camera);
  const runtime = await runtimeArtifacts();

  // Fresh artifact dir (idempotent re-runs, §10): clear then write.
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const files = {
    'index.html': indexHtml,
    'presentation.svg': svg,
    'camera.json': JSON.stringify(camera, null, 2),
    'styles.css': STYLES + (deps.fonts?.faceCss || ''),
    ...runtime,
  };

  // Optional embedded fonts (§7.1): self-hosted under assets/fonts, referenced by styles.css.
  const artifactNames = Object.keys(files);
  if (deps.fonts?.files) {
    await mkdir(join(outDir, 'assets', 'fonts'), { recursive: true });
    for (const [name, buf] of Object.entries(deps.fonts.files)) {
      await writeFile(join(outDir, 'assets', 'fonts', name), buf);
      artifactNames.push(`assets/fonts/${name}`);
    }
  }

  const quality = {
    converged: loop.converged,
    iterations: loop.iterations,
    maxIterations,
    residualIssues: loop.residualIssues,
    critic: deps.critic ? 'injected' : 'geometric',
  };
  const manifest = buildManifest({
    id: input.id,
    title: input.title,
    slug: input.slug,
    ir: finalIr,
    artifacts: [...artifactNames, 'manifest.json'],
    quality,
    fonts: deps.fonts ? { embedded: true } : undefined,
  });
  files['manifest.json'] = JSON.stringify(manifest, null, 2);

  await Promise.all(Object.entries(files).map(([name, content]) => writeFile(join(outDir, name), content, 'utf8')));
  return manifest;
}

/**
 * Adapter to the #1 `Generator` seam: (GenInput,outDir)=>Manifest. This is the #2→#3→#1 wiring the
 * worker adopts when an llm is configured (see src/server.ts): GenInput carries no research, so it
 * runs #2 (`runResearch`, with the §7.1 injection scan when a scorer is injected) to produce the §4
 * findings doc, then #3 (`generatePresentation`) to emit the artifact set #1 publishes. An injected
 * `research` doc short-circuits #2 (tests / re-publish from cache).
 *
 * @param deps { llm, scan?, fonts?, research?, ...generatePresentation deps }
 */
export function makePreziGenerator(deps = {}) {
  return async (genInput, outDir) => {
    let research = deps.research;
    if (!research) {
      const { runResearch } = await import('../research/pipeline.mjs');
      const r = await runResearch(genInput.sourceWriteup || genInput.title, {
        llm: deps.llm || null,
        ...(deps.scan ? { scan: deps.scan } : {}),
      });
      research = r.doc;
    }
    return generatePresentation(
      { id: genInput.id, title: genInput.title, slug: genInput.slug, writeup: genInput.sourceWriteup, research },
      outDir,
      deps,
    );
  };
}
