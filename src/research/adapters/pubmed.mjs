// PubMed adapter — biomedical literature via NCBI E-utilities, no API key required.
// An optional key (env PUBMED_API_KEY, #0 §B5 runtime secret store — never in repo)
// raises the rate limit. https://www.ncbi.nlm.nih.gov/books/NBK25501/
//
// search() is a two-step E-utilities flow: esearch (query → PMIDs) → esummary (PMIDs →
// metadata). `parseSummary` is pure and unit-tested. Credibility weight already present
// in rank.mjs, so this drops in with no pipeline change.

import { fetchJson } from '../http.mjs';

export const name = 'pubmed';
const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

function apiKeyParam(u) {
  const key = process.env.PUBMED_API_KEY;
  if (key) u.searchParams.set('api_key', key);
}

function doiOf(rec) {
  const fromIds = (rec.articleids || []).find((a) => a.idtype === 'doi');
  if (fromIds?.value) return fromIds.value;
  const m = typeof rec.elocationid === 'string' && rec.elocationid.match(/10\.\d{4,9}\/\S+/);
  return m ? m[0] : null;
}

function yearOf(rec) {
  const m = String(rec.pubdate || rec.epubdate || '').match(/\d{4}/);
  return m ? Number(m[0]) : null;
}

/** Pure: esummary `result` JSON → normalized candidate[] (order follows `uids`). */
export function parseSummary(json) {
  const result = json?.result;
  if (!result || !Array.isArray(result.uids)) return [];
  return result.uids.map((uid) => {
    const rec = result[uid];
    if (!rec) return null;
    return {
      id: String(uid),
      title: rec.title || '',
      authors: (rec.authors || []).map((a) => a?.name).filter(Boolean),
      year: yearOf(rec),
      venue: rec.fulljournalname || rec.source || '',
      doi: doiOf(rec),
      url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
      abstract: '', // esummary omits abstracts; efetch would add them (cost guard, §10.5)
      citedByCount: 0,
      type: 'article',
      source: name,
    };
  }).filter(Boolean);
}

/** Pure: esearch JSON → PMID[]. */
export function parseSearchIds(json) {
  const ids = json?.esearchresult?.idlist;
  return Array.isArray(ids) ? ids : [];
}

export async function search(query, { perQuery = 10, fetchJsonImpl = fetchJson } = {}) {
  const su = new URL(`${BASE}/esearch.fcgi`);
  su.searchParams.set('db', 'pubmed');
  su.searchParams.set('term', query);
  su.searchParams.set('retmax', String(perQuery));
  su.searchParams.set('retmode', 'json');
  su.searchParams.set('sort', 'date'); // "latest research" first
  apiKeyParam(su);
  const ids = parseSearchIds(await fetchJsonImpl(su.toString()));
  if (ids.length === 0) return [];

  const eu = new URL(`${BASE}/esummary.fcgi`);
  eu.searchParams.set('db', 'pubmed');
  eu.searchParams.set('id', ids.join(','));
  eu.searchParams.set('retmode', 'json');
  apiKeyParam(eu);
  return parseSummary(await fetchJsonImpl(eu.toString()));
}

export async function fetchMeta(pmid, { fetchJsonImpl = fetchJson } = {}) {
  const eu = new URL(`${BASE}/esummary.fcgi`);
  eu.searchParams.set('db', 'pubmed');
  eu.searchParams.set('id', String(pmid));
  eu.searchParams.set('retmode', 'json');
  apiKeyParam(eu);
  const [c] = parseSummary(await fetchJsonImpl(eu.toString()));
  return c ?? null;
}

export default { name, search, fetchMeta, parseSummary, parseSearchIds };
