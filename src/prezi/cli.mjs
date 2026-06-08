#!/usr/bin/env node
// CLI for the #3 presentation generator — exercises Compose → refine loop → artifact emit end to
// end (the file I/O the unit tests stub out). Runs fully offline by default (deterministic stages).
//
// Usage:
//   node src/prezi/cli.mjs --research findings.json --title "My Talk" --out data/preview
//   node src/prezi/cli.mjs --from-writeup "write-up text" --title "My Talk" --out data/preview
//   cat findings.json | node src/prezi/cli.mjs --title "My Talk" --out data/preview
//
// --research <file>  : a research §4 findings doc (or pipe it on stdin)
// --from-writeup <s> : run #2 research on <s> first, then generate (live scholarly APIs)
// --writeup-file <f> : attach the user's raw write-up (tone/intent) from a file
// --title <s>        : presentation title (defaults to the research topic)
// --out <dir>        : artifact output directory (default: data/presentations/preview)
// --max-iters <n>    : refine-loop cap (default 4)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generatePresentation } from './generate.mjs';

function parseArgs(argv) {
  const o = { out: 'data/presentations/preview', id: 0, slug: 'preview' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--research') o.research = argv[++i];
    else if (a === '--from-writeup') o.fromWriteup = argv[++i];
    else if (a === '--writeup-file') o.writeupFile = argv[++i];
    else if (a === '--title') o.title = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--max-iters') o.maxIterations = Number(argv[++i]);
    else if (a === '--slug') o.slug = argv[++i];
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  let research;
  let writeup = o.writeupFile ? readFileSync(resolve(o.writeupFile), 'utf8') : '';

  if (o.fromWriteup) {
    const { runResearch } = await import('../research/pipeline.mjs');
    process.stderr.write(`researching "${o.fromWriteup.slice(0, 60)}"…\n`);
    const r = await runResearch(o.fromWriteup, {});
    if (!r.validation.valid) { console.error('research doc invalid:', r.validation.errors.join('; ')); process.exit(1); }
    research = r.doc;
    if (!writeup) writeup = o.fromWriteup;
  } else {
    const raw = o.research ? readFileSync(resolve(o.research), 'utf8') : (!process.stdin.isTTY ? readFileSync(0, 'utf8') : '');
    if (!raw.trim()) {
      console.error('usage: node src/prezi/cli.mjs (--research <file> | --from-writeup "<text>") --title "<t>" --out <dir>');
      process.exit(2);
    }
    research = JSON.parse(raw);
  }

  const title = o.title || research.topic || 'Untitled';
  const outDir = resolve(o.out);
  const manifest = await generatePresentation(
    { id: o.id, title, slug: o.slug, writeup, research },
    outDir,
    { maxIterations: o.maxIterations },
  );

  process.stderr.write(
    `✓ ${manifest.sceneCount} scenes, ${manifest.stopCount} stops → ${outDir}\n` +
      `  quality: converged=${manifest.quality.converged} iterations=${manifest.quality.iterations}` +
      ` residual=${manifest.quality.residualIssues.length}\n`,
  );
  process.stdout.write(JSON.stringify({ out: outDir, artifacts: manifest.artifacts, quality: manifest.quality }, null, 2) + '\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
