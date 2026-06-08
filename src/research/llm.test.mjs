import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, makeJsonLlm } from './llm.mjs';

test('extractJson parses a bare object', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

test('extractJson strips ```json fences and surrounding prose', () => {
  const reply = 'Sure! Here you go:\n```json\n{ "findings": [] }\n```\nHope that helps.';
  assert.deepEqual(extractJson(reply), { findings: [] });
});

test('extractJson handles braces inside strings', () => {
  assert.deepEqual(extractJson('{"s":"a } b {"}'), { s: 'a } b {' });
});

test('extractJson parses arrays', () => {
  assert.deepEqual(extractJson('prefix [1,2,3] suffix'), [1, 2, 3]);
});

test('extractJson throws when no JSON present', () => {
  assert.throws(() => extractJson('no json here'));
});

test('makeJsonLlm wraps a completion fn into the json contract', async () => {
  const llm = makeJsonLlm(async ({ user }) => `{"echo":"${user}"}`);
  assert.deepEqual(await llm.json({ system: 's', user: 'hi' }), { echo: 'hi' });
});
