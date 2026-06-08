// Research-input contract (#3 §4) — the ONLY interface between #2 and #3.
// Hand-rolled, stdlib-only validator (no ajv / npm deps, per #0).
//
// Shape:
//   { topic, narrative_outline:[str],
//     findings:[ { claim, detail, importance:1-5, citations:[id], figure? } ],
//     citations:[ { id, title, authors:[str], year, venue, doi, url } ],
//     insufficient_sources?:bool,             // §6 graceful-insufficiency flag
//     quarantined_sources?:int }              // §7.1 count of injection-quarantined sources

const IMPORTANCE_MIN = 1;
const IMPORTANCE_MAX = 5;

function isStr(v) { return typeof v === 'string'; }
function isNonEmptyStr(v) { return isStr(v) && v.trim().length > 0; }
function isInt(v) { return Number.isInteger(v); }

/** Validate a citation object. Returns array of error strings (empty = valid). */
export function validateCitation(c, path = 'citation') {
  const errs = [];
  if (c == null || typeof c !== 'object') return [`${path}: must be an object`];
  if (!isNonEmptyStr(c.id)) errs.push(`${path}.id: required non-empty string`);
  if (!isNonEmptyStr(c.title)) errs.push(`${path}.title: required non-empty string`);
  if (!Array.isArray(c.authors) || !c.authors.every(isStr)) {
    errs.push(`${path}.authors: required string[]`);
  }
  if (c.year != null && !isInt(c.year)) errs.push(`${path}.year: must be an integer if present`);
  // venue/doi/url are optional strings but, when present, must be strings.
  for (const f of ['venue', 'doi', 'url']) {
    if (c[f] != null && !isStr(c[f])) errs.push(`${path}.${f}: must be a string if present`);
  }
  return errs;
}

/** Validate a finding object against the contract. `citationIds` is the Set of declared citation ids. */
export function validateFinding(f, citationIds, path = 'finding') {
  const errs = [];
  if (f == null || typeof f !== 'object') return [`${path}: must be an object`];
  if (!isNonEmptyStr(f.claim)) errs.push(`${path}.claim: required non-empty string`);
  if (!isNonEmptyStr(f.detail)) errs.push(`${path}.detail: required non-empty string`);
  if (!isInt(f.importance) || f.importance < IMPORTANCE_MIN || f.importance > IMPORTANCE_MAX) {
    errs.push(`${path}.importance: integer ${IMPORTANCE_MIN}-${IMPORTANCE_MAX}`);
  }
  if (!Array.isArray(f.citations) || f.citations.length === 0) {
    errs.push(`${path}.citations: required non-empty id[]`);
  } else {
    for (const id of f.citations) {
      if (!isStr(id)) { errs.push(`${path}.citations: ids must be strings`); continue; }
      // Grounding invariant (⚑): every cited id MUST exist in the citations table.
      if (!citationIds.has(id)) errs.push(`${path}.citations: "${id}" not present in citations[]`);
    }
  }
  if (f.figure != null) {
    if (typeof f.figure !== 'object') errs.push(`${path}.figure: must be an object if present`);
    else if (!isStr(f.figure.caption) && !isStr(f.figure.data_or_quote)) {
      errs.push(`${path}.figure: needs caption or data_or_quote`);
    }
  }
  return errs;
}

/**
 * Validate a full findings document against the #3 §4 contract.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateFindingsDoc(doc) {
  const errors = [];
  if (doc == null || typeof doc !== 'object') return { valid: false, errors: ['doc: must be an object'] };

  if (!isNonEmptyStr(doc.topic)) errors.push('topic: required non-empty string');

  if (!Array.isArray(doc.narrative_outline) || !doc.narrative_outline.every(isNonEmptyStr)) {
    errors.push('narrative_outline: required non-empty string[]');
  }

  if (!Array.isArray(doc.citations)) {
    errors.push('citations: required array');
  } else {
    const seen = new Set();
    doc.citations.forEach((c, i) => {
      errors.push(...validateCitation(c, `citations[${i}]`));
      if (c && isStr(c.id)) {
        if (seen.has(c.id)) errors.push(`citations[${i}].id: duplicate id "${c.id}"`);
        seen.add(c.id);
      }
    });
  }

  const citationIds = new Set(
    Array.isArray(doc.citations) ? doc.citations.filter((c) => c && isStr(c.id)).map((c) => c.id) : [],
  );

  if (!Array.isArray(doc.findings)) {
    errors.push('findings: required array');
  } else {
    // §6: an empty findings set is only valid when insufficient_sources is flagged.
    if (doc.findings.length === 0 && doc.insufficient_sources !== true) {
      errors.push('findings: empty without insufficient_sources flag');
    }
    doc.findings.forEach((f, i) => errors.push(...validateFinding(f, citationIds, `findings[${i}]`)));
  }

  if (doc.insufficient_sources != null && typeof doc.insufficient_sources !== 'boolean') {
    errors.push('insufficient_sources: must be a boolean if present');
  }

  // §7.1 transparency: count of sources whose free text was quarantined by the injection scan.
  if (doc.quarantined_sources != null && (!isInt(doc.quarantined_sources) || doc.quarantined_sources < 0)) {
    errors.push('quarantined_sources: must be a non-negative integer if present');
  }

  return { valid: errors.length === 0, errors };
}
