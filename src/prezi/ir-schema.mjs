// Scene-graph IR validator (spec §3) — the internal contract Compose → Generate → Vision loop
// all operate on. Hand-rolled, stdlib-only (no ajv / npm deps, per #0). A published-safe schema:
// invalid IR must never reach the SVG compiler.
//
// Shape:
//   { canvas:{width,height},
//     scenes:[ { id, parent, bbox:{x,y,w,h}, intent, blocks:[ block ] } ],
//     tour:[ { scene, transition, holdMs? } ],
//     citations:[ { id, title, authors:[str], year?, venue?, doi?, url? } ] }
//
// Block types: heading{text} | body{text} | shape{svg} | image{assetId,alt} | citation{refId}

import { rectContains, rectsOverlap } from './util.mjs';
import { checkShapeSvg } from './shape-guard.mjs';

export const IR_DEFAULTS = {
  maxScenes: 40, // §10 cost cap: stops ≈ scenes; bound it
  maxDepth: 3, // nesting cap (over-nesting is rejected, not silently flattened)
  maxBlocksPerScene: 12,
};

const BLOCK_TYPES = new Set(['heading', 'body', 'shape', 'image', 'citation']);
const TRANSITIONS = new Set(['zoom', 'pan', 'cut']);

function isStr(v) { return typeof v === 'string'; }
function isNonEmptyStr(v) { return isStr(v) && v.trim().length > 0; }
function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function isPosNum(v) { return isFiniteNum(v) && v > 0; }
function isInt(v) { return Number.isInteger(v); }

function validateBbox(b, path, errs) {
  if (b == null || typeof b !== 'object') { errs.push(`${path}: bbox must be an object`); return false; }
  let ok = true;
  for (const k of ['x', 'y']) if (!isFiniteNum(b[k])) { errs.push(`${path}.${k}: finite number required`); ok = false; }
  for (const k of ['w', 'h']) if (!isPosNum(b[k])) { errs.push(`${path}.${k}: positive number required`); ok = false; }
  return ok;
}

function validateBlock(block, path, citationIds, assetIds, errs) {
  if (block == null || typeof block !== 'object') { errs.push(`${path}: block must be an object`); return; }
  if (!BLOCK_TYPES.has(block.type)) { errs.push(`${path}.type: one of ${[...BLOCK_TYPES].join('|')}`); return; }
  switch (block.type) {
    case 'heading':
    case 'body':
      if (!isNonEmptyStr(block.text)) errs.push(`${path}.text: required non-empty string`);
      break;
    case 'shape': {
      // Trust boundary (§3/§9): shape SVG is emitted verbatim, so it must pass the fail-closed
      // allowlist — inert vector geometry only, never script/handlers/external refs. This holds
      // whether the fragment came from Compose's templates or (later) an untrusted agent.
      if (!isNonEmptyStr(block.svg)) { errs.push(`${path}.svg: required non-empty string`); break; }
      const verdict = checkShapeSvg(block.svg);
      if (!verdict.safe) errs.push(`${path}.svg: unsafe shape rejected (${verdict.reason})`);
      break;
    }
    case 'image':
      if (!isNonEmptyStr(block.assetId)) errs.push(`${path}.assetId: required non-empty string`);
      else if (assetIds && !assetIds.has(block.assetId)) errs.push(`${path}.assetId: "${block.assetId}" not in assets`);
      if (!isNonEmptyStr(block.alt)) errs.push(`${path}.alt: required (accessibility, §3)`);
      break;
    case 'citation':
      if (!isNonEmptyStr(block.refId)) errs.push(`${path}.refId: required non-empty string`);
      else if (!citationIds.has(block.refId)) errs.push(`${path}.refId: "${block.refId}" not present in citations[]`);
      break;
  }
}

/** Validate a citation (same shape as the research §4 contract). */
export function validateIrCitation(c, path) {
  const errs = [];
  if (c == null || typeof c !== 'object') return [`${path}: must be an object`];
  if (!isNonEmptyStr(c.id)) errs.push(`${path}.id: required non-empty string`);
  if (!isNonEmptyStr(c.title)) errs.push(`${path}.title: required non-empty string`);
  if (!Array.isArray(c.authors) || !c.authors.every(isStr)) errs.push(`${path}.authors: required string[]`);
  if (c.year != null && !isInt(c.year)) errs.push(`${path}.year: integer if present`);
  for (const f of ['venue', 'doi', 'url']) if (c[f] != null && !isStr(c[f])) errs.push(`${path}.${f}: string if present`);
  return errs;
}

/**
 * Validate a full scene-graph IR.
 * @param ir          the IR document
 * @param opts        { caps?, assetIds?:Set } caps override IR_DEFAULTS
 * @returns {{ valid:boolean, errors:string[] }}
 */
export function validateIr(ir, opts = {}) {
  const caps = { ...IR_DEFAULTS, ...(opts.caps || {}) };
  const assetIds = opts.assetIds || null;
  const errors = [];
  if (ir == null || typeof ir !== 'object') return { valid: false, errors: ['ir: must be an object'] };

  // canvas
  if (ir.canvas == null || typeof ir.canvas !== 'object') errors.push('canvas: required object');
  else {
    if (!isPosNum(ir.canvas.width)) errors.push('canvas.width: positive number required');
    if (!isPosNum(ir.canvas.height)) errors.push('canvas.height: positive number required');
  }

  // citations table (validate first; scenes reference it)
  const citationIds = new Set();
  if (!Array.isArray(ir.citations)) {
    errors.push('citations: required array');
  } else {
    ir.citations.forEach((c, i) => {
      errors.push(...validateIrCitation(c, `citations[${i}]`));
      if (c && isStr(c.id)) {
        if (citationIds.has(c.id)) errors.push(`citations[${i}].id: duplicate "${c.id}"`);
        citationIds.add(c.id);
      }
    });
  }

  // scenes
  if (!Array.isArray(ir.scenes) || ir.scenes.length === 0) {
    errors.push('scenes: required non-empty array');
    return { valid: errors.length === 0, errors };
  }
  if (ir.scenes.length > caps.maxScenes) errors.push(`scenes: ${ir.scenes.length} exceeds cap ${caps.maxScenes}`);

  const byId = new Map();
  for (let i = 0; i < ir.scenes.length; i++) {
    const s = ir.scenes[i];
    const path = `scenes[${i}]`;
    if (s == null || typeof s !== 'object') { errors.push(`${path}: must be an object`); continue; }
    if (!isNonEmptyStr(s.id)) errors.push(`${path}.id: required non-empty string`);
    else if (byId.has(s.id)) errors.push(`${path}.id: duplicate "${s.id}"`);
    else byId.set(s.id, s);
    if (!(s.parent === null || isNonEmptyStr(s.parent))) errors.push(`${path}.parent: null or a scene id`);
    if (!isNonEmptyStr(s.intent)) errors.push(`${path}.intent: required non-empty string`);
    validateBbox(s.bbox, `${path}.bbox`, errors);
    if (!Array.isArray(s.blocks)) errors.push(`${path}.blocks: required array`);
    else {
      if (s.blocks.length > caps.maxBlocksPerScene) errors.push(`${path}.blocks: ${s.blocks.length} exceeds cap ${caps.maxBlocksPerScene}`);
      s.blocks.forEach((b, j) => validateBlock(b, `${path}.blocks[${j}]`, citationIds, assetIds, errors));
    }
  }

  // Parent links: existence, no self-parent, no cycles, depth cap, geometric containment.
  const depthOf = new Map();
  function depth(id, seen = new Set()) {
    if (depthOf.has(id)) return depthOf.get(id);
    const s = byId.get(id);
    if (!s) return 0;
    if (s.parent === null) { depthOf.set(id, 0); return 0; }
    if (seen.has(id)) return Infinity; // cycle
    seen.add(id);
    const d = 1 + depth(s.parent, seen);
    depthOf.set(id, d);
    return d;
  }
  for (const [id, s] of byId) {
    if (s.parent === null) continue;
    if (s.parent === id) { errors.push(`scene "${id}": cannot be its own parent`); continue; }
    const parent = byId.get(s.parent);
    if (!parent) { errors.push(`scene "${id}": parent "${s.parent}" does not exist`); continue; }
    const d = depth(id);
    if (!Number.isFinite(d)) { errors.push(`scene "${id}": parent cycle detected`); continue; }
    if (d > caps.maxDepth) errors.push(`scene "${id}": nesting depth ${d} exceeds cap ${caps.maxDepth}`);
    // A child must live INSIDE its parent's bbox (the Prezi zoom-into-detail invariant).
    if (parent.bbox && s.bbox && !rectContains(parent.bbox, s.bbox)) {
      errors.push(`scene "${id}": bbox is not contained within parent "${s.parent}"`);
    }
  }

  // Siblings (same parent) must not overlap; top-level scenes treated as siblings under root.
  const NO_PARENT = Symbol("no-parent"); // collision-proof key for top-level scenes (a string id can never equal a Symbol)
  const groups = new Map();
  for (const [id, s] of byId) {
    const key = s.parent ?? NO_PARENT;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push([id, s]);
  }
  for (const [, sibs] of groups) {
    for (let a = 0; a < sibs.length; a++) {
      for (let b = a + 1; b < sibs.length; b++) {
        if (sibs[a][1].bbox && sibs[b][1].bbox && rectsOverlap(sibs[a][1].bbox, sibs[b][1].bbox)) {
          errors.push(`scenes "${sibs[a][0]}" and "${sibs[b][0]}" overlap (siblings must not)`);
        }
      }
    }
  }

  // Top-level scenes must fit the canvas.
  if (ir.canvas && isPosNum(ir.canvas.width) && isPosNum(ir.canvas.height)) {
    const canvasBox = { x: 0, y: 0, w: ir.canvas.width, h: ir.canvas.height };
    for (const [id, s] of byId) {
      if (s.parent === null && s.bbox && !rectContains(canvasBox, s.bbox)) {
        errors.push(`scene "${id}": bbox exceeds canvas bounds`);
      }
    }
  }

  // tour
  if (!Array.isArray(ir.tour) || ir.tour.length === 0) {
    errors.push('tour: required non-empty array');
  } else {
    ir.tour.forEach((stop, i) => {
      const p = `tour[${i}]`;
      if (stop == null || typeof stop !== 'object') { errors.push(`${p}: must be an object`); return; }
      if (!isNonEmptyStr(stop.scene)) errors.push(`${p}.scene: required scene id`);
      else if (!byId.has(stop.scene)) errors.push(`${p}.scene: "${stop.scene}" is not a scene`);
      if (stop.transition != null && !TRANSITIONS.has(stop.transition)) {
        errors.push(`${p}.transition: one of ${[...TRANSITIONS].join('|')}`);
      }
      if (stop.holdMs != null && (!isFiniteNum(stop.holdMs) || stop.holdMs < 0)) {
        errors.push(`${p}.holdMs: non-negative number if present`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}
