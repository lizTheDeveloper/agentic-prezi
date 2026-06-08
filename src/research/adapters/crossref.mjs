// Crossref adapter — authoritative DOI metadata + resolution, no API key.
// Polite pool via `mailto` query param + User-Agent. https://api.crossref.org/
//
// `parseItems` is pure and unit-tested.

import { fetchJson, CONTACT_EMAIL } from '../http.mjs';

export const name = 'crossref';

function yearOf(item) {
  const parts = item?.issued?.['date-parts']?.[0]
    || item?.published?.['date-parts']?.[0]
    || item?.created?.['date-parts']?.[0];
  const y = Array.isArray(parts) ? parts[0] : null;
  return Number.isInteger(y) ? y : null;
}

function authorsOf(item) {
  return (item?.author || [])
    .map((a) => [a.given, a.family].filter(Boolean).join(' ').trim() || a.name)
    .filter(Boolean);
}

// Crossref abstracts arrive as JATS XML; strip tags for a plain-text snippet.
function cleanAbstract(abstract) {
  if (!abstract || typeof abstract !== 'string') return '';
  return abstract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Pure: Crossref `works` JSON → normalized candidate[]. */
export function parseItems(json) {
  const items = Array.isArray(json?.message?.items) ? json.message.items : [];
  return items.map((it) => ({
    id: it.DOI || (Array.isArray(it.title) ? it.title[0] : it.title),
    title: Array.isArray(it.title) ? (it.title[0] || '') : (it.title || ''),
    authors: authorsOf(it),
    year: yearOf(it),
    venue: Array.isArray(it['container-title']) ? (it['container-title'][0] || '') : '',
    doi: it.DOI || null,
    url: it.URL || (it.DOI ? `https://doi.org/${it.DOI}` : null),
    abstract: cleanAbstract(it.abstract),
    citedByCount: it['is-referenced-by-count'] ?? 0,
    type: it.type || null,
    source: name,
  }));
}

export async function search(query, { perQuery = 10, fetchJsonImpl = fetchJson } = {}) {
  const u = new URL('https://api.crossref.org/works');
  u.searchParams.set('query', query);
  u.searchParams.set('rows', String(perQuery));
  u.searchParams.set('select', 'DOI,title,author,issued,published,created,container-title,URL,abstract,is-referenced-by-count,type');
  u.searchParams.set('mailto', CONTACT_EMAIL);
  return parseItems(await fetchJsonImpl(u.toString()));
}

export async function fetchMeta(doi, { fetchJsonImpl = fetchJson } = {}) {
  const u = `https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=${encodeURIComponent(CONTACT_EMAIL)}`;
  const json = await fetchJsonImpl(u);
  const [c] = parseItems({ message: { items: [json.message] } });
  return c ?? null;
}

export default { name, search, fetchMeta, parseItems };
