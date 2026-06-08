import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

// Secret material is generated with the CSPRNG and only ever stored as a SHA-256 hash, so a
// database read never reveals a usable token or session secret (spec §4, §8).

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// Constant-time comparison of two hex strings (avoids leaking match position via timing).
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Lowercase URL-safe random string for slug suffixes. Lowercase only because slugs become DNS
// subdomains, which are case-insensitive (the Host header arrives lowercased).
const BASE36 = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function randomBase36(len = 4): string {
  const buf = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += BASE36[buf[i] % 36];
  return out;
}
