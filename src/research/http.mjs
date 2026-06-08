// Minimal stdlib HTTP client for the scholarly adapters. `node:https` only — zero
// npm deps (per #0). Polite-pool friendly: every request carries a User-Agent +
// contact email. Includes backoff for 429/503 (adapter rate-limit handling, §2),
// a redirect hop cap and a response-size cap (anti-OOM / anti-loop hardening).
//
// This is the I/O layer; it is exercised via CLI/integration, not unit tests — the
// adapters' *parse* functions hold the unit-tested logic (repo pure-core pattern).

import { request } from 'node:https';

// Open item §10.3: polite-pool contact. NEVER hardcode a personal address in this
// PUBLIC repo — read from env, fall back to a project-neutral mailbox.
export const CONTACT_EMAIL = process.env.RESEARCH_CONTACT_EMAIL || 'research@themultiverse.school';
export const USER_AGENT = `agentic-prezi/0.0 (+https://themultiverse.school; mailto:${CONTACT_EMAIL})`;

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_REDIRECTS = 5;            // anti redirect-loop (fix #4)
const MAX_BYTES = 8 * 1024 * 1024;  // 8 MiB body cap — anti-OOM on hostile/huge bodies (fix #5)

// Defense-in-depth egress allowlist (fix #6). Infra-level egress control is #4's job
// (spec §B3); this is an opt-in app-layer guard against SSRF via citation urls /
// redirect targets. Default: permissive (publisher DOIs redirect to arbitrary hosts,
// so resolvability must reach them). Set RESEARCH_EGRESS_ALLOWLIST=host1,host2 to
// restrict — adapter hosts + doi.org should be included when enabling.
const EGRESS_ALLOWLIST = (process.env.RESEARCH_EGRESS_ALLOWLIST || '')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

function assertEgressAllowed(url) {
  if (EGRESS_ALLOWLIST.length === 0) return; // permissive by default
  const host = new URL(url).hostname.toLowerCase();
  const ok = EGRESS_ALLOWLIST.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  if (!ok) {
    const err = new Error(`egress blocked by allowlist: ${host}`);
    err.egressBlocked = true;
    throw err;
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * GET a URL and return the raw body as a string. Retries transient failures with
 * exponential backoff, honoring Retry-After. Follows up to MAX_REDIRECTS hops.
 */
export async function fetchText(url, opts = {}) {
  const { headers = {}, maxRetries = 3, timeoutMs = 15_000, method = 'GET', redirectsLeft = MAX_REDIRECTS, maxBytes = MAX_BYTES } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await requestOnce(url, { headers, timeoutMs, method, redirectsLeft, maxBytes });
    } catch (err) {
      if (err?.egressBlocked) throw err; // never retry a policy denial
      const status = err?.statusCode;
      const retryable = status == null ? err?.transient === true : RETRY_STATUS.has(status);
      if (!retryable || attempt >= maxRetries) throw err;
      const backoff = err?.retryAfterMs ?? Math.min(16_000, 1000 * 2 ** attempt);
      await sleep(backoff);
      attempt++;
    }
  }
}

function requestOnce(url, { headers, timeoutMs, method, redirectsLeft, maxBytes }) {
  assertEgressAllowed(url);
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...headers } }, (res) => {
      const { statusCode } = res;
      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          const err = new Error(`too many redirects for ${url}`);
          return reject(err);
        }
        const next = new URL(res.headers.location, url).toString();
        return resolve(fetchText(next, { headers, timeoutMs, method, redirectsLeft: redirectsLeft - 1, maxBytes }));
      }
      if (statusCode !== 200) {
        res.resume();
        const err = new Error(`HTTP ${statusCode} for ${url}`);
        err.statusCode = statusCode;
        const ra = Number(res.headers['retry-after']);
        if (Number.isFinite(ra)) err.retryAfterMs = ra * 1000;
        return reject(err);
      }
      // HEAD: no body expected.
      if (method === 'HEAD') { res.resume(); return resolve(''); }
      let body = '';
      let bytes = 0;
      res.setEncoding('utf8');
      res.on('data', (c) => {
        bytes += Buffer.byteLength(c);
        if (bytes > maxBytes) {
          const err = new Error(`response exceeded ${maxBytes} bytes for ${url}`);
          req.destroy(err);
          return;
        }
        body += c;
      });
      res.on('end', () => resolve(body));
    });
    req.setTimeout(timeoutMs, () => {
      const err = new Error(`timeout after ${timeoutMs}ms for ${url}`);
      err.transient = true;
      req.destroy(err);
    });
    req.on('error', (err) => { if (err.transient == null) err.transient = true; reject(err); });
    req.end();
  });
}

/** GET and JSON.parse. */
export async function fetchJson(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}

/**
 * Liveness check for the grounding resolver (⚑ §4). Resolves a DOI via doi.org or
 * checks a URL is reachable. Uses HEAD (no body download — avoids pulling a PDF behind
 * a DOI) and never throws; returns boolean.
 */
export async function isResolvable(citation, { fetchTextImpl = fetchText } = {}) {
  const target = citation.doi
    ? `https://doi.org/${String(citation.doi).replace(/^https?:\/\/doi\.org\//, '')}`
    : citation.url;
  if (!target) return false;
  try {
    await fetchTextImpl(target, { method: 'HEAD', maxRetries: 1, timeoutMs: 10_000, headers: { accept: '*/*' } });
    return true;
  } catch (err) {
    if (err?.egressBlocked) return false;
    // A 4xx other than 404/410 (e.g. 403 paywall) still means the resource exists.
    const s = err?.statusCode;
    return s != null && s !== 404 && s !== 410 && s < 500;
  }
}
