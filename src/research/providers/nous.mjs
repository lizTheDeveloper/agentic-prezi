// Nous Portal LLM provider for the research seam (scope + synthesize).
//
// The pipeline injects an `llm` satisfying llm.json({ system, user }) → object
// (see ../llm.mjs). This wires a REAL provider behind that contract using the Nous
// Portal — an OpenAI-compatible aggregator (`POST /v1/chat/completions`, Bearer auth)
// exposing Nous + frontier models. The research key lives in NOUS_RESEARCH_API_KEY;
// the host defaults to the Nous Portal and the model defaults to the most capable Claude
// available there. OpenRouter is the documented secondary `--provider` and speaks the
// same wire shape, so it works by pointing NOUS_RESEARCH_BASE_URL/KEY at it.
//
// Zero npm deps (per #0): direct node:https. Repo pure-core / thin-I/O split:
//   - buildRequestBody / extractCompletionText are PURE and unit-tested offline.
//   - postChat is the injectable I/O layer (network).
//
// Security (§7): retrieved third-party text is UNTRUSTED. The caller passes it as the
// `user` field (data); this provider puts `system` and `user` in separate roles and never
// folds `user` data into the `system` message. Every reply is JSON-extracted + schema-
// validated + grounding-checked downstream, so an injected source can't poison the doc.

import { request } from 'node:https';
import { makeJsonLlm } from '../llm.mjs';

export const DEFAULT_BASE_URL = 'https://inference-api.nousresearch.com/v1';
export const DEFAULT_MODEL = 'anthropic/claude-opus-4.8';
const RETRY_STATUS = new Set([429, 500, 502, 503, 504, 529]);

/**
 * Build the chat/completions request body. `system` and `user` map to distinct message
 * roles (untrusted `user` data is never merged into `system`). `temperature` is omitted
 * unless provided — some portal-proxied models reject it.
 */
export function buildRequestBody({ system, user, model = DEFAULT_MODEL, maxTokens = 8192, temperature }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: String(system) });
  messages.push({ role: 'user', content: String(user ?? '') });
  const body = { model, max_tokens: maxTokens, messages };
  if (typeof temperature === 'number') body.temperature = temperature;
  return body;
}

/**
 * Pure: pull the assistant message text from an OpenAI-compatible chat response. Throws on
 * a malformed or empty reply so the caller (scope/synthesize) falls back to its
 * deterministic path (§8 insulation).
 */
export function extractCompletionText(response) {
  const choice = Array.isArray(response?.choices) ? response.choices[0] : undefined;
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    const reason = choice?.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : '';
    throw new Error(`nous: empty completion${reason}`);
  }
  return content;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * I/O layer: POST a body to {baseUrl}/chat/completions and return the parsed JSON.
 * Retries 429/5xx with exponential backoff (honoring Retry-After). Throws otherwise.
 */
export async function postChat({ baseUrl, apiKey, body, timeoutMs = 180_000, maxRetries = 2 }) {
  let attempt = 0;
  for (;;) {
    try {
      return await postOnce({ baseUrl, apiKey, body, timeoutMs });
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

function postOnce({ baseUrl, apiKey, body, timeoutMs }) {
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        authorization: `Bearer ${apiKey}`,
      },
    }, (res) => {
      const { statusCode } = res;
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (statusCode !== 200) {
          // Truncate the body so an HTML/error page doesn't flood logs (no secrets echoed).
          const err = new Error(`nous: HTTP ${statusCode}: ${raw.slice(0, 300)}`);
          err.statusCode = statusCode;
          const ra = Number(res.headers['retry-after']);
          if (Number.isFinite(ra)) err.retryAfterMs = ra * 1000;
          return reject(err);
        }
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('nous: response was not valid JSON')); }
      });
    });
    req.setTimeout(timeoutMs, () => {
      const err = new Error(`nous: timeout after ${timeoutMs}ms`);
      err.transient = true;
      req.destroy(err);
    });
    req.on('error', (err) => { if (err.transient == null) err.transient = true; reject(err); });
    req.end(payload);
  });
}

/**
 * Construct an `llm` for runResearch({ llm }). Returns null when no key is configured, so
 * the pipeline transparently keeps running on scholarly sources (§8). The HTTP poster is
 * injectable (`post`) for offline tests.
 *
 * @returns { json } | null
 */
export function makeNousLlm(opts = {}) {
  const {
    apiKey = process.env.NOUS_RESEARCH_API_KEY,
    baseUrl = process.env.NOUS_RESEARCH_BASE_URL || DEFAULT_BASE_URL,
    model = process.env.NOUS_RESEARCH_MODEL || DEFAULT_MODEL,
    maxTokens = 8192,
    temperature,
    timeoutMs = 180_000,
    maxRetries = 2,
    post = postChat,
  } = opts;
  if (!apiKey) return null;

  return makeJsonLlm(async ({ system, user }) => {
    const body = buildRequestBody({ system, user, model, maxTokens, temperature });
    const response = await post({ baseUrl, apiKey, body, timeoutMs, maxRetries });
    return extractCompletionText(response);
  });
}
