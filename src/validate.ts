import { HttpError } from './http.ts';

// Input validation + the XML/SVG escaping used before embedding user text in generated artifacts.

// Deliberately permissive but anchored: rejects obvious non-addresses, not an RFC validator.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'email is required');
  const email = raw.trim().toLowerCase();
  if (email.length > 320 || !EMAIL_RE.test(email)) throw new HttpError(400, 'invalid email');
  return email;
}

export function validateTitle(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'title is required');
  const title = raw.trim();
  if (title.length === 0) throw new HttpError(400, 'title is required');
  if (title.length > maxLen) throw new HttpError(400, `title exceeds ${maxLen} characters`);
  return title;
}

export function validateWriteup(raw: unknown, maxLen: number): string {
  if (raw == null) return '';
  if (typeof raw !== 'string') throw new HttpError(400, 'write-up must be text');
  if (raw.length > maxLen) throw new HttpError(400, `write-up exceeds ${maxLen} characters`);
  return raw;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
