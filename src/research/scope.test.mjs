import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scope } from './scope.mjs';

const WRITEUP = 'CRISPR gene editing is transforming medicine. Recent CRISPR therapies treat sickle cell disease. ' +
  'Gene editing safety remains a concern for clinical trials.';

test('scope throws when no llm is given (no fallback)', async () => {
  await assert.rejects(() => scope(WRITEUP, { maxSubQueries: 4 }), /llm is required/);
});

test('scope uses the llm when provided', async () => {
  const llm = { json: async () => ({ topic: 'Quantum Foo', sub_queries: ['q1', 'q2'], narrative_outline: ['a', 'b'] }) };
  const s = await scope('whatever', { llm, maxSubQueries: 6 });
  assert.equal(s.topic, 'Quantum Foo');
  assert.deepEqual(s.sub_queries, ['q1', 'q2']);
});

test('scope propagates a throwing llm (no fallback)', async () => {
  const llm = { json: async () => { throw new Error('provider down'); } };
  await assert.rejects(() => scope(WRITEUP, { llm, maxSubQueries: 3 }), /provider down/);
});

test('scope throws when the llm returns no usable topic', async () => {
  const llm = { json: async () => ({ topic: '   ', sub_queries: ['a'], narrative_outline: ['x'] }) };
  await assert.rejects(() => scope('x', { llm }), /no usable topic/);
});

test('scope throws when the llm returns no sub_queries', async () => {
  const llm = { json: async () => ({ topic: 'T', sub_queries: [], narrative_outline: ['x'] }) };
  await assert.rejects(() => scope('x', { llm }), /no sub_queries/);
});

test('scope throws when the llm returns no narrative_outline', async () => {
  const llm = { json: async () => ({ topic: 'T', sub_queries: ['a'], narrative_outline: [] }) };
  await assert.rejects(() => scope('x', { llm }), /no narrative_outline/);
});

test('scope caps sub_queries from a chatty llm', async () => {
  const llm = { json: async () => ({ topic: 'T', sub_queries: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], narrative_outline: ['o'] }) };
  const s = await scope('x', { llm, maxSubQueries: 3 });
  assert.equal(s.sub_queries.length, 3);
});
