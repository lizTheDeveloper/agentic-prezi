// Citation canonicalization, dedup, and stable-id minting.
// Pure functions — no I/O — so they unit-test offline (the repo's pure-core pattern).
//
// A "candidate" (adapter output) and a contract "citation" share these fields:
//   { id?, title, authors:[str], year?, venue?, doi?, url?, abstract?, source?, citedByCount?, type? }

/** Normalize a DOI to a bare lowercase `10.x/...` form, stripping any URL/`doi:` prefix. */
export function normalizeDoi(doi) {
  if (!doi || typeof doi !== 'string') return null;
  let d = doi.trim().toLowerCase();
  d = d.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
  d = d.replace(/^doi:\s*/, '');
  return d.startsWith('10.') ? d : null;
}

/** Normalize a title for fuzzy equality: lowercase, strip punctuation, collapse whitespace. */
export function normalizeTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .toLowerCase()
    .replace(/[‘’“”]/g, '') // smart quotes
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Canonical dedup key for a candidate/citation.
 * Prefers DOI (authoritative); falls back to normalized title + year.
 */
export function citationKey(c) {
  const doi = normalizeDoi(c.doi);
  if (doi) return `doi:${doi}`;
  const t = normalizeTitle(c.title);
  return t ? `title:${t}|${c.year ?? '?'}` : null;
}

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'for', 'to', 'de', 'la']);

function firstAuthorSurname(authors) {
  const a = Array.isArray(authors) && authors.length ? authors[0] : '';
  if (!a) return 'anon';
  // "Family, Given" → surname is before the comma; "Given Family" → surname is the last token.
  const beforeComma = a.includes(',') ? a.split(',')[0] : a;
  const tokens = beforeComma.split(/\s+/).filter((t) => t && !STOPWORDS.has(t.toLowerCase()));
  const surname = a.includes(',') ? (tokens[0] || 'anon') : (tokens[tokens.length - 1] || 'anon');
  return surname.toLowerCase().replace(/[^a-z]/g, '') || 'anon';
}

/**
 * Mint a stable, human-readable citation id (e.g. "smith2025"), unique within `taken`.
 * Collisions get a, b, c… suffixes. Mutates nothing; returns the id.
 */
export function makeCitationId(c, taken = new Set()) {
  const base = `${firstAuthorSurname(c.authors)}${c.year ?? 'nd'}`;
  if (!taken.has(base)) return base;
  for (let i = 0; i < 26; i++) {
    const candidate = `${base}${String.fromCharCode(97 + i)}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Extremely unlikely fallthrough.
  let n = 2, candidate;
  do { candidate = `${base}_${n++}`; } while (taken.has(candidate));
  return candidate;
}

/** Merge two records for the same work, preferring richer / more authoritative fields. */
function mergeRecords(a, b) {
  const pick = (x, y) => (x != null && x !== '' ? x : y);
  return {
    ...a,
    ...b,
    title: pick(a.title, b.title),
    authors: (a.authors?.length ?? 0) >= (b.authors?.length ?? 0) ? a.authors : b.authors,
    year: pick(a.year, b.year),
    venue: pick(a.venue, b.venue),
    doi: pick(normalizeDoi(a.doi) && a.doi, b.doi),
    url: pick(a.url, b.url),
    abstract: (a.abstract?.length ?? 0) >= (b.abstract?.length ?? 0) ? a.abstract : b.abstract,
    citedByCount: Math.max(a.citedByCount ?? 0, b.citedByCount ?? 0),
    // Track every source that surfaced this work — drives the §4 adversarial cross-check.
    sources: [...new Set([...(a.sources ?? (a.source ? [a.source] : [])), ...(b.sources ?? (b.source ? [b.source] : []))])],
  };
}

/**
 * Dedup a candidate list by canonical key, merging duplicates.
 * Candidates with no derivable key are kept as-is (can't be safely merged).
 * @returns deduped candidate[]
 */
export function dedupCandidates(candidates) {
  const byKey = new Map();
  const keyless = [];
  for (const c of candidates) {
    const key = citationKey(c);
    if (!key) { keyless.push({ ...c, sources: c.sources ?? (c.source ? [c.source] : []) }); continue; }
    if (byKey.has(key)) byKey.set(key, mergeRecords(byKey.get(key), c));
    else byKey.set(key, { ...c, sources: c.sources ?? (c.source ? [c.source] : []) });
  }
  return [...byKey.values(), ...keyless];
}

/** Project a candidate down to the contract citation shape, assigning a stable id. */
export function toCitation(candidate, id) {
  return {
    id,
    title: candidate.title ?? '',
    authors: Array.isArray(candidate.authors) ? candidate.authors : [],
    year: candidate.year ?? null,
    venue: candidate.venue ?? '',
    doi: normalizeDoi(candidate.doi) ?? '',
    url: candidate.url ?? '',
  };
}
