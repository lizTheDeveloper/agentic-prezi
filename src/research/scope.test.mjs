import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scope, heuristicScope } from './scope.mjs';

const WRITEUP = 'CRISPR gene editing is transforming medicine. Recent CRISPR therapies treat sickle cell disease. ' +
  'Gene editing safety remains a concern for clinical trials.';

test('heuristicScope derives a topic and keyword sub-queries', () => {
  const s = heuristicScope(WRITEUP, { maxSubQueries: 5 });
  assert.ok(s.topic.length > 0);
  assert.ok(s.sub_queries.length > 0 && s.sub_queries.length <= 5);
  assert.ok(s.narrative_outline.length > 0);
  // 'crispr'/'gene'/'editing' should surface as keywords
  const joined = s.sub_queries.join(' ').toLowerCase();
  assert.ok(/crispr|gene|editing/.test(joined));
});

test('scope falls back to heuristic when no llm given', async () => {
  const s = await scope(WRITEUP, { maxSubQueries: 4 });
  assert.ok(s.sub_queries.length <= 4);
  assert.ok(s.topic);
});

test('scope uses the llm when provided', async () => {
  const llm = { json: async () => ({ topic: 'Quantum Foo', sub_queries: ['q1', 'q2'], narrative_outline: ['a', 'b'] }) };
  const s = await scope('whatever', { llm, maxSubQueries: 6 });
  assert.equal(s.topic, 'Quantum Foo');
  assert.deepEqual(s.sub_queries, ['q1', 'q2']);
});

test('scope recovers from a throwing llm', async () => {
  const llm = { json: async () => { throw new Error('provider down'); } };
  const s = await scope(WRITEUP, { llm, maxSubQueries: 3 });
  assert.ok(s.topic);
  assert.ok(s.sub_queries.length > 0);
});

test('scope caps sub_queries from a chatty llm', async () => {
  const llm = { json: async () => ({ topic: 'T', sub_queries: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }) };
  const s = await scope('x', { llm, maxSubQueries: 3 });
  assert.equal(s.sub_queries.length, 3);
});
