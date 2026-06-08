// Vision-critique schema + the bounded refine loop (spec §5.1/§5.2).
//
// Two halves, deliberately separated so the engine swap (§11) is a one-line injection:
//   1. validateCritique  — the §5.1 structured-output contract every critic (vision model OR the
//                          offline geometric critic) must satisfy.
//   2. refineLoop        — engine-agnostic loop control: render → critique → revise, bounded by N
//                          iterations + budget, re-rendering ONLY affected stops, never hanging;
//                          on non-convergence it returns the best effort with converged=false.
//
// The default critic is geometricCritique: it reads the SVG compiler's layout report and flags
// real overflow/crowding/missing-citation WITHOUT a browser — so the whole loop runs and unit-tests
// offline. When the Hermes/Playwright spike lands, inject a screenshot+vision critic instead; the
// schema and loop are unchanged.

import { rectsOverlap } from './util.mjs';

export const ISSUE_KINDS = new Set([
  'overflow', 'clipping', 'contrast', 'legibility', 'alignment', 'off-intent', 'citation-missing', 'crowding',
]);
export const SEVERITIES = new Set(['high', 'med', 'low']);

/** Validate one stop's critique against the §5.1 contract. Returns error strings (empty = valid). */
export function validateCritique(c, path = 'critique') {
  const errs = [];
  if (c == null || typeof c !== 'object') return [`${path}: must be an object`];
  if (typeof c.stop !== 'string' || !c.stop.trim()) errs.push(`${path}.stop: required non-empty string`);
  if (typeof c.matches_intent !== 'boolean') errs.push(`${path}.matches_intent: required boolean`);
  if (!Array.isArray(c.issues)) errs.push(`${path}.issues: required array`);
  else c.issues.forEach((iss, i) => {
    const p = `${path}.issues[${i}]`;
    if (iss == null || typeof iss !== 'object') { errs.push(`${p}: must be an object`); return; }
    if (!ISSUE_KINDS.has(iss.kind)) errs.push(`${p}.kind: one of ${[...ISSUE_KINDS].join('|')}`);
    if (!SEVERITIES.has(iss.severity)) errs.push(`${p}.severity: one of ${[...SEVERITIES].join('|')}`);
    if (iss.where != null && typeof iss.where !== 'string') errs.push(`${p}.where: string if present`);
    if (iss.fix_hint != null && typeof iss.fix_hint !== 'string') errs.push(`${p}.fix_hint: string if present`);
  });
  return errs;
}

/** True if a list of critiques contains any high-severity issue. */
export function hasHighSeverity(critiques) {
  return critiques.some((c) => c.issues.some((i) => i.severity === 'high'));
}

/**
 * Browser-free critic: derive §5.1 critiques from the SVG compiler's layout report + the IR.
 * Catches the failure modes the geometry already determines, so the loop is meaningful offline.
 *  - overflow/clipping : a block needs more lines than its scene box fits → HIGH clipping.
 *  - crowding          : more text blocks than the box can comfortably hold.
 *  - citation-missing  : a scene carries a finding's claim but no citation block (per IR cross-ref).
 *  - alignment         : sibling scenes overlap (should be impossible post-layout; guard anyway).
 * @param layout  from compileSvg(ir).layout
 * @param ir      the scene-graph IR (for citation expectations)
 * @param stops   optional list of stop ids to limit critique to (affected-only re-critique)
 */
export function geometricCritique(layout, ir, stops = null) {
  const want = stops ? new Set(stops) : null;
  const expectCitation = citationExpectations(ir);
  const sceneById = new Map(ir.scenes.map((s) => [s.id, s]));
  const out = [];

  for (const rep of layout.scenes) {
    if (want && !want.has(rep.id)) continue;
    const issues = [];
    for (const it of rep.items) {
      if (it.overflow) {
        issues.push({
          kind: 'clipping',
          severity: 'high',
          where: `scene "${rep.id}" ${it.kind}`,
          fix_hint: `text needs ${it.lines} lines but only ${it.fit} fit; shorten text or enlarge the scene`,
        });
      }
    }
    const textBlocks = rep.items.filter((i) => i.kind === 'heading' || i.kind === 'body' || i.kind === 'citation');
    if (textBlocks.length > 6) {
      issues.push({ kind: 'crowding', severity: 'med', where: `scene "${rep.id}"`, fix_hint: 'split into a nested detail scene' });
    }
    if (expectCitation.has(rep.id) && !rep.items.some((i) => i.kind === 'citation')) {
      issues.push({ kind: 'citation-missing', severity: 'high', where: `scene "${rep.id}"`, fix_hint: 'thread the finding citation into this scene' });
    }
    out.push({ stop: rep.id, issues, matches_intent: issues.length === 0 });
  }

  // Global: sibling overlap (alignment). Cheap O(n²) over scenes that share a parent.
  const byParent = new Map();
  for (const s of ir.scenes) {
    const k = s.parent ?? ' root';
    (byParent.get(k) || byParent.set(k, []).get(k)).push(s);
  }
  for (const [, sibs] of byParent) {
    for (let a = 0; a < sibs.length; a++) for (let b = a + 1; b < sibs.length; b++) {
      if (rectsOverlap(sibs[a].bbox, sibs[b].bbox)) {
        const target = out.find((c) => c.stop === sibs[a].id);
        if (target) target.issues.push({ kind: 'alignment', severity: 'high', where: `${sibs[a].id} vs ${sibs[b].id}`, fix_hint: 're-pack siblings' });
      }
    }
  }
  void sceneById;
  return out;
}

// Scenes that present a finding's claim and therefore should carry a citation block.
function citationExpectations(ir) {
  const set = new Set();
  for (const s of ir.scenes) {
    const meta = s._finding; // Compose annotates finding-bearing scenes (non-shipped hint)
    if (meta && Array.isArray(meta.citations) && meta.citations.length) set.add(s.id);
  }
  return set;
}

export const LOOP_DEFAULTS = {
  maxIterations: 4, // §5.2 default N
  maxStops: 24, // §10 cost cap; enforced by Compose, echoed here for the budget record
};

/**
 * Bounded refine loop (§5.2). Pure orchestration over injected stages:
 *   render(ir, affectedStops?) → { layout, ... }     (default: re-compile the SVG)
 *   critic(renderResult, ir, affectedStops?) → critiques[]   (default: geometricCritique)
 *   revise(ir, critiques) → ir'                      (default: deterministicRevise)
 * Stops when no HIGH-severity issues remain or the iteration/budget bound is hit. Always returns a
 * best-effort result — never hangs, never throws on non-convergence (§5.2).
 *
 * @returns { ir, render, critiques, iterations, converged, residualIssues, log }
 */
export async function refineLoop(ir, deps = {}) {
  const maxIterations = deps.maxIterations ?? LOOP_DEFAULTS.maxIterations;
  const render = deps.render;
  const critic = deps.critic;
  const revise = deps.revise;
  const budgetLeft = deps.budget ? makeBudget(deps.budget) : null;

  const log = [];
  let current = ir;
  let renderResult = await render(current, null);
  let critiques = await critic(renderResult, current, null);
  let iterations = 0;

  while (hasHighSeverity(critiques) && iterations < maxIterations) {
    if (budgetLeft && !budgetLeft.ok()) { log.push({ iteration: iterations, stopped: 'budget' }); break; }
    const affected = critiques.filter((c) => c.issues.some((i) => i.severity === 'high')).map((c) => c.stop);
    const revised = await revise(current, critiques);
    if (!revised || revised === current) { log.push({ iteration: iterations, highStops: affected, stopped: 'no-change' }); break; }
    current = revised;
    iterations++;
    // `affected` is a hint: an expensive Playwright renderer re-shoots only those stops (§5.2);
    // the default compiler is cheap enough to recompile the whole doc. Either way we re-critique
    // the full deck so a fix that shifts a neighbour can't slip through.
    renderResult = await render(current, affected);
    critiques = await critic(renderResult, current, null);
    log.push({ iteration: iterations, highStops: affected });
  }

  const converged = !hasHighSeverity(critiques);
  const residualIssues = critiques.flatMap((c) => c.issues.map((i) => ({ stop: c.stop, ...i })));
  return { ir: current, render: renderResult, critiques, iterations, converged, residualIssues, log };
}

function makeBudget({ wallClockMs, startedAt = Date.now() }) {
  return { ok: () => (wallClockMs == null ? true : Date.now() - startedAt < wallClockMs) };
}
