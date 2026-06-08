import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLockfile, evaluate, findRangeSpecs } from './audit-deps.mjs';

const NOW = Date.UTC(2026, 5, 8); // 2026-06-08
const day = (y, m, d) => Date.UTC(y, m, d);

test('parseLockfile extracts name/version/integrity, skips root', () => {
  const lock = { packages: {
    '': { name: 'root' },
    'node_modules/left-pad': { version: '1.3.0', integrity: 'sha512-aaa' },
    'node_modules/a/node_modules/b': { version: '2.0.0', integrity: 'sha512-bbb' },
  }};
  const pkgs = parseLockfile(lock);
  assert.deepEqual(pkgs, [
    { name: 'left-pad', version: '1.3.0', integrity: 'sha512-aaa' },
    { name: 'b', version: '2.0.0', integrity: 'sha512-bbb' },
  ]);
});

test('flags a package published less than 7 days ago', () => {
  const pkgs = [{ name: 'evil', version: '1.0.0', integrity: 'sha512-x' }];
  const times = () => day(2026, 5, 6); // 2 days old
  const v = evaluate(pkgs, times, { now: NOW, minAgeDays: 7 });
  assert.equal(v.length, 1);
  assert.equal(v[0].reason, 'too-fresh');
});

test('passes a package older than 7 days', () => {
  const pkgs = [{ name: 'fine', version: '1.0.0', integrity: 'sha512-x' }];
  const times = () => day(2026, 4, 1); // weeks old
  assert.deepEqual(evaluate(pkgs, times, { now: NOW, minAgeDays: 7 }), []);
});

test('flags a missing integrity hash', () => {
  const pkgs = [{ name: 'nohash', version: '1.0.0', integrity: null }];
  const v = evaluate(pkgs, () => day(2026, 1, 1), { now: NOW, minAgeDays: 7 });
  assert.equal(v[0].reason, 'missing-integrity');
});

test('flags when publish time is unknown', () => {
  const pkgs = [{ name: 'mystery', version: '9.9.9', integrity: 'sha512-x' }];
  const v = evaluate(pkgs, () => null, { now: NOW, minAgeDays: 7 });
  assert.equal(v[0].reason, 'no-publish-time');
});

test('findRangeSpecs flags non-exact version specs', () => {
  const pj = { dependencies: { a: '1.2.3', b: '^1.0.0', c: '~2.0.0' }, devDependencies: { d: '4.5.6' } };
  assert.deepEqual(findRangeSpecs(pj).map(o => o.name).sort(), ['b', 'c']);
});
test('findRangeSpecs returns empty for exact-only / missing deps', () => {
  assert.deepEqual(findRangeSpecs({ dependencies: { a: '1.0.0' } }), []);
  assert.deepEqual(findRangeSpecs({}), []);
});
