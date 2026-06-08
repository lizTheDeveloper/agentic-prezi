import type { DatabaseSync } from 'node:sqlite';
import { randomBase36 } from './crypto.ts';

// URL-safe slug from a title plus a short random base62 suffix, e.g. "quantum-foam-7Kp2".
// The suffix keeps slugs unguessable and collision-resistant; the DB UNIQUE constraint is the
// final authority, with retry on the (rare) collision.

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base || 'presentation';
}

export function makeSlug(title: string, suffixLen = 4): string {
  return `${slugify(title)}-${randomBase36(suffixLen)}`;
}

// Mint a unique slug for a presentation, retrying on collision.
export function mintUniqueSlug(db: DatabaseSync, title: string, maxTries = 10): string {
  const exists = db.prepare('SELECT 1 FROM presentations WHERE slug = ?');
  for (let i = 0; i < maxTries; i++) {
    const slug = makeSlug(title, i < 5 ? 4 : 8); // widen the suffix if we keep colliding
    if (!exists.get(slug)) return slug;
  }
  throw new Error('could not mint a unique slug');
}
