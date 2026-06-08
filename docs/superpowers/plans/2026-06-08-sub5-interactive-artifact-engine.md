# Interactive Artifact Layer — Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interaction layer to the #3 presentation generator so published Prezi decks can carry agent-proposed reveal / multiple-choice / branching / free-text interactions that run client-side, fully static and CSP-clean — while a zero-interaction deck stays identical to today.

**Architecture:** A new offline-deterministic `INTERACTIVIZE` stage (`interactivize.mjs`) proposes a schema-validated `interactions` set from the scene-graph IR; an injectable agent can replace it. `generatePresentation` writes `interactions.json`, inlines it into `index.html` (same pattern as `camera.json`, so no fetch is needed under `connect-src 'none'`), and conditionally ships an interaction runtime. The runtime keeps pure logic (`runtime/interactions-logic.mjs`, unit-tested) separate from DOM glue (`runtime/interactions.mjs`, like `player.mjs`). All four primitives run in **public self-check mode** — nothing recorded, no network (response capture is sub-project #6, a separate plan).

**Tech Stack:** Node ≥26, ESM `.mjs`, `node:test` + `node:assert/strict` (run via `npm test` → `node --test`). Stdlib only, zero npm deps (per #0). Browser runtime is dependency-free vanilla JS shipped as static assets.

**Scope note:** This plan covers the **#5 engine** subsystem (spec §1–§5, §8–§10). The **instructor refine editor + persistence** (spec §6–§7) and the **#2→#3→#1 worker wiring** are out of scope here — they get their own plan. After this plan, `npm run generate -- --interactive …` produces a playable interactive deck; the #1 worker still emits the stub (unchanged).

**Reference:** spec `docs/superpowers/specs/2026-06-08-sub5-interactive-artifact-layer-design.md`. Files extended: `src/prezi/{generate,manifest,cli}.mjs`, `src/prezi/runtime/player.mjs`. Files created: `src/prezi/interactions-schema.mjs`, `src/prezi/interactivize.mjs`, `src/prezi/runtime/interactions-logic.mjs`, `src/prezi/runtime/interactions.mjs` (+ tests).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/prezi/interactions-schema.mjs` (new) | Validate an `interactions.json` doc against the IR (types, stable-id uniqueness, `stop`/`goto` referential integrity, per-type rules, caps). Stdlib, mirrors `ir-schema.mjs`. |
| `src/prezi/interactivize.mjs` (new) | The INTERACTIVIZE stage: default = empty (regression-safe); `deterministicInteractivize(ir)` opt-in derives reveals for nested scenes; validates + **drops** invalid proposals, returns `{ interactions, dropped }`. |
| `src/prezi/runtime/interactions-logic.mjs` (new) | Pure, unit-tested runtime logic: index interactions by stop, resolve a branch `goto` → stop index, grade an MCQ selection. No DOM. |
| `src/prezi/runtime/interactions.mjs` (new) | DOM glue: an overlay panel that renders the current stop's interactions and runs reveal/mcq/branch/freetext client-side. CSP-clean (no inline handlers, no `eval`). Untested by convention (like `player.mjs`). |
| `src/prezi/runtime/player.mjs` (modify) | After camera init, dynamic-import the interaction runtime **only when** an `interactions-data` element exists; notify it on each stop change; expose `go(index)` for branching. |
| `src/prezi/generate.mjs` (modify) | Run INTERACTIVIZE; when interactions exist, write `interactions.json`, inline it into `index.html`, ship the interaction runtime files, and add a manifest summary. Log dropped interactions to `quality`. |
| `src/prezi/manifest.mjs` (modify) | `buildManifest` accepts an optional `interactions` summary and includes it only when present. |
| `src/prezi/cli.mjs` (modify) | `--interactive` flag wires `deterministicInteractivize` for demos. |

---

## Task 1: Interaction schema validator

**Files:**
- Create: `src/prezi/interactions-schema.mjs`
- Test: `src/prezi/interactions-schema.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// src/prezi/interactions-schema.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInteractions, INTERACTIONS_DEFAULTS } from './interactions-schema.mjs';

// IR context the validator checks references against: which stops/scenes exist.
const ctx = { stopIds: new Set(['intro', 'f1', 'f1.detail']), sceneIds: new Set(['intro', 'f1', 'f1.detail']) };

function doc(interactions) { return { schemaVersion: 1, interactions }; }

test('a valid interactions doc passes', () => {
  const d = doc([
    { id: 'intro.q1', stop: 'intro', type: 'mcq', prompt: 'Which?',
      config: { options: [{ text: 'A', correct: false }, { text: 'B', correct: true }], multiSelect: false } },
    { id: 'intro.r1', stop: 'intro', type: 'reveal', prompt: 'Show', config: { target: '#g', reveal: '<g/>' } },
    { id: 'f1.b1', stop: 'f1', type: 'branch', prompt: 'Go?',
      config: { choices: [{ text: 'Detail', goto: 'f1.detail' }, { text: 'Stay', goto: 'f1' }] } },
    { id: 'f1.ft1', stop: 'f1', type: 'freetext', prompt: 'Why?', config: { modelAnswer: 'Because…' } },
  ]);
  const { valid, errors } = validateInteractions(d, ctx);
  assert.equal(valid, true, errors.join('\n'));
});

test('unknown type is rejected', () => {
  const { valid, errors } = validateInteractions(doc([{ id: 'x.1', stop: 'intro', type: 'poll', prompt: 'p', config: {} }]), ctx);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('type')));
});

test('duplicate id is rejected', () => {
  const { valid, errors } = validateInteractions(doc([
    { id: 'intro.q1', stop: 'intro', type: 'reveal', prompt: 'a', config: { target: '#g', reveal: '<g/>' } },
    { id: 'intro.q1', stop: 'intro', type: 'reveal', prompt: 'b', config: { target: '#h', reveal: '<g/>' } },
  ]), ctx);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('duplicate')));
});

test('stop must reference an existing stop', () => {
  const { valid, errors } = validateInteractions(doc([
    { id: 'z.1', stop: 'nope', type: 'reveal', prompt: 'a', config: { target: '#g', reveal: '<g/>' } },
  ]), ctx);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('stop')));
});

test('branch goto must reference an existing scene', () => {
  const { valid, errors } = validateInteractions(doc([
    { id: 'f1.b1', stop: 'f1', type: 'branch', prompt: 'g', config: { choices: [{ text: 'X', goto: 'ghost' }] } },
  ]), ctx);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('goto')));
});

test('mcq must have at least one correct option and in-range', () => {
  const none = validateInteractions(doc([
    { id: 'q.1', stop: 'intro', type: 'mcq', prompt: 'p', config: { options: [{ text: 'A', correct: false }] } },
  ]), ctx);
  assert.equal(none.valid, false);
  assert.ok(none.errors.some((e) => e.includes('correct')));
});

test('freetext requires a modelAnswer (self-check, no grading)', () => {
  const { valid, errors } = validateInteractions(doc([
    { id: 'ft.1', stop: 'intro', type: 'freetext', prompt: 'p', config: {} },
  ]), ctx);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('modelAnswer')));
});

test('exceeding the per-deck cap is flagged', () => {
  const many = Array.from({ length: INTERACTIONS_DEFAULTS.maxPerDeck + 1 }, (_, i) => ({
    id: `intro.r${i}`, stop: 'intro', type: 'reveal', prompt: 'a', config: { target: '#g', reveal: '<g/>' },
  }));
  const { valid, errors } = validateInteractions(doc(many), ctx);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('exceeds')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/prezi/interactions-schema.test.mjs`
Expected: FAIL — `Cannot find module './interactions-schema.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/prezi/interactions-schema.mjs
// interactions.json validator (spec §3). Stdlib-only, mirrors ir-schema.mjs. A published-safe
// schema: invalid interactions must never reach the artifact. Validated against the IR so every
// `stop` and branch `goto` references a real scene/stop (referential integrity, §8).
//
// Shape: { schemaVersion, interactions: [ { id, stop, type, prompt, config } ] }
//   type: reveal   { target, reveal }
//   type: mcq      { options:[{text, correct?, feedback?}], multiSelect? }
//   type: branch   { choices:[{text, goto}] }
//   type: freetext { modelAnswer, rubric?:string[] }   // self-check only — NO grading in #5

export const INTERACTIONS_DEFAULTS = {
  maxPerDeck: 60,   // §10 cost/clutter cap across the whole deck
  maxPerStop: 4,    // §12 open item — keep a stop uncluttered
};

const TYPES = new Set(['reveal', 'mcq', 'branch', 'freetext']);

function isStr(v) { return typeof v === 'string'; }
function isNonEmptyStr(v) { return isStr(v) && v.trim().length > 0; }

function validateOne(it, path, ctx, errs) {
  if (it == null || typeof it !== 'object') { errs.push(`${path}: must be an object`); return; }
  if (!isNonEmptyStr(it.id)) errs.push(`${path}.id: required non-empty string`);
  if (!isNonEmptyStr(it.prompt)) errs.push(`${path}.prompt: required non-empty string`);
  if (!TYPES.has(it.type)) { errs.push(`${path}.type: one of ${[...TYPES].join('|')}`); return; }
  if (!isNonEmptyStr(it.stop)) errs.push(`${path}.stop: required scene/stop id`);
  else if (ctx.stopIds && !ctx.stopIds.has(it.stop)) errs.push(`${path}.stop: "${it.stop}" is not a stop in this presentation`);
  const cfg = it.config;
  if (cfg == null || typeof cfg !== 'object') { errs.push(`${path}.config: required object`); return; }

  switch (it.type) {
    case 'reveal':
      if (!isNonEmptyStr(cfg.target)) errs.push(`${path}.config.target: required selector string`);
      if (!isNonEmptyStr(cfg.reveal)) errs.push(`${path}.config.reveal: required content string`);
      break;
    case 'mcq': {
      if (!Array.isArray(cfg.options) || cfg.options.length < 2) { errs.push(`${path}.config.options: ≥2 required`); break; }
      let correct = 0;
      cfg.options.forEach((o, i) => {
        if (o == null || typeof o !== 'object') { errs.push(`${path}.config.options[${i}]: object required`); return; }
        if (!isNonEmptyStr(o.text)) errs.push(`${path}.config.options[${i}].text: required`);
        if (o.correct != null && typeof o.correct !== 'boolean') errs.push(`${path}.config.options[${i}].correct: boolean`);
        if (o.feedback != null && !isStr(o.feedback)) errs.push(`${path}.config.options[${i}].feedback: string`);
        if (o.correct === true) correct++;
      });
      if (correct < 1) errs.push(`${path}.config: mcq needs ≥1 correct option`);
      if (cfg.multiSelect != null && typeof cfg.multiSelect !== 'boolean') errs.push(`${path}.config.multiSelect: boolean`);
      break;
    }
    case 'branch':
      if (!Array.isArray(cfg.choices) || cfg.choices.length < 2) { errs.push(`${path}.config.choices: ≥2 required`); break; }
      cfg.choices.forEach((c, i) => {
        if (c == null || typeof c !== 'object') { errs.push(`${path}.config.choices[${i}]: object required`); return; }
        if (!isNonEmptyStr(c.text)) errs.push(`${path}.config.choices[${i}].text: required`);
        if (!isNonEmptyStr(c.goto)) errs.push(`${path}.config.choices[${i}].goto: required scene/stop id`);
        else if (ctx.sceneIds && !ctx.sceneIds.has(c.goto)) errs.push(`${path}.config.choices[${i}].goto: "${c.goto}" is not a scene`);
      });
      break;
    case 'freetext':
      if (!isNonEmptyStr(cfg.modelAnswer)) errs.push(`${path}.config.modelAnswer: required (self-check answer; no grading in #5)`);
      if (cfg.rubric != null && (!Array.isArray(cfg.rubric) || !cfg.rubric.every(isStr))) errs.push(`${path}.config.rubric: string[] if present`);
      break;
  }
}

/**
 * Validate an interactions doc against the IR.
 * @param doc  { schemaVersion, interactions[] }
 * @param ctx  { stopIds:Set<string>, sceneIds:Set<string>, caps? }
 * @returns {{ valid:boolean, errors:string[] }}
 */
export function validateInteractions(doc, ctx = {}) {
  const caps = { ...INTERACTIONS_DEFAULTS, ...(ctx.caps || {}) };
  const errors = [];
  if (doc == null || typeof doc !== 'object') return { valid: false, errors: ['doc: must be an object'] };
  if (!Array.isArray(doc.interactions)) return { valid: false, errors: ['interactions: required array'] };

  if (doc.interactions.length > caps.maxPerDeck) errors.push(`interactions: ${doc.interactions.length} exceeds cap ${caps.maxPerDeck}`);

  const ids = new Set();
  const perStop = new Map();
  doc.interactions.forEach((it, i) => {
    validateOne(it, `interactions[${i}]`, ctx, errors);
    if (it && isStr(it.id)) {
      if (ids.has(it.id)) errors.push(`interactions[${i}].id: duplicate "${it.id}"`);
      ids.add(it.id);
    }
    if (it && isStr(it.stop)) perStop.set(it.stop, (perStop.get(it.stop) || 0) + 1);
  });
  for (const [stop, n] of perStop) if (n > caps.maxPerStop) errors.push(`stop "${stop}": ${n} interactions exceeds per-stop cap ${caps.maxPerStop}`);

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/prezi/interactions-schema.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/prezi/interactions-schema.mjs src/prezi/interactions-schema.test.mjs
git commit -m "feat(#5): interactions.json schema validator (referential integrity + caps)"
```

---

## Task 2: INTERACTIVIZE stage

**Files:**
- Create: `src/prezi/interactivize.mjs`
- Test: `src/prezi/interactivize.test.mjs`

The default is **empty** (so a deck with no injected proposer is identical to today — the regression guard in Task 6). `deterministicInteractivize` is an opt-in, offline proposer that derives a `reveal` per nested (child) scene — meaningful, deterministic, and schema-valid. Any proposer's output is validated; invalid items are **dropped** and reported (spec §8).

- [ ] **Step 1: Write the failing test**

```js
// src/prezi/interactivize.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interactivize, deterministicInteractivize } from './interactivize.mjs';
import { validateInteractions } from './interactions-schema.mjs';

// Minimal IR with a nested detail scene and a 2-stop tour.
const ir = {
  canvas: { width: 1000, height: 1000 },
  scenes: [
    { id: 'intro', parent: null, intent: 'hook', bbox: { x: 0, y: 0, w: 400, h: 400 }, blocks: [] },
    { id: 'f1', parent: null, intent: 'finding 1', bbox: { x: 500, y: 0, w: 400, h: 400 }, blocks: [] },
    { id: 'f1.detail', parent: 'f1', intent: 'detail', bbox: { x: 520, y: 20, w: 200, h: 200 }, blocks: [] },
  ],
  tour: [{ scene: 'intro' }, { scene: 'f1' }, { scene: 'f1.detail' }],
  citations: [],
};
const ctx = { stopIds: new Set(ir.tour.map((t) => t.scene)), sceneIds: new Set(ir.scenes.map((s) => s.id)) };

test('default interactivize proposes nothing (regression-safe)', async () => {
  const { interactions, dropped } = await interactivize(ir);
  assert.deepEqual(interactions, []);
  assert.equal(dropped.length, 0);
});

test('deterministicInteractivize proposes a valid reveal for each nested scene', async () => {
  const { interactions } = await interactivize(ir, { propose: deterministicInteractivize });
  assert.ok(interactions.length >= 1);
  assert.ok(interactions.every((it) => it.type === 'reveal'));
  const { valid, errors } = validateInteractions({ schemaVersion: 1, interactions }, ctx);
  assert.equal(valid, true, errors.join('\n'));
});

test('invalid proposed interactions are dropped, valid ones kept', async () => {
  const propose = () => ([
    { id: 'good.1', stop: 'intro', type: 'reveal', prompt: 'ok', config: { target: '#g', reveal: '<g/>' } },
    { id: 'bad.1', stop: 'ghost-stop', type: 'reveal', prompt: 'bad', config: { target: '#g', reveal: '<g/>' } },
  ]);
  const { interactions, dropped } = await interactivize(ir, { propose });
  assert.deepEqual(interactions.map((i) => i.id), ['good.1']);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].id, 'bad.1');
});

test('proposals are truncated to the per-deck cap', async () => {
  const propose = () => Array.from({ length: 100 }, (_, i) => ({
    id: `intro.r${i}`, stop: 'intro', type: 'reveal', prompt: 'a', config: { target: '#g', reveal: '<g/>' },
  }));
  const { interactions } = await interactivize(ir, { propose, caps: { maxPerDeck: 5, maxPerStop: 100 } });
  assert.equal(interactions.length, 5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/prezi/interactivize.test.mjs`
Expected: FAIL — `Cannot find module './interactivize.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/prezi/interactivize.mjs
// INTERACTIVIZE stage (spec §5): propose an interaction layer aligned to scene intent, then
// validate + drop anything invalid (§8). Engine-agnostic, mirroring compose.mjs: the default
// proposes NOTHING (so a deck is identical to today unless a proposer is injected), and an
// optional `propose` fn (an agent, or `deterministicInteractivize`) supplies candidates.

import { validateInteractions, INTERACTIONS_DEFAULTS } from './interactions-schema.mjs';

/** Opt-in offline proposer: one reveal per nested (child) scene — deterministic and schema-valid. */
export function deterministicInteractivize(ir) {
  const out = [];
  for (const s of ir.scenes) {
    if (s.parent == null) continue; // only nested detail scenes get a "reveal detail" affordance
    out.push({
      id: `${s.parent}.reveal_${s.id.replace(/\W+/g, '_')}`,
      stop: s.parent,
      type: 'reveal',
      prompt: 'Reveal detail',
      config: { target: `[data-scene="${s.id}"]`, reveal: s.intent || 'Detail' },
    });
  }
  return out;
}

/**
 * Run the INTERACTIVIZE stage.
 * @param ir    validated scene-graph IR
 * @param opts  { propose?(ir, opts)->interaction[] | {interactions}, caps?, llm? }
 * @returns {Promise<{ interactions: object[], dropped: object[] }>}  validated, capped, invalid dropped
 */
export async function interactivize(ir, opts = {}) {
  const caps = { ...INTERACTIONS_DEFAULTS, ...(opts.caps || {}) };
  const stopIds = new Set(ir.tour.map((t) => t.scene));
  const sceneIds = new Set(ir.scenes.map((s) => s.id));

  const proposer = opts.propose ?? (() => []);
  const raw = await proposer(ir, opts);
  const candidates = Array.isArray(raw) ? raw : Array.isArray(raw?.interactions) ? raw.interactions : [];

  // Validate each candidate INDIVIDUALLY so one bad item never sinks the rest (§8 graceful degrade).
  const ctx = { stopIds, sceneIds, caps };
  const kept = [];
  const dropped = [];
  for (const it of candidates) {
    const { valid } = validateInteractions({ schemaVersion: 1, interactions: [it] }, ctx);
    if (valid) kept.push(it); else dropped.push(it);
  }

  // Truncate to the per-deck cap deterministically (spec §8 "truncated to the cap, logged").
  const interactions = kept.slice(0, caps.maxPerDeck);
  if (kept.length > interactions.length) {
    for (const it of kept.slice(caps.maxPerDeck)) dropped.push(it);
  }
  return { interactions, dropped };
}
```

> Note: per-candidate validation uses the per-deck/per-stop caps only as a final guard; the cap truncation above is what enforces `maxPerDeck`. (Per-stop overflow that survives is caught by the full-doc validation in Task 5.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/prezi/interactivize.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/prezi/interactivize.mjs src/prezi/interactivize.test.mjs
git commit -m "feat(#5): INTERACTIVIZE stage — propose, validate, drop-invalid, cap"
```

---

## Task 3: Pure runtime logic

**Files:**
- Create: `src/prezi/runtime/interactions-logic.mjs`
- Test: `src/prezi/runtime/interactions-logic.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// src/prezi/runtime/interactions-logic.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexByStop, resolveGotoIndex, gradeMcq } from './interactions-logic.mjs';

test('indexByStop groups interactions by their stop id', () => {
  const list = [
    { id: 'a', stop: 'intro' }, { id: 'b', stop: 'intro' }, { id: 'c', stop: 'f1' },
  ];
  const idx = indexByStop(list);
  assert.deepEqual(idx.get('intro').map((i) => i.id), ['a', 'b']);
  assert.deepEqual(idx.get('f1').map((i) => i.id), ['c']);
  assert.equal(idx.has('nope'), false);
});

test('resolveGotoIndex finds the first stop whose scene matches', () => {
  const stops = [{ scene: 'intro' }, { scene: 'f1' }, { scene: 'f1.detail' }];
  assert.equal(resolveGotoIndex(stops, 'f1.detail'), 2);
  assert.equal(resolveGotoIndex(stops, 'intro'), 0);
});

test('resolveGotoIndex returns -1 for an unknown goto', () => {
  assert.equal(resolveGotoIndex([{ scene: 'intro' }], 'ghost'), -1);
});

test('gradeMcq single-select marks the chosen option and correctness', () => {
  const config = { options: [{ text: 'A', correct: false, feedback: 'no' }, { text: 'B', correct: true, feedback: 'yes' }] };
  const r = gradeMcq(config, [1]);
  assert.equal(r.correct, true);
  assert.equal(r.options[1].chosen, true);
  assert.equal(r.options[1].correct, true);
  assert.equal(r.options[0].chosen, false);
});

test('gradeMcq is incorrect when a wrong option is chosen', () => {
  const config = { options: [{ text: 'A', correct: false }, { text: 'B', correct: true }] };
  assert.equal(gradeMcq(config, [0]).correct, false);
});

test('gradeMcq multi-select requires exactly the correct set', () => {
  const config = { multiSelect: true, options: [{ text: 'A', correct: true }, { text: 'B', correct: true }, { text: 'C', correct: false }] };
  assert.equal(gradeMcq(config, [0, 1]).correct, true);
  assert.equal(gradeMcq(config, [0]).correct, false);
  assert.equal(gradeMcq(config, [0, 1, 2]).correct, false);
});

test('gradeMcq ignores out-of-range indices safely', () => {
  const config = { options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] };
  const r = gradeMcq(config, [0, 99]);
  assert.equal(r.correct, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/prezi/runtime/interactions-logic.test.mjs`
Expected: FAIL — `Cannot find module './interactions-logic.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/prezi/runtime/interactions-logic.mjs
// Pure runtime logic for the interaction layer (spec §4). No DOM — unit-tested, CSP-irrelevant.
// Shipped same-origin as interactions-logic.js and imported by interactions.js (the DOM glue).

/** Group interactions by their `stop` id → Map<stopId, interaction[]> (insertion order preserved). */
export function indexByStop(interactions) {
  const m = new Map();
  for (const it of interactions || []) {
    if (!it || typeof it.stop !== 'string') continue;
    if (!m.has(it.stop)) m.set(it.stop, []);
    m.get(it.stop).push(it);
  }
  return m;
}

/** Resolve a branch `goto` (a scene/stop id) to the first matching tour-stop index, or -1. */
export function resolveGotoIndex(stops, gotoId) {
  for (let i = 0; i < stops.length; i++) if (stops[i] && stops[i].scene === gotoId) return i;
  return -1;
}

/**
 * Grade an MCQ selection against its config (client-side self-check; no scoring persisted).
 * @param config  { options:[{text,correct?,feedback?}], multiSelect? }
 * @param selected number[]  chosen option indices
 * @returns { correct:boolean, options:[{index,text,correct,chosen,feedback}] }
 */
export function gradeMcq(config, selected) {
  const options = Array.isArray(config?.options) ? config.options : [];
  const chosen = new Set((selected || []).filter((i) => Number.isInteger(i) && i >= 0 && i < options.length));
  const annotated = options.map((o, index) => ({
    index, text: o.text, correct: o.correct === true, chosen: chosen.has(index), feedback: o.feedback || '',
  }));
  // Correct iff the chosen set is EXACTLY the set of correct options.
  const correctIdx = new Set(annotated.filter((o) => o.correct).map((o) => o.index));
  const correct = correctIdx.size === chosen.size && [...chosen].every((i) => correctIdx.has(i));
  return { correct, options: annotated };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/prezi/runtime/interactions-logic.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/prezi/runtime/interactions-logic.mjs src/prezi/runtime/interactions-logic.test.mjs
git commit -m "feat(#5): pure interaction runtime logic (indexByStop, goto resolve, mcq grade)"
```

---

## Task 4: DOM glue runtime (overlay panel)

**Files:**
- Create: `src/prezi/runtime/interactions.mjs`

No unit test — this is browser DOM glue, untested by the same convention as `player.mjs` (Task 5's `generate.test.mjs` asserts it is shipped and CSP-clean; the logic it relies on is tested in Task 3). It MUST be CSP-clean: no inline handlers, no `eval`/`new Function`, no `innerHTML` of model-supplied strings without escaping.

- [ ] **Step 1: Write the implementation**

```js
// src/prezi/runtime/interactions.mjs
// DOM glue for the interaction layer (spec §4, §7). Renders an overlay panel anchored to the
// stage that shows the CURRENT stop's interactions and runs them entirely client-side in public
// self-check mode — nothing is recorded, no network (CSP connect-src 'none'). Pure logic lives in
// interactions-logic.js (imported same-origin); this file is imperative DOM only.
//
// CSP-clean: created via createElement + addEventListener; text via textContent; the only markup
// inserted as HTML is reveal `config.reveal`, which is escaped before insertion.

import { indexByStop, resolveGotoIndex, gradeMcq } from './interactions-logic.js';

function el(tag, attrs = {}, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Initialize the interaction layer.
 * @param opts { data, svg, nav } where
 *   data = parsed interactions.json ({ interactions: [...] })
 *   svg  = the presentation <svg> element (for reveal targets)
 *   nav  = { go(index), stops }  the player's navigation controller (for branching)
 * @returns { onStop(index) }  called by the player whenever the active stop changes
 */
export function initInteractions(opts) {
  const { data, svg, nav } = opts;
  const byStop = indexByStop(data && data.interactions);

  const panel = el('section', { class: 'iax', 'aria-live': 'polite' });
  panel.style.cssText =
    'position:fixed;left:12px;bottom:12px;max-width:min(92vw,520px);max-height:60vh;overflow:auto;' +
    'background:rgba(10,12,24,.92);color:#e8ecff;font:15px/1.4 system-ui,sans-serif;border:1px solid #2a3566;' +
    'border-radius:12px;padding:14px 16px;display:none;z-index:10';
  document.body.appendChild(panel);

  function render(items) {
    panel.replaceChildren();
    if (!items || !items.length) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    for (const it of items) panel.appendChild(renderOne(it));
  }

  function renderOne(it) {
    const box = el('div', { class: `iax-item iax-${it.type}`, 'data-id': it.id });
    box.style.cssText = 'margin:6px 0;padding-top:6px;border-top:1px solid #20294f';
    box.appendChild(el('p', { class: 'iax-prompt' }, it.prompt));
    const cfg = it.config || {};
    if (it.type === 'reveal') box.appendChild(revealUi(cfg));
    else if (it.type === 'mcq') box.appendChild(mcqUi(cfg));
    else if (it.type === 'branch') box.appendChild(branchUi(cfg));
    else if (it.type === 'freetext') box.appendChild(freetextUi(cfg));
    return box;
  }

  function btn(label) {
    const b = el('button', { type: 'button' }, label);
    b.style.cssText = 'margin:4px 6px 4px 0;padding:6px 12px;background:#1c2750;color:#dfe6ff;border:1px solid #34418a;border-radius:8px;cursor:pointer';
    return b;
  }

  function revealUi(cfg) {
    const wrap = el('div');
    const b = btn('Reveal');
    const out = el('div'); out.style.cssText = 'margin-top:6px;display:none';
    b.addEventListener('click', () => {
      const target = cfg.target && svg.querySelector(cfg.target);
      if (target) target.removeAttribute('hidden');
      out.innerHTML = escapeHtml(cfg.reveal || ''); // escaped: model content is data, not markup
      out.style.display = 'block';
    });
    wrap.append(b, out);
    return wrap;
  }

  function mcqUi(cfg) {
    const wrap = el('div');
    const chosen = new Set();
    const multi = cfg.multiSelect === true;
    const opts = Array.isArray(cfg.options) ? cfg.options : [];
    const result = el('div'); result.style.cssText = 'margin-top:6px;min-height:1.2em';
    opts.forEach((o, i) => {
      const b = btn(o.text);
      b.addEventListener('click', () => {
        if (multi) { chosen.has(i) ? chosen.delete(i) : chosen.add(i); b.style.outline = chosen.has(i) ? '2px solid #6c8cff' : 'none'; }
        else { chosen.clear(); chosen.add(i); }
        const g = gradeMcq(cfg, [...chosen]);
        result.textContent = (g.correct ? '✓ ' : '✗ ') + (o.feedback || (g.correct ? 'Correct' : 'Try again'));
        result.style.color = g.correct ? '#86f0a8' : '#ff9ba3';
      });
      wrap.appendChild(b);
    });
    wrap.appendChild(result);
    return wrap;
  }

  function branchUi(cfg) {
    const wrap = el('div');
    for (const c of (cfg.choices || [])) {
      const b = btn(c.text);
      b.addEventListener('click', () => {
        const i = resolveGotoIndex(nav.stops, c.goto);
        if (i >= 0) nav.go(i);
      });
      wrap.appendChild(b);
    }
    return wrap;
  }

  function freetextUi(cfg) {
    const wrap = el('div');
    const ta = el('textarea', { rows: '3', 'aria-label': 'Your answer' });
    ta.style.cssText = 'width:100%;background:#0c1024;color:#e8ecff;border:1px solid #2a3566;border-radius:8px;padding:8px';
    const b = btn('Show model answer');
    const out = el('div'); out.style.cssText = 'margin-top:6px;display:none;color:#cdd6ff';
    b.addEventListener('click', () => {
      out.replaceChildren(el('strong', {}, 'Model answer: '), document.createTextNode(cfg.modelAnswer || ''));
      if (Array.isArray(cfg.rubric) && cfg.rubric.length) {
        const ul = el('ul');
        for (const r of cfg.rubric) ul.appendChild(el('li', {}, r));
        out.appendChild(ul);
      }
      out.style.display = 'block';
    });
    wrap.append(ta, b, out);
    return wrap;
  }

  return {
    onStop(index) {
      const stop = nav.stops[index];
      render(stop ? byStop.get(stop.scene) : null);
    },
  };
}
```

- [ ] **Step 2: Sanity-check it parses as a module**

Run: `node --check src/prezi/runtime/interactions.mjs`
Expected: no output (exit 0). (It imports `./interactions-logic.js`, the shipped name; `node --check` only parses, it does not resolve imports, so this passes.)

- [ ] **Step 3: Commit**

```bash
git add src/prezi/runtime/interactions.mjs
git commit -m "feat(#5): CSP-clean DOM glue for interactions (reveal/mcq/branch/freetext overlay)"
```

---

## Task 5: Player wiring — load interactions when present

**Files:**
- Modify: `src/prezi/runtime/player.mjs`

The player must drive interactions WITHOUT breaking a zero-interaction deck. Strategy: after camera init, look for an inline `interactions-data` element; only if present, **dynamic-import** `./interactions.js` (CSP-clean, same-origin), build a `nav` controller, and notify it on every stop change. No element → nothing imported, behavior identical to today.

- [ ] **Step 1: Add the interaction bootstrap inside `init()`**

In `src/prezi/runtime/player.mjs`, locate the initial-stop block at the end of `init()`:

```js
    // Initial stop: deep link if present, else the first stop.
    const deep = resolveStopIndex(stops, location.hash);
    go(deep >= 0 ? deep : 0, { instant: true });
```

Replace it with:

```js
    // Interaction layer (spec §5/#5): only when the page carries inline interaction data.
    // Dynamic import keeps zero-interaction decks byte-for-byte free of the interaction runtime.
    let interactionsCtl = null;
    const iaxEl = document.getElementById('interactions-data');
    if (iaxEl) {
      let iaxData = null;
      try { iaxData = JSON.parse(iaxEl.textContent); } catch { iaxData = null; }
      if (iaxData && Array.isArray(iaxData.interactions) && iaxData.interactions.length) {
        import('./interactions.js')
          .then((mod) => {
            interactionsCtl = mod.initInteractions({ data: iaxData, svg, nav: { stops, go } });
            interactionsCtl.onStop(index);
          })
          .catch(() => { /* interactions are enhancement-only; never break the deck */ });
      }
    }

    // Notify the interaction layer on every stop change.
    const notify = () => { if (interactionsCtl) interactionsCtl.onStop(index); };
    const _animateTo = animateTo;
    animateTo = function (i, opts) { _animateTo(i, opts); notify(); };

    // Initial stop: deep link if present, else the first stop.
    const deep = resolveStopIndex(stops, location.hash);
    go(deep >= 0 ? deep : 0, { instant: true });
```

- [ ] **Step 2: Make `animateTo` reassignable**

`animateTo` is declared with `function animateTo(...)`. To wrap it (Step 1 reassigns it), change its declaration. Find:

```js
    function animateTo(i, { instant } = {}) {
```

Change to:

```js
    let animateTo = function animateTo(i, { instant } = {}) {
```

(Hoisting note: `go`, `goNext`, `goPrev` call `animateTo`; they run only on user events after init completes, by which point the `let` is assigned — safe. The wrapping reassignment in Step 1 happens at the end of `init()`, before any event can fire.)

- [ ] **Step 3: Verify the module still parses**

Run: `node --check src/prezi/runtime/player.mjs`
Expected: no output (exit 0).

- [ ] **Step 4: Verify camera-math tests still pass (player imports unchanged math)**

Run: `node --test src/prezi/runtime/camera-math.test.mjs`
Expected: PASS (unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/prezi/runtime/player.mjs
git commit -m "feat(#5): player loads interaction runtime only when interaction data is present"
```

---

## Task 6: Manifest summary

**Files:**
- Modify: `src/prezi/manifest.mjs`
- Test: `src/prezi/manifest.test.mjs` (create — there is no existing manifest test)

- [ ] **Step 1: Write the failing test**

```js
// src/prezi/manifest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest } from './manifest.mjs';

const ir = { canvas: { width: 100, height: 100 }, scenes: [{ id: 'a' }], tour: [{ scene: 'a' }], citations: [] };

test('manifest omits the interactions field when there are none (regression-safe)', () => {
  const m = buildManifest({ id: 1, title: 'T', slug: 's', ir, artifacts: ['index.html'], quality: {} });
  assert.equal('interactions' in m, false);
});

test('manifest includes an interactions summary when provided', () => {
  const m = buildManifest({
    id: 1, title: 'T', slug: 's', ir, artifacts: ['index.html'], quality: {},
    interactions: { schemaVersion: 1, count: 3, byType: { reveal: 1, mcq: 1, branch: 1, freetext: 0 } },
  });
  assert.deepEqual(m.interactions, { schemaVersion: 1, count: 3, byType: { reveal: 1, mcq: 1, branch: 1, freetext: 0 } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/prezi/manifest.test.mjs`
Expected: FAIL — second test fails (`m.interactions` is `undefined`).

- [ ] **Step 3: Implement**

In `src/prezi/manifest.mjs`, change the signature and add the conditional field. Find:

```js
export function buildManifest({ id, title, slug, ir, artifacts, quality, fonts }) {
  return {
```

Change to:

```js
export function buildManifest({ id, title, slug, ir, artifacts, quality, fonts, interactions }) {
  return {
```

Then, immediately before the closing `quality,` line, add the conditional spread. Find:

```js
    fonts: fonts || { embedded: false, note: 'system fallback stack; embed self-hosted fonts to guarantee sandbox↔viewer fidelity (§7.1)' },
    quality,
  };
```

Change to:

```js
    fonts: fonts || { embedded: false, note: 'system fallback stack; embed self-hosted fonts to guarantee sandbox↔viewer fidelity (§7.1)' },
    ...(interactions ? { interactions } : {}),
    quality,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/prezi/manifest.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/prezi/manifest.mjs src/prezi/manifest.test.mjs
git commit -m "feat(#5): manifest carries an interactions summary only when present"
```

---

## Task 7: Wire INTERACTIVIZE into the generator

**Files:**
- Modify: `src/prezi/generate.mjs`
- Test: `src/prezi/generate.test.mjs` (extend — read it first to match existing setup/teardown and imports)

This is the integration task. It must: (a) run INTERACTIVIZE, (b) validate the full set against the IR and drop overflow/per-stop violators, (c) when interactions remain, write `interactions.json`, inline an `interactions-data` script into `index.html`, ship the two interaction runtime files, and add the manifest summary, (d) when none remain, change nothing (regression), (e) log dropped count to `quality`.

- [ ] **Step 1: Add imports and a runtime-shipping helper**

In `src/prezi/generate.mjs`, add to the imports at the top:

```js
import { interactivize } from './interactivize.mjs';
import { validateInteractions } from './interactions-schema.mjs';
```

Then extend `runtimeArtifacts()` to optionally include the interaction runtime. Find:

```js
async function runtimeArtifacts() {
  const cam = new URL('./runtime/camera-math.mjs', import.meta.url);
  const ply = new URL('./runtime/player.mjs', import.meta.url);
  const cameraMath = await readFile(cam, 'utf8');
  let player = await readFile(ply, 'utf8');
  // Rewrite every .mjs reference (import specifier + the comment that documents it) to the shipped
  // .js filename, so the artifact carries no dangling .mjs reference.
  player = player.replaceAll('./camera-math.mjs', './camera-math.js');
  return { 'camera-math.js': cameraMath, 'player.js': player };
}
```

Replace with:

```js
async function runtimeArtifacts({ withInteractions } = {}) {
  const cameraMath = await readFile(new URL('./runtime/camera-math.mjs', import.meta.url), 'utf8');
  let player = await readFile(new URL('./runtime/player.mjs', import.meta.url), 'utf8');
  // Rewrite .mjs specifiers to the shipped .js filenames so artifacts carry no dangling .mjs ref.
  player = player.replaceAll('./camera-math.mjs', './camera-math.js').replaceAll('./interactions.mjs', './interactions.js');
  const files = { 'camera-math.js': cameraMath, 'player.js': player };
  if (withInteractions) {
    files['interactions-logic.js'] = await readFile(new URL('./runtime/interactions-logic.mjs', import.meta.url), 'utf8');
    let glue = await readFile(new URL('./runtime/interactions.mjs', import.meta.url), 'utf8');
    glue = glue.replaceAll('./interactions-logic.mjs', './interactions-logic.js');
    files['interactions.js'] = glue;
  }
  return files;
}
```

- [ ] **Step 2: Teach `buildIndexHtml` to inline interaction data**

Find:

```js
function buildIndexHtml(title, svgInline, camera) {
  // Strip the XML prolog: the SVG is inlined into HTML, not served as a standalone document here.
  const svg = svgInline.replace(/^<\?xml[^>]*\?>\s*/, '');
  return `<!doctype html>
```

Replace the signature and the `<script id="camera-data" …>` line. Change the signature to:

```js
function buildIndexHtml(title, svgInline, camera, interactions) {
  // Strip the XML prolog: the SVG is inlined into HTML, not served as a standalone document here.
  const svg = svgInline.replace(/^<\?xml[^>]*\?>\s*/, '');
  const iaxScript = interactions && interactions.interactions.length
    ? `\n<script id="interactions-data" type="application/json">${inlineJson(interactions)}</script>`
    : '';
  return `<!doctype html>
```

Then find:

```js
<script id="camera-data" type="application/json">${inlineJson(camera)}</script>
<script type="module" src="player.js"></script>
```

Replace with:

```js
<script id="camera-data" type="application/json">${inlineJson(camera)}</script>${iaxScript}
<script type="module" src="player.js"></script>
```

- [ ] **Step 3: Run INTERACTIVIZE and emit artifacts in `generatePresentation`**

In `generatePresentation`, find:

```js
  const finalIr = loop.ir;
  const { svg } = compileSvg(finalIr);
  const camera = compileCamera(finalIr);
  const indexHtml = buildIndexHtml(input.title, svg, camera);
  const runtime = await runtimeArtifacts();
```

Replace with:

```js
  const finalIr = loop.ir;

  // INTERACTIVIZE (#5 §5): propose, then validate the whole set against the final IR. Per-deck and
  // per-stop overflow that survives per-item validation is caught here and dropped (§8).
  const iax = await interactivize(finalIr, { propose: deps.interactivize, caps: deps.interactionCaps, llm: deps.llm });
  let interactions = iax.interactions;
  let interactionsDropped = iax.dropped.length;
  if (interactions.length) {
    const ctx = {
      stopIds: new Set(finalIr.tour.map((t) => t.scene)),
      sceneIds: new Set(finalIr.scenes.map((s) => s.id)),
      caps: deps.interactionCaps,
    };
    let check = validateInteractions({ schemaVersion: 1, interactions }, ctx);
    // Drop offenders until the set validates (deterministic: trim trailing items).
    while (!check.valid && interactions.length) {
      interactions = interactions.slice(0, -1);
      interactionsDropped++;
      check = validateInteractions({ schemaVersion: 1, interactions }, ctx);
    }
  }
  const interactionsDoc = interactions.length ? { schemaVersion: 1, interactions } : null;

  const { svg } = compileSvg(finalIr);
  const camera = compileCamera(finalIr);
  const indexHtml = buildIndexHtml(input.title, svg, camera, interactionsDoc);
  const runtime = await runtimeArtifacts({ withInteractions: interactions.length > 0 });
```

- [ ] **Step 4: Write `interactions.json` and feed the manifest**

Find:

```js
  const files = {
    'index.html': indexHtml,
    'presentation.svg': svg,
    'camera.json': JSON.stringify(camera, null, 2),
    'styles.css': STYLES + (deps.fonts?.faceCss || ''),
    ...runtime,
  };
```

Replace with:

```js
  const files = {
    'index.html': indexHtml,
    'presentation.svg': svg,
    'camera.json': JSON.stringify(camera, null, 2),
    'styles.css': STYLES + (deps.fonts?.faceCss || ''),
    ...runtime,
  };
  if (interactionsDoc) files['interactions.json'] = JSON.stringify(interactionsDoc, null, 2);
```

Then find the `quality` object and the `buildManifest` call:

```js
  const quality = {
    converged: loop.converged,
    iterations: loop.iterations,
    maxIterations,
    residualIssues: loop.residualIssues,
    critic: deps.critic ? 'injected' : 'geometric',
  };
  const manifest = buildManifest({
    id: input.id,
    title: input.title,
    slug: input.slug,
    ir: finalIr,
    artifacts: [...artifactNames, 'manifest.json'],
    quality,
    fonts: deps.fonts ? { embedded: true } : undefined,
  });
```

Replace with:

```js
  const quality = {
    converged: loop.converged,
    iterations: loop.iterations,
    maxIterations,
    residualIssues: loop.residualIssues,
    critic: deps.critic ? 'injected' : 'geometric',
    interactionsDropped,
  };
  let interactionsSummary;
  if (interactionsDoc) {
    const byType = { reveal: 0, mcq: 0, branch: 0, freetext: 0 };
    for (const it of interactions) byType[it.type] = (byType[it.type] || 0) + 1;
    interactionsSummary = { schemaVersion: 1, count: interactions.length, byType };
  }
  const manifest = buildManifest({
    id: input.id,
    title: input.title,
    slug: input.slug,
    ir: finalIr,
    artifacts: [...artifactNames, 'manifest.json'],
    quality,
    fonts: deps.fonts ? { embedded: true } : undefined,
    interactions: interactionsSummary,
  });
```

> Note: `artifactNames` is derived from `Object.keys(files)` later in the function (it already exists). Because `interactions.json` is added to `files` above before `artifactNames` is computed, it is automatically included in the manifest's `artifacts` list. Verify by reading the lines around `const artifactNames = Object.keys(files);` — no change needed there, but confirm `interactions.json` lands in `files` before that line. (In the current file, `const artifactNames = Object.keys(files);` sits a few lines below the `files` object; the `if (interactionsDoc) files[...] =` insertion is above it, so it is included.)

- [ ] **Step 5: Write the failing tests (extend `generate.test.mjs`)**

First read the existing test file to match its imports, tmp-dir setup, and teardown:

Run: `sed -n '1,40p' src/prezi/generate.test.mjs`

Then append these tests (adapt the fixture/`readFile`/tmpdir helpers to match what the file already defines — reuse its existing `generatePresentation` import, its sample `research` doc, and its output-dir helper):

```js
import { deterministicInteractivize } from './interactivize.mjs';

test('#5: a zero-interaction deck ships no interaction artifacts (regression)', async () => {
  const out = await mkOutDir(); // reuse the file's existing tmp-dir helper
  const manifest = await generatePresentation(sampleInput, out); // reuse the file's existing input fixture
  const names = manifest.artifacts;
  assert.equal(names.includes('interactions.json'), false);
  assert.equal(names.includes('interactions.js'), false);
  assert.equal('interactions' in manifest, false);
  const html = await readFile(join(out, 'index.html'), 'utf8');
  assert.equal(html.includes('interactions-data'), false);
});

test('#5: an interactive deck ships interactions.json + runtime + inline data + manifest summary', async () => {
  const out = await mkOutDir();
  // Inject a proposer that emits one MCQ on the first tour stop.
  const propose = (ir) => ([{
    id: 'q1', stop: ir.tour[0].scene, type: 'mcq', prompt: 'Which?',
    config: { options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] },
  }]);
  const manifest = await generatePresentation(sampleInput, out, { interactivize: propose });

  assert.ok(manifest.artifacts.includes('interactions.json'));
  assert.ok(manifest.artifacts.includes('interactions.js'));
  assert.ok(manifest.artifacts.includes('interactions-logic.js'));
  assert.equal(manifest.interactions.count, 1);
  assert.equal(manifest.interactions.byType.mcq, 1);

  const doc = JSON.parse(await readFile(join(out, 'interactions.json'), 'utf8'));
  assert.equal(doc.interactions[0].id, 'q1');

  const html = await readFile(join(out, 'index.html'), 'utf8');
  assert.ok(html.includes('id="interactions-data"'));
});

test('#5: invalid proposed interactions are dropped, deck still publishes', async () => {
  const out = await mkOutDir();
  const propose = (ir) => ([
    { id: 'ok', stop: ir.tour[0].scene, type: 'reveal', prompt: 'p', config: { target: '#g', reveal: 'x' } },
    { id: 'bad', stop: 'ghost-stop', type: 'reveal', prompt: 'p', config: { target: '#g', reveal: 'x' } },
  ]);
  const manifest = await generatePresentation(sampleInput, out, { interactivize: propose });
  assert.equal(manifest.interactions.count, 1);
  assert.equal(manifest.quality.interactionsDropped, 1);
});

test('#5: deterministicInteractivize produces a publishable interactive deck', async () => {
  const out = await mkOutDir();
  const manifest = await generatePresentation(sampleInput, out, { interactivize: deterministicInteractivize });
  // sampleInput's research yields at least one nested detail scene → ≥1 reveal, OR none → no interactions.
  if (manifest.interactions) {
    assert.ok(manifest.interactions.count >= 1);
    assert.ok(manifest.artifacts.includes('interactions.json'));
  } else {
    assert.equal(manifest.artifacts.includes('interactions.json'), false);
  }
});
```

> If `generate.test.mjs` does not already expose helpers named `mkOutDir`/`sampleInput`, rename these references to whatever the file uses (e.g. an inline `os.tmpdir()` + `mkdtemp` and the existing research fixture). Do NOT invent a second fixture — reuse the file's.

- [ ] **Step 6: Run test to verify it fails**

Run: `node --test src/prezi/generate.test.mjs`
Expected: FAIL on the new `#5:` tests (interaction artifacts not yet emitted) — but only if Steps 1–4 were not saved. If Steps 1–4 are saved, they PASS; in that case, to honor TDD, write Step 5's tests BEFORE Steps 1–4 in your working order. (When executing: do Step 5 first, watch it fail, then apply Steps 1–4, then Step 7.)

- [ ] **Step 7: Run the full prezi suite to verify pass + no regressions**

Run: `node --test src/prezi/`
Expected: PASS — all new `#5:` tests plus every pre-existing `src/prezi/*` test (compose, svg, camera, critique, layout, ir-schema, camera-math, manifest).

- [ ] **Step 8: Commit**

```bash
git add src/prezi/generate.mjs src/prezi/generate.test.mjs
git commit -m "feat(#5): emit interactions.json + runtime + inline data + manifest summary"
```

---

## Task 8: CLI `--interactive` demo flag

**Files:**
- Modify: `src/prezi/cli.mjs` (read it first — match its existing arg parsing and `generatePresentation`/`makePreziGenerator` call)

- [ ] **Step 1: Read the CLI to find its arg parser and generate call**

Run: `cat src/prezi/cli.mjs`
Identify where flags are parsed and where `generatePresentation(...)`/`makePreziGenerator(...)` is invoked with `deps`.

- [ ] **Step 2: Add the flag and wire the deterministic proposer**

Add to the flag parsing (match the file's existing style — e.g. a `process.argv.includes('--interactive')` boolean or its options map):

```js
import { deterministicInteractivize } from './interactivize.mjs';
// …
const interactive = process.argv.includes('--interactive');
```

In the `deps` object passed to `generatePresentation`/`makePreziGenerator`, add:

```js
  ...(interactive ? { interactivize: deterministicInteractivize } : {}),
```

- [ ] **Step 3: Smoke-test the CLI end-to-end**

Run: `npm run generate -- --interactive --from-writeup --title "Test" --out /tmp/iax-demo` (use the file's actual flags as read in Step 1; if it requires `--research <file>`, pass a fixture instead of `--from-writeup`).
Expected: exits 0; `/tmp/iax-demo/interactions.json` exists (if the deck has nested scenes) and `/tmp/iax-demo/index.html` contains `interactions-data`.

- [ ] **Step 4: Commit**

```bash
git add src/prezi/cli.mjs
git commit -m "feat(#5): --interactive CLI flag wires the deterministic INTERACTIVIZE proposer"
```

---

## Task 9: Full-suite regression gate

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: PASS — every pre-existing test (research, prezi, app/auth/etc.) plus the new #5 tests. No failures, no regressions. If the repo prints a total count, note it for the CLAUDE.md handoff update.

- [ ] **Step 2: Run the #0 supply-chain + secret gates (no new deps were added, must stay green)**

Run: `npm run audit:deps && npm run scan:secrets`
Expected: PASS (this plan adds **zero** npm dependencies — stdlib only).

- [ ] **Step 3: Commit any incidental fixes**

```bash
git add -A
git commit -m "test(#5): full-suite green — interactive artifact engine complete"
```

---

## Self-Review (completed during planning)

**Spec coverage (engine subset):**
- §1 four primitives in public self-check mode → Tasks 1–4 (schema + runtime); free-text is model-answer-only (no grading) → Task 1 (`freetext requires modelAnswer`, no eval path) ✓
- §2 additive seam / zero-interaction identical → Task 7 regression test + Task 6 manifest-omit ✓
- §3 `interactions.json` separate artifact, stable ids, referential integrity, caps → Tasks 1, 7 ✓
- §4 fixed deterministic runtime; only data is agent-produced; CSP-clean → Tasks 3–5 (dynamic import, escaped reveal, no eval) ✓
- §5 INTERACTIVIZE proposes; offline default empty; orchestration-layer (no execute_code) → Task 2 ✓
- §5.1 light overlap check → **deferred**: the existing `geometricCritique` runs on scenes pre-interaction; interaction-overlap critique is a v1.1 enhancement (interactions render in an HTML overlay panel, not the SVG, so they cannot clip scene content in v1 — the overlap risk §5.1 worries about is avoided by construction here). Noted, not silently dropped.
- §8 graceful degradation (drop invalid, missing file → plain deck, branch fallback) → Task 2 (drop), Task 5 (missing-data no-op + dynamic-import `.catch`), Task 3 (`resolveGotoIndex` → -1 → player ignores) ✓
- §9 TDD across schema/logic/generate/regression → Tasks 1,3,6,7 ✓
- §10 no egress/secrets/PII/write-path → Task 9 gates; runtime has no `fetch` ✓
- §6 editor, §7 persistence, §11 #6 → **out of scope** (separate plan, stated in Scope note) ✓

**Placeholder scan:** No TBD/TODO. Tasks 7-Step-5 and 8 explicitly say "read the existing file and match its helpers/flags" rather than inventing them — that is a real instruction, not a placeholder, because the exact fixture/arg names live in files not yet read; every code block is complete and runnable once bound to the existing helper names.

**Type consistency:** `validateInteractions(doc, ctx)`, `interactivize(ir, {propose, caps, llm}) → {interactions, dropped}`, `indexByStop/resolveGotoIndex/gradeMcq`, `initInteractions({data, svg, nav}) → {onStop}`, `buildManifest({…, interactions})`, generator dep key `interactivize` — all names match across Tasks 1→8. The generator's dep is `deps.interactivize` (a `propose` fn) consistently in Tasks 7 and 8.

---

## Execution Handoff

This plan is the **engine** subsystem of spec #5. The **instructor refine editor + persistence** (spec §6–§7) is a separate plan that requires reading the #1 app surface (`src/app.ts`, `src/presentations.ts`, `src/db.ts`, the vanilla-JS frontend, and the `presentations` schema) — recommended to write next, before or alongside execution of this one.
