// Minimal stdlib HTTP client for the scholarly adapters. `node:https` only — zero
// npm deps (per #0). Polite-pool friendly: every request carries a User-Agent +
// contact email. Includes backoff for 429/503 (adapter rate-limit handling, §2).
//
// This is the I/O layer; it is exercised via CLI/integration, not unit tests — the
// adapters' *parse* functions hold the unit-tested logic (repo pure-core pattern).

import { get } from 'node:https';

// Open item §10.3: polite-pool contact. NEVER hardcode a personal address in this
// PUBLIC repo — read from env, fall back to a project-neutral mailbox.
export const CONTACT_EMAIL = process.env.RESEARCH_CONTACT_EMAIL || 'research@themultiverse.school';
export const USER_AGENT = `agentic-prezi/0.0 (+https://themultiverse.school; mailto:${CONTACT_EMAIL})`;

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * GET a URL and return the raw body as a string. Retries transient failures with
 * exponential backoff, honoring Retry-After when present.
 */
export async function fetchText(url, { headers = {}, maxRetries = 3, timeoutMs = 15_000 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await getOnce(url, { headers, timeoutMs });
    } catch (err) {
      const status = err?.statusCode;
      const retryable = status == null ? err?.transient === true : RETRY_STATUS.has(status);
      if (!retryable || attempt >= maxRetries) throw err;
      const backoff = err?.retryAfterMs ?? Math.min(16_000, 1000 * 2 ** attempt);
      await sleep(backoff);
      attempt++;
    }
  }
}

function getOnce(url, { headers, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = get(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...headers } }, (res) => {
      const { statusCode } = res;
      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchText(new URL(res.headers.location, url).toString(), { headers, timeoutMs }));
      }
      if (statusCode !== 200) {
        res.resume();
        const err = new Error(`HTTP ${statusCode} for ${url}`);
        err.statusCode = statusCode;
        const ra = Number(res.headers['retry-after']);
        if (Number.isFinite(ra)) err.retryAfterMs = ra * 1000;
        return reject(err);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    });
    req.setTimeout(timeoutMs, () => {
      const err = new Error(`timeout after ${timeoutMs}ms for ${url}`);
      err.transient = true;
      req.destroy(err);
    });
    req.on('error', (err) => { if (err.transient == null) err.transient = true; reject(err); });
  });
}

/** GET and JSON.parse. */
export async function fetchJson(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}

/**
 * Liveness check for the grounding resolver (⚑ §4). Resolves a DOI via doi.org or
 * checks a URL is reachable. Returns boolean; never throws.
 */
export async function isResolvable(citation, { fetchTextImpl = fetchText } = {}) {
  const target = citation.doi
    ? `https://doi.org/${String(citation.doi).replace(/^https?:\/\/doi\.org\//, '')}`
    : citation.url;
  if (!target) return false;
  try {
    await fetchTextImpl(target, { maxRetries: 1, timeoutMs: 10_000, headers: { accept: '*/*' } });
    return true;
  } catch (err) {
    // A 4xx other than 404/410 (e.g. 403 paywall) still means the resource exists.
    const s = err?.statusCode;
    return s != null && s !== 404 && s !== 410 && s < 500;
  }
}
