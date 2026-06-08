import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectGenerator } from './worker.ts';
import { generateStub } from './generator.ts';

// selectGenerator wires the #2→#3→#1 pipeline based on whether an LLM is configured.
test('selectGenerator falls back to the #1 stub when no LLM is configured', () => {
  const prev = process.env.NOUS_RESEARCH_API_KEY;
  delete process.env.NOUS_RESEARCH_API_KEY;
  try {
    assert.equal(selectGenerator(), generateStub);
  } finally {
    if (prev !== undefined) process.env.NOUS_RESEARCH_API_KEY = prev;
  }
});

test('selectGenerator returns the prezi pipeline generator when an LLM key is set', () => {
  const prev = process.env.NOUS_RESEARCH_API_KEY;
  process.env.NOUS_RESEARCH_API_KEY = 'test-key-not-used-offline';
  try {
    const gen = selectGenerator();
    assert.notEqual(gen, generateStub);
    assert.equal(typeof gen, 'function');
  } finally {
    if (prev === undefined) delete process.env.NOUS_RESEARCH_API_KEY;
    else process.env.NOUS_RESEARCH_API_KEY = prev;
  }
});
