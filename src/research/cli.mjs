#!/usr/bin/env node
// CLI for the research engine — exercises the live adapters end-to-end (the I/O layer
// the unit tests stub out). Usage:
//   node src/research/cli.mjs "your write-up text here"
//   echo "write-up" | node src/research/cli.mjs
//   node src/research/cli.mjs --topk 10 --no-cache "write-up"
//   node src/research/cli.mjs --no-llm "write-up"   # force deterministic, scholarly-only
//
// Uses a real LLM for scope + synthesis when NOUS_RESEARCH_API_KEY is set (Nous Portal,
// OpenAI-compatible; override model with NOUS_RESEARCH_MODEL, host with
// NOUS_RESEARCH_BASE_URL). Without a key — or with --no-llm — it degrades to deterministic
// synthesis on the scholarly sources (§8 insulation), so the pipeline always runs.

import { readFileSync } from 'node:fs';
import { runResearch } from './pipeline.mjs';
import { makeNousLlm, DEFAULT_MODEL } from './providers/nous.mjs';

function parseArgs(argv) {
  const opts = { budgets: {}, cache: {} };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--topk') opts.budgets.topK = Number(argv[++i]);
    else if (a === '--subqueries') opts.budgets.maxSubQueries = Number(argv[++i]);
    else if (a === '--no-cache') opts.cache.enabled = false;
    else if (a === '--no-llm') opts.noLlm = true;
    else if (a === '--trace') opts.showTrace = true;
    else rest.push(a);
  }
  opts.writeup = rest.join(' ').trim();
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let writeup = opts.writeup;
  if (!writeup && !process.stdin.isTTY) {
    writeup = readFileSync(0, 'utf8').trim();
  }
  if (!writeup) {
    console.error('usage: node src/research/cli.mjs [--topk N] [--subqueries N] [--no-cache] [--no-llm] [--trace] "<write-up>"');
    process.exit(2);
  }

  const llm = opts.noLlm ? null : makeNousLlm();
  console.error(llm
    ? `→ scope + synthesis via ${process.env.NOUS_RESEARCH_MODEL || DEFAULT_MODEL} (Nous Portal)`
    : '→ no LLM (deterministic synthesis on scholarly sources)');

  const { doc, validation, trace } = await runResearch(writeup, {
    llm,
    budgets: opts.budgets,
    cache: opts.cache,
  });

  if (opts.showTrace) console.error(JSON.stringify(trace, null, 2));
  if (!validation.valid) {
    console.error('✗ findings doc failed contract validation:');
    for (const e of validation.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  if (doc.insufficient_sources) {
    console.error(`⚠ insufficient credible sources for "${doc.topic}" — emitting partial doc.`);
  }
  process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
