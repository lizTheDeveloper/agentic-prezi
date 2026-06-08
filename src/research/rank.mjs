// RANK/FILTER stage (pipeline §3): score candidates by recency, credibility, and
// citation impact, then cap to top-K. Pure functions — unit-tested offline.
//
// Open item §10.1 (per-domain weights) is exposed as `weights` so planning can tune it.

export const DEFAULT_WEIGHTS = {
  recency: 0.45,     // "latest research" is the product promise — weight it high
  credibility: 0.35, // peer-reviewed > preprint > web
  impact: 0.20,      // citation count (log-damped)
};

// Credibility by source/type. Higher = more authoritative.
const CREDIBILITY = {
  crossref: 1.0,     // resolved DOI / published record
  pubmed: 1.0,
  openalex: 0.85,    // aggregated metadata; usually peer-reviewed but mixed
  arxiv: 0.6,        // preprint — strong for "latest" but not peer-reviewed
  hermes: 0.35,      // general web — enrichment, not citation authority
  web: 0.35,
};

function credibilityScore(c) {
  // An explicit work type can override the source default (e.g. OpenAlex 'preprint').
  if (c.type && /preprint/i.test(c.type)) return CREDIBILITY.arxiv;
  const sources = c.sources ?? (c.source ? [c.source] : []);
  let best = 0;
  for (const s of sources) best = Math.max(best, CREDIBILITY[String(s).toLowerCase()] ?? 0.3);
  return best || 0.3;
}

// Recency: 1.0 this year, decaying ~linearly over a 10-year window, floored at 0.
function recencyScore(year, nowYear) {
  if (!Number.isInteger(year)) return 0.2; // unknown date — mild penalty, not zero
  const age = nowYear - year;
  if (age <= 0) return 1.0;
  return Math.max(0, 1 - age / 10);
}

// Impact: log-damped citation count, normalized into ~[0,1].
function impactScore(citedByCount) {
  const n = Math.max(0, citedByCount ?? 0);
  return Math.min(1, Math.log10(n + 1) / 3); // 1000 cites ≈ 1.0
}

/** Score a single candidate in [0,1]. */
export function scoreCandidate(c, { nowYear, weights = DEFAULT_WEIGHTS } = {}) {
  const y = nowYear ?? new Date().getUTCFullYear();
  const r = recencyScore(c.year, y);
  const cr = credibilityScore(c);
  const im = impactScore(c.citedByCount);
  return weights.recency * r + weights.credibility * cr + weights.impact * im;
}

/**
 * Score, sort (desc), and cap to top-K. Returns candidates with an attached `_score`.
 * Stable tie-break by citedByCount then title so output is deterministic.
 */
export function rankAndCap(candidates, { topK = 20, nowYear, weights = DEFAULT_WEIGHTS } = {}) {
  const scored = candidates.map((c) => ({ ...c, _score: scoreCandidate(c, { nowYear, weights }) }));
  scored.sort((a, b) =>
    b._score - a._score ||
    (b.citedByCount ?? 0) - (a.citedByCount ?? 0) ||
    String(a.title).localeCompare(String(b.title)));
  return scored.slice(0, topK);
}
