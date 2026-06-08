#!/usr/bin/env node
// CLI for the research engine — exercises the live adapters end-to-end (the I/O layer
// the unit tests stub out). Usage:
//   node src/research/cli.mjs "your write-up text here"
//   echo "write-up" | node src/research/cli.mjs
//   node src/research/cli.mjs --topk 10 --no-cache "write-up"
//
// Scope + synthesis run through a real LLM via the Nous Portal (OpenAI-compatible) and
// REQUIRE NOUS_RESEARCH_API_KEY — override model with NOUS_RESEARCH_MODEL, host with
// NOUS_RESEARCH_BASE_URL. There is no deterministic fallback: a missing key or a provider
// failure errors out loudly instead of emitting degraded results.

import { readFileSync } from 'node:fs';
import { runResearch } from './pipeline.mjs';
import { makeNousLlm, DEFAULT_MODEL } from './providers/nous.mjs';
import { makeLocalScorer } from './scan.mjs';

function parseArgs(argv) {
  const opts = { budgets: {}, cache: {} };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--topk') opts.budgets.topK = Number(argv[++i]);
    else if (a === '--subqueries') opts.budgets.maxSubQueries = Number(argv[++i]);
    else if (a === '--no-cache') opts.cache.enabled = false;
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
    console.error('usage: node src/research/cli.mjs [--topk N] [--subqueries N] [--no-cache] [--trace] "<write-up>"');
    process.exit(2);
  }

  const llm = makeNousLlm();
  if (!llm) {
    console.error('✗ NOUS_RESEARCH_API_KEY is not set — scope + synthesis require an LLM (no fallback).');
    process.exit(1);
  }
  console.error(`→ scope + synthesis via ${process.env.NOUS_RESEARCH_MODEL || DEFAULT_MODEL} (Nous Portal)`);

  // §7.1 active injection scan runs only when a self-hosted Prompt Guard 2 scorer is reachable
  // (PROMPT_GUARD_URL); otherwise research proceeds on the layer-1 structural defenses alone.
  const scorer = makeLocalScorer();
  if (scorer) console.error('🛡 prompt-injection scan: enabled (PROMPT_GUARD_URL)');

  const { doc, validation, trace } = await runResearch(writeup, {
    llm,
    budgets: opts.budgets,
    cache: opts.cache,
    scan: scorer ? { scorer } : {},
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
