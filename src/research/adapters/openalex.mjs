// OpenAlex adapter — cross-domain paper discovery + rich metadata, no API key.
// Polite pool via `mailto`. https://docs.openalex.org/
//
// SourceAdapter interface: { name, search(query, opts) → candidate[], fetchMeta(id) → candidate }
// The `parseWorks` / `reconstructAbstract` functions are pure and unit-tested.

import { fetchJson, CONTACT_EMAIL } from '../http.mjs';

export const name = 'openalex';

/** OpenAlex stores abstracts as an inverted index {word: [positions]}; rebuild the text. */
export function reconstructAbstract(inverted) {
  if (!inverted || typeof inverted !== 'object') return '';
  const slots = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const p of positions) slots[p] = word;
  }
  return slots.filter((w) => w != null).join(' ').trim();
}

function venueOf(work) {
  return work?.primary_location?.source?.display_name
    || work?.host_venue?.display_name
    || '';
}

/** Pure: OpenAlex `works` JSON → normalized candidate[]. */
export function parseWorks(json) {
  const results = Array.isArray(json?.results) ? json.results : [];
  return results.map((w) => ({
    id: w.id || w.doi || w.title,
    title: w.display_name || w.title || '',
    authors: (w.authorships || []).map((a) => a?.author?.display_name).filter(Boolean),
    year: Number.isInteger(w.publication_year) ? w.publication_year : null,
    venue: venueOf(w),
    doi: w.doi || null,
    url: w.doi || w.primary_location?.landing_page_url || w.id || null,
    abstract: reconstructAbstract(w.abstract_inverted_index),
    citedByCount: w.cited_by_count ?? 0,
    type: w.type || null,
    source: name,
  }));
}

export async function search(query, { perQuery = 10, fetchJsonImpl = fetchJson } = {}) {
  const u = new URL('https://api.openalex.org/works');
  u.searchParams.set('search', query);
  u.searchParams.set('per-page', String(perQuery));
  u.searchParams.set('sort', 'relevance_score:desc');
  u.searchParams.set('mailto', CONTACT_EMAIL);
  return parseWorks(await fetchJsonImpl(u.toString()));
}

export async function fetchMeta(id, { fetchJsonImpl = fetchJson } = {}) {
  const path = id.startsWith('http') ? new URL(id).pathname : `/works/${id}`;
  const u = new URL(`https://api.openalex.org${path}`);
  u.searchParams.set('mailto', CONTACT_EMAIL);
  const [c] = parseWorks({ results: [await fetchJsonImpl(u.toString())] });
  return c ?? null;
}

export default { name, search, fetchMeta, parseWorks, reconstructAbstract };
