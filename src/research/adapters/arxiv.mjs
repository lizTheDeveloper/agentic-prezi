// arXiv adapter — preprints (physics/CS/math/quant-bio), strong for "latest research".
// Atom XML API. https://info.arxiv.org/help/api/
//
// `parseAtom` is a pure, dependency-free XML extractor (regex over the well-formed,
// predictable arXiv Atom feed — no XML lib, per #0 stdlib-first). Unit-tested.

import { fetchText } from '../http.mjs';

export const name = 'arxiv';

function tag(xml, t) {
  const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i'));
  return m ? decode(m[1].trim()) : '';
}
function tagAll(xml, t) {
  const re = new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}
function decode(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

/** Pure: arXiv Atom feed (string) → normalized candidate[]. */
export function parseAtom(xml) {
  if (!xml || typeof xml !== 'string') return [];
  return tagAll(xml, 'entry').map((entry) => {
    const idUrl = tag(entry, 'id');
    const arxivId = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, '');
    const published = tag(entry, 'published');
    const year = published ? Number(published.slice(0, 4)) : null;
    const authors = tagAll(entry, 'author').map((a) => tag(a, 'name')).filter(Boolean);
    // arXiv may include a DOI via the arxiv:doi element.
    const doiMatch = entry.match(/<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/i);
    return {
      id: arxivId || idUrl,
      title: tag(entry, 'title'),
      authors,
      year: Number.isInteger(year) ? year : null,
      venue: 'arXiv',
      doi: doiMatch ? decode(doiMatch[1]) : null,
      url: idUrl || (arxivId ? `https://arxiv.org/abs/${arxivId}` : null),
      abstract: tag(entry, 'summary'),
      citedByCount: 0, // arXiv doesn't expose citation counts
      type: 'preprint',
      source: name,
    };
  });
}

export async function search(query, { perQuery = 10, fetchTextImpl = fetchText } = {}) {
  const u = new URL('https://export.arxiv.org/api/query');
  u.searchParams.set('search_query', `all:${query}`);
  u.searchParams.set('start', '0');
  u.searchParams.set('max_results', String(perQuery));
  u.searchParams.set('sortBy', 'submittedDate');
  u.searchParams.set('sortOrder', 'descending');
  return parseAtom(await fetchTextImpl(u.toString(), { headers: { accept: 'application/atom+xml' } }));
}

export async function fetchMeta(id, { fetchTextImpl = fetchText } = {}) {
  const u = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`;
  const [c] = parseAtom(await fetchTextImpl(u, { headers: { accept: 'application/atom+xml' } }));
  return c ?? null;
}

export default { name, search, fetchMeta, parseAtom };
