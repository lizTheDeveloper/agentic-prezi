import { scanText, scanDiff } from './scan-secrets.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('detects an AWS access key id', () => {
  const sample = 'const k = "' + 'AKIA' + 'ABCDEFGHIJKLMNOP' + '";';
  const hits = scanText(sample);
  assert.equal(hits.some(h => h.pattern === 'aws-access-key'), true);
});

test('detects a github token', () => {
  const sample = 'token=' + 'ghp_' + 'a'.repeat(36);
  assert.equal(scanText(sample).some(h => h.pattern === 'github-token'), true);
});

test('detects a private key header', () => {
  const sample = '-----BEGIN ' + 'PRIVATE KEY-----';
  assert.equal(scanText(sample).some(h => h.pattern === 'private-key'), true);
});

test('does not flag ordinary prose', () => {
  const sample = 'This spec describes the supply-chain gate and the 7-day rule.';
  assert.deepEqual(scanText(sample), []);
});

test('detects a modern openai project key', () => {
  const sample = 'k=' + 'sk-proj-' + 'A'.repeat(24);
  assert.equal(scanText(sample).some(h => h.pattern === 'openai-key-modern'), true);
});

test('detects a fine-grained github pat', () => {
  const sample = 'k=' + 'github_pat_' + 'B'.repeat(60);
  assert.equal(scanText(sample).some(h => h.pattern === 'github-pat'), true);
});

test('scanDiff detects a secret in an added line', () => {
  const diff = ['+++ b/f', '+const k = "' + 'AKIA' + 'ABCDEFGHIJKLMNOP' + '";', '-gone', ' ctx'].join('\n');
  assert.equal(scanDiff(diff).some(h => h.pattern === 'aws-access-key'), true);
});

test('scanDiff ignores +++ header, removed and context lines', () => {
  const key = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const diff = ['+++ b/' + key, '-' + key, ' ' + key].join('\n');
  assert.deepEqual(scanDiff(diff), []);
});
