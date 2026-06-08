// SCAN stage 🛡 (spec §3 / §7.1) — active prompt-injection classifier scan of EVERY ingested
// free-text field BEFORE it can reach any LLM (SYNTHESIZE) or be forwarded to #3.
//
// This is LAYER 2 on top of the structural "content-as-data" defense (§7). Layer 1 (sources as
// data, schema-validated output, cite-only-from-set provenance §4) stays in force regardless — so
// quarantining legitimate text (e.g. a paper *about* prompt injection) only ever costs one source,
// never correctness.
//
// Model (production): Llama Prompt Guard 2 — 22M (`meta-llama/Llama-Prompt-Guard-2-22M`), a small
// self-hosted scorer in the agent/worker plane (§7.1) the Node orchestrator calls over localhost.
// Research content is NEVER sent to a third party for scanning. Here that scorer is DEPENDENCY-
// INJECTED as `scorer(text) → { label?, score }` (score = P(malicious) in [0,1]) so the pipeline
// rules unit-test fully offline (spec §9), and so the active scan is insulated from the build that
// provisions the model (mirrors the §8 LLM insulation).

// Free-text fields carried on a candidate that can hold an injection payload (spec §7.1:
// "title, abstract, extracted body, captions, quotes, web text"). Structured metadata
// (doi/authors/year/url/venue) is NOT model-instruction-shaped and is retained on quarantine.
export const SCANNED_FIELDS = ['title', 'abstract', 'fullText', 'body'];

// ~512 tokens ≈ this many chars (no tokenizer dep; conservative over-estimate keeps windows ≤512).
const DEFAULT_MAX_CHARS = 1800;

/** Conservative default threshold (§7.1: quarantine on doubt). Tunable via budgets/config. */
export const DEFAULT_INJECTION_THRESHOLD = 0.5;

/** Split text into ≤maxChars windows on whitespace boundaries (one classifier call each). */
export function chunkText(text, maxChars = DEFAULT_MAX_CHARS) {
  const s = String(text ?? '');
  if (s.length <= maxChars) return s.trim() ? [s] : [];
  const chunks = [];
  let i = 0;
  while (i < s.length) {
    let end = Math.min(s.length, i + maxChars);
    if (end < s.length) {
      const ws = s.lastIndexOf(' ', end);
      if (ws > i) end = ws;
    }
    const piece = s.slice(i, end);
    if (piece.trim()) chunks.push(piece);
    i = end;
  }
  return chunks;
}

/**
 * Scan one free-text field. Chunks to ≤512-token windows; if ANY window scores at/above the
 * threshold the whole field is malicious (§7.1). Returns { malicious, score } (score = max window).
 */
export async function scanField(text, scorer, { threshold = DEFAULT_INJECTION_THRESHOLD, maxChars = DEFAULT_MAX_CHARS } = {}) {
  let max = 0;
  for (const window of chunkText(text, maxChars)) {
    const res = await scorer(window);
    const score = typeof res?.score === 'number' ? res.score
      : (res?.label === 'MALICIOUS' ? 1 : 0); // tolerate label-only scorers
    if (score > max) max = score;
    if (max >= threshold) return { malicious: true, score: max };
  }
  return { malicious: false, score: max };
}

/**
 * Scan a candidate set (spec §3 SCAN). For each candidate, scan every free-text field; a field that
 * trips the classifier is QUARANTINED — blanked so it can never enter a prompt or reach #3 — while
 * the candidate's structured metadata is retained (§7.1). A title blanked this way leaves a
 * candidate that prepareCitations drops (no usable reference) — the intended fail-safe.
 *
 * @param scorer  REQUIRED async (text) => { label?, score }   (injected; localhost in production)
 * @returns {{ candidates, quarantined, quarantinedSources, scannedSources }}
 *          candidates = sanitized copies; quarantined = [{ id, title, fields:[{field,score}] }]
 */
export async function scanCandidates(candidates, scorer, opts = {}) {
  if (typeof scorer !== 'function') throw new Error('scanCandidates: a scorer function is required');
  const out = [];
  const quarantined = [];
  for (const c of candidates) {
    const fields = [];
    let sanitized = c;
    for (const field of SCANNED_FIELDS) {
      const val = c[field];
      if (typeof val !== 'string' || !val.trim()) continue;
      // eslint-disable-next-line no-await-in-loop
      const { malicious, score } = await scanField(val, scorer, opts);
      if (malicious) {
        if (sanitized === c) sanitized = { ...c }; // copy-on-write; never mutate the input
        sanitized[field] = '';
        fields.push({ field, score });
      }
    }
    out.push(sanitized);
    if (fields.length) quarantined.push({ id: c.id ?? null, title: c.title ?? '', fields });
  }
  return { candidates: out, quarantined, quarantinedSources: quarantined.length, scannedSources: candidates.length };
}

/**
 * Build the default localhost scorer for the self-hosted Prompt Guard 2 service (§7.1). Returns null
 * when no endpoint is configured, so the pipeline transparently runs on layer-1 defenses alone
 * (mirrors makeNousLlm's null-when-unconfigured contract). The HTTP fetch is injectable for tests.
 *
 * @returns { (text)=>Promise<{label,score}> } | null
 */
export function makeLocalScorer(opts = {}) {
  const endpoint = opts.endpoint ?? process.env.PROMPT_GUARD_URL;
  if (!endpoint) return null;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return async (text) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`prompt-guard: HTTP ${res.status}`);
      const json = await res.json();
      return { label: json.label, score: typeof json.score === 'number' ? json.score : undefined };
    } finally {
      clearTimeout(t);
    }
  };
}
