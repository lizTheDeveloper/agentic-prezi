#!/usr/bin/env node
// CLI for the research engine — exercises the live adapters end-to-end (the I/O layer
// the unit tests stub out). Usage:
//   node src/research/cli.mjs "your write-up text here"
//   echo "write-up" | node src/research/cli.mjs
//   node src/research/cli.mjs --topk 10 --no-cache "write-up"
//
// Runs LLM-free by default (deterministic synthesis on scholarly sources, §8); wire
// in a real `llm` once the Nous Portal provider is decided.

import { readFileSync } from 'node:fs';
import { runResearch } from './pipeline.mjs';

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

  const { doc, validation, trace } = await runResearch(writeup, {
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
