import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRedisUrl, parseSchoolBlob } from '../src/school-sso.ts';

test('parseRedisUrl extracts host/port/user/password', () => {
  assert.deepEqual(parseRedisUrl('redis://default:s3cr3t@redishost:6379'), {
    host: 'redishost', port: 6379, username: 'default', password: 's3cr3t',
  });
  // password-only (no user)
  assert.deepEqual(parseRedisUrl('redis://:pw@host:6380'), {
    host: 'host', port: 6380, username: undefined, password: 'pw',
  });
  // default port
  assert.equal(parseRedisUrl('redis://host').port, 6379);
  assert.throws(() => parseRedisUrl('http://nope'));
});

test('parseSchoolBlob returns the lowercased email for a valid, unexpired blob', () => {
  const now = 1_000_000;
  const raw = JSON.stringify({ expires: now + 100, data: { email: 'Liz@themultiverse.school' } });
  assert.deepEqual(parseSchoolBlob(raw, now), { email: 'liz@themultiverse.school' });
});

test('parseSchoolBlob rejects expired, malformed, and email-less blobs (fail closed)', () => {
  const now = 1_000_000;
  assert.equal(parseSchoolBlob(JSON.stringify({ expires: now - 1, data: { email: 'a@b.c' } }), now), null);
  assert.equal(parseSchoolBlob('not json', now), null);
  assert.equal(parseSchoolBlob(JSON.stringify({ data: { pending_next: 'x', session_id: 'y' } }), now), null);
  assert.equal(parseSchoolBlob(JSON.stringify({ data: { email: 'notanemail' } }), now), null);
  assert.equal(parseSchoolBlob(JSON.stringify({ expires: 'abc', data: { email: 'a@b.c' } }), now)?.email, 'a@b.c'); // non-numeric expires ignored
});
