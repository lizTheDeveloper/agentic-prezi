import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFindingsDoc, validateCitation, validateFinding } from './schema.mjs';

const goodCitation = { id: 'smith2025', title: 'A Paper', authors: ['Jane Smith'], year: 2025, venue: 'Nature', doi: '10.1/x', url: 'https://doi.org/10.1/x' };

function goodDoc() {
  return {
    topic: 'Topic',
    narrative_outline: ['hook', 'finding', 'implications'],
    findings: [{ claim: 'C', detail: 'D', importance: 4, citations: ['smith2025'] }],
    citations: [structuredClone(goodCitation)],
  };
}

test('validateCitation accepts a complete citation', () => {
  assert.deepEqual(validateCitation(goodCitation), []);
});

test('validateCitation requires id, title, authors[]', () => {
  const errs = validateCitation({ year: 2025 });
  assert.ok(errs.some((e) => e.includes('.id')));
  assert.ok(errs.some((e) => e.includes('.title')));
  assert.ok(errs.some((e) => e.includes('.authors')));
});

test('validateFinding rejects out-of-range importance', () => {
  const errs = validateFinding({ claim: 'c', detail: 'd', importance: 9, citations: ['x'] }, new Set(['x']));
  assert.ok(errs.some((e) => e.includes('importance')));
});

test('validateFinding rejects a citation id not in the citations table (⚑)', () => {
  const errs = validateFinding({ claim: 'c', detail: 'd', importance: 3, citations: ['ghost'] }, new Set(['real']));
  assert.ok(errs.some((e) => e.includes('not present in citations')));
});

test('validateFinding requires at least one citation', () => {
  const errs = validateFinding({ claim: 'c', detail: 'd', importance: 3, citations: [] }, new Set());
  assert.ok(errs.some((e) => e.includes('non-empty')));
});

test('validateFindingsDoc passes a well-formed doc', () => {
  const { valid, errors } = validateFindingsDoc(goodDoc());
  assert.equal(valid, true, errors.join('; '));
});

test('validateFindingsDoc flags duplicate citation ids', () => {
  const doc = goodDoc();
  doc.citations.push(structuredClone(goodCitation));
  const { valid, errors } = validateFindingsDoc(doc);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('duplicate id')));
});

test('empty findings only valid with insufficient_sources flag', () => {
  const doc = goodDoc();
  doc.findings = [];
  assert.equal(validateFindingsDoc(doc).valid, false);
  doc.insufficient_sources = true;
  assert.equal(validateFindingsDoc(doc).valid, true);
});

test('rejects non-boolean insufficient_sources', () => {
  const doc = goodDoc();
  doc.insufficient_sources = 'yes';
  assert.equal(validateFindingsDoc(doc).valid, false);
});
