import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCommand, parseReply } from '../src/redis-min.ts';

test('encodeCommand emits a RESP array of length-prefixed bulk strings', () => {
  assert.equal(encodeCommand(['GET', 'k']).toString(), '*2\r\n$3\r\nGET\r\n$1\r\nk\r\n');
});

test('encodeCommand is injection-safe: CRLF in an argument stays inside its bulk string', () => {
  const evil = "abc\r\nGET\r\nstolen";
  const out = encodeCommand(['GET', evil]).toString();
  // The length prefix equals the raw byte length, so the embedded CRLFs are data, not framing.
  assert.ok(out.startsWith(`*2\r\n$3\r\nGET\r\n$${Buffer.byteLength(evil)}\r\n`));
  assert.ok(out.endsWith(evil + '\r\n'));
});

test('parseReply handles status, error, integer, bulk, and null', () => {
  assert.deepEqual(parseReply(Buffer.from('+OK\r\n')), { reply: { type: 'status', value: 'OK' }, consumed: 5 });
  assert.deepEqual(parseReply(Buffer.from('-ERR bad\r\n')), { reply: { type: 'error', value: 'ERR bad' }, consumed: 10 });
  assert.deepEqual(parseReply(Buffer.from(':7\r\n')), { reply: { type: 'integer', value: 7 }, consumed: 4 });
  assert.deepEqual(parseReply(Buffer.from('$3\r\nabc\r\n')), { reply: { type: 'bulk', value: 'abc' }, consumed: 9 });
  assert.deepEqual(parseReply(Buffer.from('$-1\r\n')), { reply: { type: 'bulk', value: null }, consumed: 5 });
});

test('parseReply returns null when the buffer is incomplete', () => {
  assert.equal(parseReply(Buffer.from('$5\r\nab')), null);      // payload not fully arrived
  assert.equal(parseReply(Buffer.from('+OK')), null);            // no CRLF yet
});
