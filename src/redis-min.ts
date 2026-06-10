// Minimal, zero-dependency Redis client — just enough to AUTH + GET a key, spoken over a
// raw node:net socket (per #0: no npm redis client). Used only to resolve the shared
// `.themultiverse.school` School-SSO session blob from the platform's Redis (src/school-sso.ts).
//
// Security: commands are encoded as RESP arrays of LENGTH-PREFIXED bulk strings, so a value
// (e.g. an attacker-supplied session id) can never break out of its argument and inject another
// command — the `$<len>\r\n<bytes>\r\n` framing is injection-safe by construction.

import { connect } from 'node:net';

export interface RedisTarget {
  host: string;
  port: number;
  username?: string;   // ACL user (Redis 6+); omit for legacy `AUTH <password>`
  password?: string;
  timeoutMs?: number;
}

/** Pure: encode a Redis command as a RESP array of bulk strings. */
export function encodeCommand(args: string[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const a of args) {
    const b = Buffer.from(a, 'utf8');
    parts.push(Buffer.from(`$${b.length}\r\n`), b, Buffer.from('\r\n'));
  }
  return Buffer.concat(parts);
}

// A RESP reply: simple string (+), error (-), integer (:), or bulk string ($, null when len<0).
export type RespReply =
  | { type: 'status'; value: string }
  | { type: 'error'; value: string }
  | { type: 'integer'; value: number }
  | { type: 'bulk'; value: string | null };

/**
 * Pure: try to parse ONE reply from the front of `buf`. Returns the reply plus the number of
 * bytes consumed, or null if more data is needed. Only the reply types AUTH/GET produce are
 * handled (status/error/integer/bulk) — enough for this client.
 */
export function parseReply(buf: Buffer): { reply: RespReply; consumed: number } | null {
  if (buf.length < 1) return null;
  const type = String.fromCharCode(buf[0]);
  const nl = buf.indexOf('\r\n');
  if (nl < 0) return null;
  const line = buf.toString('utf8', 1, nl);
  const headerEnd = nl + 2;
  switch (type) {
    case '+': return { reply: { type: 'status', value: line }, consumed: headerEnd };
    case '-': return { reply: { type: 'error', value: line }, consumed: headerEnd };
    case ':': return { reply: { type: 'integer', value: Number(line) }, consumed: headerEnd };
    case '$': {
      const len = Number(line);
      if (len < 0) return { reply: { type: 'bulk', value: null }, consumed: headerEnd };
      const dataEnd = headerEnd + len;
      if (buf.length < dataEnd + 2) return null; // wait for payload + trailing CRLF
      return { reply: { type: 'bulk', value: buf.toString('utf8', headerEnd, dataEnd) }, consumed: dataEnd + 2 };
    }
    default:
      throw new Error(`redis: unexpected reply type "${type}"`);
  }
}

/**
 * Connect, optionally AUTH, GET `key`, and return the string value (or null if missing).
 * One short-lived connection per call — callers cache results so this isn't hot. Fails closed:
 * any socket/protocol/auth error rejects, and the caller treats that as "not authenticated".
 */
export function redisGet(target: RedisTarget, key: string): Promise<string | null> {
  const { host, port, username, password, timeoutMs = 2000 } = target;
  const commands: Buffer[] = [];
  if (password) commands.push(encodeCommand(username ? ['AUTH', username, password] : ['AUTH', password]));
  commands.push(encodeCommand(['GET', key]));
  const expectedReplies = commands.length;

  return new Promise((resolve, reject) => {
    const sock = connect({ host, port });
    let buf = Buffer.alloc(0);
    const replies: RespReply[] = [];
    let settled = false;
    const done = (err: Error | null, value?: string | null) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      if (err) reject(err); else resolve(value ?? null);
    };

    sock.setTimeout(timeoutMs, () => done(new Error('redis: timeout')));
    sock.on('error', (err) => done(err));
    sock.on('connect', () => sock.write(Buffer.concat(commands)));
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        for (;;) {
          const parsed = parseReply(buf);
          if (!parsed) break;
          buf = buf.subarray(parsed.consumed);
          replies.push(parsed.reply);
          if (replies.length === expectedReplies) {
            const last = replies[replies.length - 1];
            const authReply = password ? replies[0] : null;
            if (authReply && authReply.type === 'error') return done(new Error(`redis AUTH: ${authReply.value}`));
            if (last.type === 'error') return done(new Error(`redis GET: ${last.value}`));
            if (last.type !== 'bulk') return done(new Error(`redis GET: unexpected ${last.type}`));
            return done(null, last.value);
          }
        }
      } catch (err) {
        done(err as Error);
      }
    });
  });
}
