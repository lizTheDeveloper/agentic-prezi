import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorks, reconstructAbstract } from './openalex.mjs';
import { parseItems } from './crossref.mjs';
import { parseAtom } from './arxiv.mjs';
import openalex from './openalex.mjs';
import crossref from './crossref.mjs';
import arxiv from './arxiv.mjs';

// ---- OpenAlex ----
test('openalex reconstructAbstract rebuilds text from inverted index', () => {
  const inverted = { Deep: [0], learning: [1], works: [2] };
  assert.equal(reconstructAbstract(inverted), 'Deep learning works');
  assert.equal(reconstructAbstract(null), '');
});

test('openalex parseWorks normalizes a work', () => {
  const json = { results: [{
    id: 'https://openalex.org/W1', display_name: 'Attention Is All You Need',
    authorships: [{ author: { display_name: 'A Vaswani' } }, { author: { display_name: 'N Shazeer' } }],
    publication_year: 2017, doi: 'https://doi.org/10.1/transformer',
    primary_location: { source: { display_name: 'NeurIPS' } },
    cited_by_count: 99999, type: 'article',
    abstract_inverted_index: { The: [0], transformer: [1] },
  }] };
  const [c] = parseWorks(json);
  assert.equal(c.title, 'Attention Is All You Need');
  assert.deepEqual(c.authors, ['A Vaswani', 'N Shazeer']);
  assert.equal(c.year, 2017);
  assert.equal(c.venue, 'NeurIPS');
  assert.equal(c.citedByCount, 99999);
  assert.equal(c.abstract, 'The transformer');
  assert.equal(c.source, 'openalex');
});

test('openalex parseWorks tolerates empty/missing results', () => {
  assert.deepEqual(parseWorks({}), []);
  assert.deepEqual(parseWorks({ results: [] }), []);
});

// ---- Crossref ----
test('crossref parseItems normalizes an item and strips JATS abstract', () => {
  const json = { message: { items: [{
    DOI: '10.1/x', title: ['A Study of Things'],
    author: [{ given: 'Jane', family: 'Smith' }, { name: 'Org Author' }],
    issued: { 'date-parts': [[2024, 3]] }, 'container-title': ['Journal of Things'],
    URL: 'https://doi.org/10.1/x', abstract: '<jats:p>Hello <jats:bold>world</jats:bold></jats:p>',
    'is-referenced-by-count': 42, type: 'journal-article',
  }] } };
  const [c] = parseItems(json);
  assert.equal(c.title, 'A Study of Things');
  assert.deepEqual(c.authors, ['Jane Smith', 'Org Author']);
  assert.equal(c.year, 2024);
  assert.equal(c.venue, 'Journal of Things');
  assert.equal(c.doi, '10.1/x');
  assert.equal(c.abstract, 'Hello world');
  assert.equal(c.citedByCount, 42);
  assert.equal(c.source, 'crossref');
});

test('crossref parseItems falls back across date fields', () => {
  const [c] = parseItems({ message: { items: [{ title: ['T'], created: { 'date-parts': [[2019]] } }] } });
  assert.equal(c.year, 2019);
});

// ---- arXiv ----
const ARXIV_FIXTURE = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <title>Latest Advances in Foo</title>
    <summary>We present a study of foo &amp; bar.</summary>
    <published>2024-01-02T00:00:00Z</published>
    <author><name>Ada Lovelace</name></author>
    <author><name>Alan Turing</name></author>
    <arxiv:doi>10.9/foo</arxiv:doi>
  </entry>
</feed>`;

test('arxiv parseAtom extracts entries and decodes entities', () => {
  const [c] = parseAtom(ARXIV_FIXTURE);
  assert.equal(c.id, '2401.00001v1');
  assert.equal(c.title, 'Latest Advances in Foo');
  assert.equal(c.abstract, 'We present a study of foo & bar.');
  assert.equal(c.year, 2024);
  assert.deepEqual(c.authors, ['Ada Lovelace', 'Alan Turing']);
  assert.equal(c.doi, '10.9/foo');
  assert.equal(c.type, 'preprint');
  assert.equal(c.source, 'arxiv');
});

test('arxiv parseAtom returns [] for empty feed', () => {
  assert.deepEqual(parseAtom('<feed></feed>'), []);
  assert.deepEqual(parseAtom(''), []);
});

// ---- search() wiring uses injected fetch (no network) ----
test('openalex.search uses injected fetcher and builds polite URL', async () => {
  let seen;
  const out = await openalex.search('quantum', {
    perQuery: 3,
    fetchJsonImpl: async (url) => { seen = url; return { results: [] }; },
  });
  assert.deepEqual(out, []);
  assert.ok(seen.includes('api.openalex.org'));
  assert.ok(seen.includes('mailto='));
  assert.ok(seen.includes('per-page=3'));
});

test('crossref.search and arxiv.search use injected fetchers', async () => {
  const c = await crossref.search('q', { fetchJsonImpl: async () => ({ message: { items: [] } }) });
  assert.deepEqual(c, []);
  const a = await arxiv.search('q', { fetchTextImpl: async () => '<feed></feed>' });
  assert.deepEqual(a, []);
});
