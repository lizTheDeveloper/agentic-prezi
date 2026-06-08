import { randomBytes, createHash } from 'node:crypto';

// Secret material is generated with the CSPRNG and only ever stored as a SHA-256 hash, so a
// database read never reveals a usable token or session secret (spec §4, §8). Tokens are
// high-entropy (32 random bytes) and validated by indexed equality on their hash column, so
// there is no in-app secret comparison and thus no constant-time-compare path to leak timing.

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// Lowercase URL-safe random string for slug suffixes. Lowercase only because slugs become DNS
// subdomains, which are case-insensitive (the Host header arrives lowercased). Rejection-sampled
// so the alphabet is unbiased (256 is not a multiple of 36).
const BASE36 = 'abcdefghijklmnopqrstuvwxyz0123456789';
const BASE36_LIMIT = 252; // 36 * 7 — bytes >= this would bias the first 4 characters
export function randomBase36(len = 4): string {
  let out = '';
  while (out.length < len) {
    for (const b of randomBytes(len - out.length + 4)) {
      if (out.length >= len) break;
      if (b < BASE36_LIMIT) out += BASE36[b % 36];
    }
  }
  return out;
}
