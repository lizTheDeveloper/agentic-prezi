import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from './scan-secrets.mjs';

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
