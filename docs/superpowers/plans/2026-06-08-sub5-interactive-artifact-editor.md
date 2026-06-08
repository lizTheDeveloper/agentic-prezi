# Interactive Artifact Layer — Editor & Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a presentation's interaction set, let the owner refine the agent-proposed interactions (accept / edit / delete / reorder / add) via the API + vanilla-JS editor, and bake the edited set into the published artifact on re-publish — closing the "agent proposes, instructor refines" loop from spec §6–§7.

**Architecture:** Two new columns on `presentations` hold the current interaction set (`interactions`, JSON) and the referential-integrity snapshot it must validate against (`interaction_context`, JSON `{stopIds}`). A generator-agnostic store module reads/validates/writes them and ingests them back from a freshly-generated artifact dir. The worker passes any stored set into generation as an **override** (the generator re-validates + bakes it) and ingests the shipped set back afterward. The editor UI gains an "Interactions" panel. All validation reuses the #5 engine's `validateInteractions`.

**Tech Stack:** Node ≥26, TypeScript (`.ts`, run via Node type-stripping), ESM. `node:sqlite` data layer, hand-rolled `node:http` router, `node:test` + `node:assert/strict`. Frontend is dependency-free vanilla JS in `public/app.js`. Zero new npm deps (per #0).

**DEPENDS ON:** the **#5 engine plan** (`docs/superpowers/plans/2026-06-08-sub5-interactive-artifact-engine.md`) must be implemented **first** — this plan imports `validateInteractions`/`INTERACTIONS_DEFAULTS` from `src/prezi/interactions-schema.mjs` and relies on `generatePresentation`/`makePreziGenerator` emitting `interactions.json`. Do not start this plan until the engine plan's Task 9 is green.

**Scope note (honest framing):** This plan makes the persistence/edit/override/readback loop real and **offline-testable with an injected generator** (like `test/publish.test.ts`). The *real agent proposals* only appear once the **#3 generator is wired into the worker**, which needs the LLM/Nous Portal research path + the Hermes drivability spike (CLAUDE.md "Next" — out of scope here). Until then, this loop runs against the deterministic proposer or an injected generator; the stub generator path leaves the columns untouched (the editor shows "publish to generate proposed interactions"). **Response capture, students/cohorts, agent-graded free-text remain sub-project #6.**

**Reference:** spec `docs/superpowers/specs/2026-06-08-sub5-interactive-artifact-layer-design.md` §6, §7. Files created: `src/interactions-store.ts`, `test/interactions-store.test.ts`, `test/interactions-api.test.ts`. Files modified: `src/db.ts`, `src/presentations.ts`, `src/app.ts`, `src/generator.ts`, `src/worker.ts`, `src/prezi/generate.mjs`, `public/app.js`, `public/app.css`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/db.ts` (modify) | Migration #2: add `interactions` + `interaction_context` TEXT columns to `presentations`. |
| `src/interactions-store.ts` (new) | Generator-agnostic store: `readInteractions(db,id)`, `validateAndStore(db,id,interactions)` (validates vs. stored context, throws `HttpError`), `persistAfterGenerate(db,id,outDir)` (ingest `interactions.json` + `camera.json` from a generated dir). No HTTP wiring. |
| `src/presentations.ts` (modify) | Two handlers: `getInteractions` (GET) and `setInteractions` (PATCH), owner-enforced via the existing `ownedOr404`/`parseId`. |
| `src/app.ts` (modify) | Register the two interaction routes. |
| `src/generator.ts` (modify) | Add optional `interactions?: unknown[]` to `GenInput` (the per-job override). Stub ignores it. |
| `src/prezi/generate.mjs` (modify) | `makePreziGenerator`: use `genInput.interactions` as the INTERACTIVIZE override; default first-publish proposal to `deterministicInteractivize`. |
| `src/worker.ts` (modify) | Pass the stored interaction set into generation; call `persistAfterGenerate` after a successful generate. |
| `public/app.js` (modify) | "Interactions" panel in the editor: list + accept/edit/delete/reorder/add + Save. |
| `public/app.css` (modify) | Minimal styling for the interactions list. |

---

## Task 1: Migration — interaction columns

**Files:**
- Modify: `src/db.ts`
- Test: `test/units.test.ts` (append — it already exercises low-level units; confirm by reading its top)

- [ ] **Step 1: Write the failing test**

First read the existing unit test header to match imports:

Run: `sed -n '1,20p' test/units.test.ts`

Append this test (adapt the `openDb` import path if the file already imports it):

```ts
import { openDb } from '../src/db.ts';

test('migration 2 adds interaction columns to presentations', () => {
  const db = openDb(':memory:');
  const cols = (db.prepare(`PRAGMA table_info(presentations)`).all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes('interactions'), 'interactions column present');
  assert.ok(cols.includes('interaction_context'), 'interaction_context column present');
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/units.test.ts`
Expected: FAIL — `interactions column present` assertion fails (column missing).

- [ ] **Step 3: Add migration #2**

In `src/db.ts`, the `MIGRATIONS` array currently has one entry. Add a second array element after it. Find the closing of the first migration:

```ts
  CREATE INDEX idx_jobs_claim ON jobs(status, run_after);
  CREATE INDEX idx_pres_user ON presentations(user_id);
  `,
];
```

Change to:

```ts
  CREATE INDEX idx_jobs_claim ON jobs(status, run_after);
  CREATE INDEX idx_pres_user ON presentations(user_id);
  `,
  // 2 — interaction layer (#5 §7): the current editable set + its referential-integrity snapshot.
  `
  ALTER TABLE presentations ADD COLUMN interactions TEXT;
  ALTER TABLE presentations ADD COLUMN interaction_context TEXT;
  `,
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/units.test.ts`
Expected: PASS (including the new migration test).

- [ ] **Step 5: Run the existing app suite — no regression in migration ordering**

Run: `node --test test/`
Expected: PASS (all existing app/auth/publish/host-routing tests still pass; migrations are forward-only and additive).

- [ ] **Step 6: Commit**

```bash
git add src/db.ts test/units.test.ts
git commit -m "feat(#5): migration 2 — interactions + interaction_context columns"
```

---

## Task 2: Interactions store module

**Files:**
- Create: `src/interactions-store.ts`
- Test: `test/interactions-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/interactions-store.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { readInteractions, validateAndStore, persistAfterGenerate } from '../src/interactions-store.ts';
import { HttpError } from '../src/http.ts';

// Seed a user + presentation, return its id.
function seed(db: any): number {
  const now = Date.now();
  const u = db.prepare('INSERT INTO users (email, created_at) VALUES (?, ?)').run('a@b.c', now);
  const p = db
    .prepare(`INSERT INTO presentations (user_id, title, source_writeup, status, created_at, updated_at)
              VALUES (?, 'T', '', 'draft', ?, ?)`)
    .run(Number(u.lastInsertRowid), now, now);
  return Number(p.lastInsertRowid);
}

test('readInteractions returns nulls before anything is stored', () => {
  const db = openDb(':memory:');
  const id = seed(db);
  assert.deepEqual(readInteractions(db, id), { interactions: null, context: null });
  db.close();
});

test('validateAndStore rejects when no context exists yet (must generate first)', () => {
  const db = openDb(':memory:');
  const id = seed(db);
  assert.throws(() => validateAndStore(db, id, []), (e: any) => e instanceof HttpError && e.status === 409);
  db.close();
});

test('persistAfterGenerate ingests interactions.json + camera.json from an artifact dir', async () => {
  const db = openDb(':memory:');
  const id = seed(db);
  const dir = mkdtempSync(join(tmpdir(), 'iax-store-'));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'camera.json'), JSON.stringify({ stops: [{ scene: 'intro' }, { scene: 'f1' }], viewport: { aspect: 1.78 } }));
  await writeFile(join(dir, 'interactions.json'), JSON.stringify({
    schemaVersion: 1,
    interactions: [{ id: 'intro.r1', stop: 'intro', type: 'reveal', prompt: 'p', config: { target: '#g', reveal: 'x' } }],
  }));
  await persistAfterGenerate(db, id, dir);

  const got = readInteractions(db, id);
  assert.equal(got.interactions!.length, 1);
  assert.deepEqual(got.context!.stopIds, ['intro', 'f1']);
  db.close();
});

test('validateAndStore accepts an edit whose stop is in context and rejects an unknown stop', async () => {
  const db = openDb(':memory:');
  const id = seed(db);
  const dir = mkdtempSync(join(tmpdir(), 'iax-store-'));
  await writeFile(join(dir, 'camera.json'), JSON.stringify({ stops: [{ scene: 'intro' }], viewport: { aspect: 1 } }));
  await writeFile(join(dir, 'interactions.json'), JSON.stringify({ schemaVersion: 1, interactions: [] }));
  await persistAfterGenerate(db, id, dir);

  // Valid: stop 'intro' is in context.
  validateAndStore(db, id, [{ id: 'intro.q1', stop: 'intro', type: 'mcq', prompt: 'q',
    config: { options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] } }]);
  assert.equal(readInteractions(db, id).interactions!.length, 1);

  // Invalid: stop 'ghost' is not in context → 400.
  assert.throws(
    () => validateAndStore(db, id, [{ id: 'x', stop: 'ghost', type: 'reveal', prompt: 'p', config: { target: '#g', reveal: 'x' } }]),
    (e: any) => e instanceof HttpError && e.status === 400,
  );
  db.close();
});

test('persistAfterGenerate is a no-op when the dir has no camera.json (stub path)', async () => {
  const db = openDb(':memory:');
  const id = seed(db);
  const dir = mkdtempSync(join(tmpdir(), 'iax-store-'));
  await persistAfterGenerate(db, id, dir); // empty dir
  assert.deepEqual(readInteractions(db, id), { interactions: null, context: null });
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/interactions-store.test.ts`
Expected: FAIL — `Cannot find module '../src/interactions-store.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/interactions-store.ts
import type { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from './http.ts';
// The #5 engine validator (stdlib, no deps). Path is relative to src/.
import { validateInteractions } from './prezi/interactions-schema.mjs';

// Generator-agnostic persistence for the interaction layer (spec §7). The DB holds the editable
// set (`interactions`) and a referential-integrity snapshot (`interaction_context = { stopIds }`)
// captured from the last generation, so edits can be validated without re-running generation.

export interface InteractionContext { stopIds: string[]; }
export interface StoredInteractions {
  interactions: unknown[] | null;
  context: InteractionContext | null;
}

interface Row { interactions: string | null; interaction_context: string | null; }

function parse<T>(s: string | null): T | null {
  if (s == null) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

/** Read the stored set + context for a presentation (no ownership check — callers enforce it). */
export function readInteractions(db: DatabaseSync, id: number): StoredInteractions {
  const row = db.prepare('SELECT interactions, interaction_context FROM presentations WHERE id = ?').get(id) as Row | undefined;
  if (!row) return { interactions: null, context: null };
  return {
    interactions: parse<unknown[]>(row.interactions),
    context: parse<InteractionContext>(row.interaction_context),
  };
}

/**
 * Validate a proposed edited set against the stored context, then store it.
 * @throws HttpError 409 if the presentation has never been generated (no context to validate against)
 * @throws HttpError 400 if the set is invalid (bad type, dangling stop/goto, dup id, caps, …)
 */
export function validateAndStore(db: DatabaseSync, id: number, interactions: unknown[]): void {
  const { context } = readInteractions(db, id);
  if (!context) throw new HttpError(409, 'publish this presentation first to generate its interaction targets');
  const stopIds = new Set(context.stopIds);
  // Branch `goto` targets a navigable stop scene; validate goto against the same stop-scene set.
  const { valid, errors } = validateInteractions({ schemaVersion: 1, interactions }, { stopIds, sceneIds: stopIds });
  if (!valid) throw new HttpError(400, 'invalid interactions: ' + errors.slice(0, 5).join('; '));
  db.prepare('UPDATE presentations SET interactions = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(interactions), Date.now(), id);
}

/**
 * Ingest the freshly-generated artifact dir: capture the stop snapshot from camera.json and the
 * shipped interaction set from interactions.json. No-op if camera.json is absent (e.g. the stub
 * generator wrote no IR-based artifacts — leave the columns untouched).
 */
export async function persistAfterGenerate(db: DatabaseSync, id: number, outDir: string): Promise<void> {
  let camera: { stops?: { scene: string }[] } | null = null;
  try { camera = JSON.parse(await readFile(join(outDir, 'camera.json'), 'utf8')); } catch { camera = null; }
  if (!camera || !Array.isArray(camera.stops)) return; // stub path / non-IR generator → no-op

  const stopIds = camera.stops.map((s) => s.scene).filter((s): s is string => typeof s === 'string');

  let interactions: unknown[] = [];
  try {
    const doc = JSON.parse(await readFile(join(outDir, 'interactions.json'), 'utf8'));
    if (doc && Array.isArray(doc.interactions)) interactions = doc.interactions;
  } catch { interactions = []; }

  db.prepare('UPDATE presentations SET interactions = ?, interaction_context = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(interactions), JSON.stringify({ stopIds }), Date.now(), id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/interactions-store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/interactions-store.ts test/interactions-store.test.ts
git commit -m "feat(#5): interactions store — read/validate/persist with context snapshot"
```

---

## Task 3: API handlers + routes

**Files:**
- Modify: `src/presentations.ts`
- Modify: `src/app.ts`
- Test: `test/interactions-api.test.ts`

- [ ] **Step 1: Add the two handlers in `src/presentations.ts`**

Add the import at the top (after the existing imports):

```ts
import { readInteractions, validateAndStore } from './interactions-store.ts';
```

Add at the end of the file (they reuse the module-private `ownedOr404`/`parseId`):

```ts
// GET /api/presentations/:id/interactions
export function getInteractions(req: IncomingMessage, res: ServerResponse, ctx: Ctx, params: Params): void {
  const session = requireSession(req, ctx);
  const row = ownedOr404(ctx, parseId(params), session.userId);
  const stored = readInteractions(ctx.db, row.id);
  sendJson(res, 200, {
    interactions: stored.interactions ?? [],
    context: stored.context, // null until first generation → UI shows "publish first"
    editable: stored.context != null,
  });
}

// PATCH /api/presentations/:id/interactions { interactions: [...] }
export async function setInteractions(req: IncomingMessage, res: ServerResponse, ctx: Ctx, params: Params): Promise<void> {
  const session = requireSession(req, ctx);
  const row = ownedOr404(ctx, parseId(params), session.userId);
  const body = await readJson(req, ctx.config.maxBodyBytes);
  if (!Array.isArray(body.interactions)) throw new HttpError(400, 'interactions must be an array');
  validateAndStore(ctx.db, row.id, body.interactions); // throws HttpError 400/409
  const stored = readInteractions(ctx.db, row.id);
  sendJson(res, 200, { interactions: stored.interactions ?? [] });
}
```

- [ ] **Step 2: Register the routes in `src/app.ts`**

Update the presentations import. Find:

```ts
import { list, create, detail, update, publish } from './presentations.ts';
```

Change to:

```ts
import { list, create, detail, update, publish, getInteractions, setInteractions } from './presentations.ts';
```

Then add the routes after the publish route. Find:

```ts
  r.post('/api/presentations/:id/publish', publish);
```

Add below it:

```ts
  r.get('/api/presentations/:id/interactions', getInteractions);
  r.patch('/api/presentations/:id/interactions', setInteractions);
```

- [ ] **Step 3: Write the failing test (integration, with an interaction-emitting fake generator)**

```ts
// test/interactions-api.test.ts
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bootTestApp, signIn } from './helpers.ts';
import type { TestApp } from './helpers.ts';
import type { GenInput } from '../src/generator.ts';

// A fake #3-style generator: writes camera.json + interactions.json so the worker can ingest them.
// It ECHOES an injected override (input.interactions) to prove the re-publish override path.
function fakeGenerator() {
  return async (input: GenInput, outDir: string) => {
    await mkdir(outDir, { recursive: true });
    const proposed = input.interactions ?? [
      { id: 'intro.r1', stop: 'intro', type: 'reveal', prompt: 'Reveal', config: { target: '#g', reveal: 'x' } },
    ];
    await writeFile(join(outDir, 'camera.json'), JSON.stringify({ stops: [{ scene: 'intro' }, { scene: 'f1' }], viewport: { aspect: 1.78 } }));
    await writeFile(join(outDir, 'interactions.json'), JSON.stringify({ schemaVersion: 1, interactions: proposed }));
    const manifest = {
      schemaVersion: 1, generator: 'fake@1', generatedAt: new Date().toISOString(),
      presentationId: input.id, title: input.title, slug: input.slug, entry: 'index.html',
      artifacts: ['index.html', 'manifest.json', 'camera.json', 'interactions.json'],
    };
    await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest));
    return manifest;
  };
}

let current: TestApp | null = null;
afterEach(async () => { if (current) { await current.app.close(); current = null; } });

async function publishAndDrain(t: TestApp, c: ReturnType<typeof import('./helpers.ts').makeClient>, id: number) {
  await c.request('POST', `/api/presentations/${id}/publish`);
  await t.app.worker.drain();
}

test('GET interactions is empty + non-editable before any publish', async () => {
  const t = (current = await bootTestApp({ pollMs: 1e9, generator: fakeGenerator() }));
  const c = await signIn(t, 'iax@example.com');
  const id = (await c.request('POST', '/api/presentations', { body: { title: 'T' } })).json.presentation.id;
  const r = await c.request('GET', `/api/presentations/${id}/interactions`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.interactions, []);
  assert.equal(r.json.editable, false);
});

test('after publish the proposed set + context are returned and editable', async () => {
  const t = (current = await bootTestApp({ pollMs: 1e9, generator: fakeGenerator() }));
  const c = await signIn(t, 'iax@example.com');
  const id = (await c.request('POST', '/api/presentations', { body: { title: 'T' } })).json.presentation.id;
  await publishAndDrain(t, c, id);

  const r = await c.request('GET', `/api/presentations/${id}/interactions`);
  assert.equal(r.json.editable, true);
  assert.deepEqual(r.json.context.stopIds, ['intro', 'f1']);
  assert.equal(r.json.interactions[0].id, 'intro.r1');
});

test('PATCH validates against context: a valid edit is stored, a bad stop is rejected', async () => {
  const t = (current = await bootTestApp({ pollMs: 1e9, generator: fakeGenerator() }));
  const c = await signIn(t, 'iax@example.com');
  const id = (await c.request('POST', '/api/presentations', { body: { title: 'T' } })).json.presentation.id;
  await publishAndDrain(t, c, id);

  const good = await c.request('PATCH', `/api/presentations/${id}/interactions`, {
    body: { interactions: [{ id: 'f1.q1', stop: 'f1', type: 'mcq', prompt: 'q', config: { options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] } }] },
  });
  assert.equal(good.status, 200);
  assert.equal(good.json.interactions[0].id, 'f1.q1');

  const bad = await c.request('PATCH', `/api/presentations/${id}/interactions`, {
    body: { interactions: [{ id: 'z', stop: 'ghost', type: 'reveal', prompt: 'p', config: { target: '#g', reveal: 'x' } }] },
  });
  assert.equal(bad.status, 400);
});

test('re-publish bakes the edited set (override round-trips through the generator)', async () => {
  const t = (current = await bootTestApp({ pollMs: 1e9, generator: fakeGenerator() }));
  const c = await signIn(t, 'iax@example.com');
  const id = (await c.request('POST', '/api/presentations', { body: { title: 'T' } })).json.presentation.id;
  await publishAndDrain(t, c, id);

  // Edit → keep a single mcq on 'intro'.
  await c.request('PATCH', `/api/presentations/${id}/interactions`, {
    body: { interactions: [{ id: 'intro.q1', stop: 'intro', type: 'mcq', prompt: 'q', config: { options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] } }] },
  });
  // Re-publish: the worker passes the edited set into the generator, which writes it back.
  await publishAndDrain(t, c, id);

  const after = await c.request('GET', `/api/presentations/${id}/interactions`);
  assert.equal(after.json.interactions.length, 1);
  assert.equal(after.json.interactions[0].id, 'intro.q1');
  assert.equal(after.json.interactions[0].type, 'mcq');
});

test('PATCH before publish is rejected 409 (no context yet)', async () => {
  const t = (current = await bootTestApp({ pollMs: 1e9, generator: fakeGenerator() }));
  const c = await signIn(t, 'iax@example.com');
  const id = (await c.request('POST', '/api/presentations', { body: { title: 'T' } })).json.presentation.id;
  const r = await c.request('PATCH', `/api/presentations/${id}/interactions`, { body: { interactions: [] } });
  assert.equal(r.status, 409);
});

test("a non-owner cannot read another user's interactions", async () => {
  const t = (current = await bootTestApp({ pollMs: 1e9, generator: fakeGenerator() }));
  const owner = await signIn(t, 'owner@example.com');
  const id = (await owner.request('POST', '/api/presentations', { body: { title: 'T' } })).json.presentation.id;
  const other = await signIn(t, 'intruder@example.com');
  const r = await other.request('GET', `/api/presentations/${id}/interactions`);
  assert.equal(r.status, 404);
});
```

> The override round-trip in the 4th test depends on Task 4 (worker passing `input.interactions`). Those two tests (`re-publish bakes…`) will only pass after Task 4. Run Task 3's other tests now; the override test goes green after Task 4 Step 4.

- [ ] **Step 4: Run test to verify it fails, then (after handlers) passes the non-override cases**

Run: `node --test test/interactions-api.test.ts`
Expected: the GET/PATCH/ownership/409 tests PASS; the `re-publish bakes the edited set` test FAILS until Task 4 (the worker does not yet pass the override). That is expected — proceed to Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/presentations.ts src/app.ts test/interactions-api.test.ts
git commit -m "feat(#5): interactions API — GET + PATCH with owner + referential-integrity checks"
```

---

## Task 4: Worker override + readback

**Files:**
- Modify: `src/generator.ts` (extend `GenInput`)
- Modify: `src/prezi/generate.mjs` (`makePreziGenerator` honors the override)
- Modify: `src/worker.ts` (pass stored set in; ingest shipped set out)

- [ ] **Step 1: Extend `GenInput` in `src/generator.ts`**

Find:

```ts
export interface GenInput {
  id: number;
  title: string;
  sourceWriteup: string;
  slug: string;
}
```

Change to:

```ts
export interface GenInput {
  id: number;
  title: string;
  sourceWriteup: string;
  slug: string;
  // Optional per-job interaction OVERRIDE (#5 §6): when present, the #3 generator bakes this set
  // instead of proposing fresh ones. The stub generator ignores it.
  interactions?: unknown[];
}
```

- [ ] **Step 2: Honor the override in `makePreziGenerator` (`src/prezi/generate.mjs`)**

At the top of `src/prezi/generate.mjs`, the engine plan already imports `interactivize`. Add the deterministic proposer import alongside it:

```js
import { interactivize, deterministicInteractivize } from './interactivize.mjs';
```

> If the engine plan imported only `{ interactivize }`, change that line to include `deterministicInteractivize`.

Then find `makePreziGenerator`:

```js
export function makePreziGenerator(deps = {}) {
  return async (genInput, outDir) => {
    let research = deps.research;
    if (!research) {
      const { runResearch } = await import('../research/pipeline.mjs');
      const r = await runResearch(genInput.sourceWriteup || genInput.title, { llm: deps.llm || null });
      research = r.doc;
    }
    return generatePresentation(
      { id: genInput.id, title: genInput.title, slug: genInput.slug, writeup: genInput.sourceWriteup, research },
      outDir,
      deps,
    );
  };
}
```

Change the `generatePresentation` call to inject the interaction proposer (override > explicit dep > deterministic default):

```js
export function makePreziGenerator(deps = {}) {
  return async (genInput, outDir) => {
    let research = deps.research;
    if (!research) {
      const { runResearch } = await import('../research/pipeline.mjs');
      const r = await runResearch(genInput.sourceWriteup || genInput.title, { llm: deps.llm || null });
      research = r.doc;
    }
    const proposer = genInput.interactions
      ? () => genInput.interactions               // re-publish: bake the instructor's edited set
      : deps.interactivize ?? deterministicInteractivize; // first publish: propose
    return generatePresentation(
      { id: genInput.id, title: genInput.title, slug: genInput.slug, writeup: genInput.sourceWriteup, research },
      outDir,
      { ...deps, interactivize: proposer },
    );
  };
}
```

- [ ] **Step 3: Wire the worker (`src/worker.ts`)**

Add the import at the top:

```ts
import { readInteractions, persistAfterGenerate } from './interactions-store.ts';
```

In `makeGenerateHandler`, find:

```ts
    const slug = mintUniqueSlug(ctx.db, pres.title);
    const outDir = join(ctx.config.dataDir, 'presentations', String(pres.id));
    const manifest = await generator({ id: pres.id, title: pres.title, sourceWriteup: pres.source_writeup, slug }, outDir);

    ctx.db
      .prepare(`UPDATE presentations SET status = 'published', slug = ?, updated_at = ? WHERE id = ?`)
      .run(slug, Date.now(), pres.id);
```

Change to:

```ts
    const slug = mintUniqueSlug(ctx.db, pres.title);
    const outDir = join(ctx.config.dataDir, 'presentations', String(pres.id));

    // Re-publish override (#5 §6): hand the generator the instructor's stored set, if any.
    const stored = readInteractions(ctx.db, pres.id).interactions;
    const genInput = { id: pres.id, title: pres.title, sourceWriteup: pres.source_writeup, slug,
      ...(stored ? { interactions: stored } : {}) };
    const manifest = await generator(genInput, outDir);

    // Ingest what shipped (proposed set on first publish, baked edits on re-publish) + the stop
    // snapshot. No-op for the stub generator (no camera.json written).
    await persistAfterGenerate(ctx.db, pres.id, outDir);

    ctx.db
      .prepare(`UPDATE presentations SET status = 'published', slug = ?, updated_at = ? WHERE id = ?`)
      .run(slug, Date.now(), pres.id);
```

- [ ] **Step 4: Run the API + publish suites — override + readback now green, stub path unaffected**

Run: `node --test test/interactions-api.test.ts test/publish.test.ts`
Expected: PASS — including `re-publish bakes the edited set` (Task 3's override test) AND the existing `publish.test.ts` (the stub generator writes no `camera.json`, so `persistAfterGenerate` no-ops and the stub artifact assertions are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/generator.ts src/prezi/generate.mjs src/worker.ts
git commit -m "feat(#5): worker passes stored interactions as override + ingests shipped set"
```

---

## Task 5: Editor UI — interactions panel

**Files:**
- Modify: `public/app.js`
- Modify: `public/app.css`

No unit test (browser DOM glue; `public/app.js` has none by convention — the API behavior it calls is covered by Task 3). Verified by the manual smoke check in Step 4.

- [ ] **Step 1: Add an interactions panel renderer in `public/app.js`**

Add this function above `async function render()` (it uses the existing `el`, `clear`, `api`, `notice` helpers already defined in the file):

```js
// --- interactions editor (#5 §6): minimal accept / edit / delete / reorder / add ---
async function renderInteractions(container, id) {
  clear(container);
  container.append(el('h2', {}, 'Interactions'));
  const status = el('div');
  let state;
  try { state = await api('GET', '/api/presentations/' + id + '/interactions'); }
  catch (err) { container.append(notice(err.message, 'error')); return; }

  if (!state.editable) {
    container.append(el('p', { class: 'muted' }, 'Publish this presentation to generate proposed interactions you can refine here.'), status);
    return;
  }

  let items = state.interactions.slice();
  const stopIds = (state.context && state.context.stopIds) || [];
  const listWrap = el('div', { class: 'iax-list' });

  function move(i, d) { const j = i + d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; draw(); }
  function del(i) { items.splice(i, 1); draw(); }
  function add() {
    items.push({ id: 'new.' + Date.now().toString(36), stop: stopIds[0] || '', type: 'reveal', prompt: 'New interaction',
      config: { target: '#scene', reveal: 'Detail' } });
    draw();
  }

  function draw() {
    clear(listWrap);
    if (!items.length) listWrap.append(el('p', { class: 'muted' }, 'No interactions. Add one below.'));
    items.forEach((it, i) => {
      const head = el('div', { class: 'iax-row' },
        el('span', { class: 'badge ' + it.type }, it.type),
        el('input', { class: 'iax-prompt', value: it.prompt || '', oninput: (e) => { it.prompt = e.target.value; } }),
        el('span', { class: 'muted' }, '@' + (it.stop || '?')),
        el('button', { class: 'secondary', onclick: () => move(i, -1) }, '↑'),
        el('button', { class: 'secondary', onclick: () => move(i, 1) }, '↓'),
        el('button', { class: 'secondary', onclick: () => del(i) }, 'Delete'),
      );
      // Deep config edit (all four types) via a compact JSON field — keeps the UI minimal.
      const cfg = el('textarea', { class: 'iax-config', rows: '3' });
      cfg.value = JSON.stringify({ stop: it.stop, config: it.config }, null, 0);
      cfg.addEventListener('change', () => {
        try { const o = JSON.parse(cfg.value); if (o.stop) it.stop = o.stop; if (o.config) it.config = o.config; cfg.style.borderColor = ''; }
        catch { cfg.style.borderColor = '#ff6b75'; }
      });
      listWrap.append(el('div', { class: 'iax-item' }, head, cfg));
    });
  }
  draw();

  container.append(
    listWrap,
    el('div', { class: 'row' },
      el('button', { class: 'secondary', onclick: add }, '+ Add interaction'),
      el('button', { onclick: async () => {
        clear(status);
        try { const r = await api('PATCH', '/api/presentations/' + id + '/interactions', { interactions: items });
          items = r.interactions.slice(); draw();
          status.append(notice('Saved. Re-publish to bake these into the live presentation.', 'ok')); }
        catch (err) { status.append(notice(err.message, 'error')); }
      } }, 'Save interactions'),
    ),
    status,
  );
}
```

- [ ] **Step 2: Mount the panel inside `viewEditor`**

In `viewEditor(id)`, find the end of the `appEl.append( … )` block that builds the editor (it ends with `status, linkWrap,` and a closing `);`). Immediately after that `appEl.append(...)` call, add:

```js
  const iaxWrap = el('div', { class: 'iax-panel' });
  appEl.append(iaxWrap);
  renderInteractions(iaxWrap, id).catch(() => {});
```

Then, so the panel refreshes after a publish completes, update the `refresh()` function inside `viewEditor`. Find:

```js
  async function refresh() {
    const pres = (await api('GET', '/api/presentations/' + id)).presentation;
    clear(badge); badge.className = 'badge ' + pres.status; badge.append(pres.status);
    showLink(pres);
    if (pres.status === 'published' || pres.status === 'failed') { clearInterval(poll); poll = null; }
  }
```

Change to:

```js
  async function refresh() {
    const pres = (await api('GET', '/api/presentations/' + id)).presentation;
    clear(badge); badge.className = 'badge ' + pres.status; badge.append(pres.status);
    showLink(pres);
    if (pres.status === 'published' || pres.status === 'failed') {
      clearInterval(poll); poll = null;
      if (pres.status === 'published') renderInteractions(iaxWrap, id).catch(() => {}); // refresh proposed set
    }
  }
```

> Note: `iaxWrap` is declared after `refresh` in source order but only *referenced* when `refresh` runs (after a publish, well after `viewEditor` finishes building). Since `viewEditor` is one function scope and `iaxWrap` is a `const` assigned before any `refresh()` call can fire, this is safe. If your linter flags use-before-declaration, move the `const iaxWrap = el(...)` line up to just below `const linkWrap = el('div');`.

- [ ] **Step 3: Add minimal CSS in `public/app.css`**

Append:

```css
.iax-panel { margin-top: 2rem; border-top: 1px solid #20294f; padding-top: 1rem; }
.iax-item { margin: .5rem 0; padding: .5rem; border: 1px solid #20294f; border-radius: 8px; }
.iax-row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
.iax-prompt { flex: 1; min-width: 12rem; }
.iax-config { width: 100%; margin-top: .4rem; font-family: ui-monospace, monospace; font-size: 12px; }
```

- [ ] **Step 4: Manual smoke test (dev-auth bypass)**

Run the server with dev auth, create + publish a presentation with an interaction-capable generator, and confirm the panel renders. Since the worker default is still the stub (no proposed interactions), this smoke test confirms the **"publish first" / non-editable** branch and that the panel does not error:

Run: `DEV_MODE=true DEV_AUTH_BYPASS=true npm start` then, in a browser, visit `http://localhost:<port>/api/dev/login` then `/` → create a presentation → open the editor → confirm the "Interactions" panel shows the muted "Publish this presentation to generate proposed interactions" message and no console errors.
Expected: panel renders without error; after a publish via the stub it stays non-editable (stub writes no `camera.json`), which is correct until the #3 generator is wired.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/app.css
git commit -m "feat(#5): editor interactions panel — accept/edit/delete/reorder/add + save"
```

---

## Task 6: Full-suite regression gate

**Files:** none (verification only)

- [ ] **Step 1: Run the entire suite**

Run: `npm test`
Expected: PASS — all pre-existing tests + the new store/API tests. No regressions. Note the total count for the CLAUDE.md handoff.

- [ ] **Step 2: Supply-chain + secret gates (zero new deps were added)**

Run: `npm run audit:deps && npm run scan:secrets`
Expected: PASS.

- [ ] **Step 3: Commit any incidental fixes**

```bash
git add -A
git commit -m "test(#5): full-suite green — interactive artifact editor + persistence complete"
```

---

## Self-Review (completed during planning)

**Spec coverage (§6–§7):**
- §6 instructor refine editor: accept/edit/delete/reorder/add → Task 5 panel; agent-proposes path → Task 4 override default (`deterministicInteractivize` on first publish) ✓
- §6 re-publish bakes edits → Task 4 override + Task 3 round-trip test ✓
- §7 editable set stored on the `presentations` record (`interactions` column) + referential-integrity snapshot (`interaction_context`) → Tasks 1–2 ✓
- §7 no student/response tables → none added (those are #6) ✓
- §8 graceful: invalid edits rejected (400), missing context (409), stub path no-op → Tasks 2–4 ✓

**Placeholder scan:** No TBD/TODO. The "read the file header first" steps (Task 1 Step 1, Task 5 Step 2 anchors) are real binding instructions to match existing local names, not placeholders — every code block is complete.

**Type consistency:** `readInteractions→{interactions,context}`, `validateAndStore(db,id,interactions)`, `persistAfterGenerate(db,id,outDir)`, `InteractionContext{stopIds}`, handler names `getInteractions`/`setInteractions`, `GenInput.interactions`, generate.mjs proposer override — all names consistent across Tasks 1→5. Routes use `PATCH` (the Router exposes `patch`, not `put`) consistently in app.ts + tests + UI. The API context validates `goto` against the stop-scene set (documented in `validateAndStore`), matching the engine's `resolveGotoIndex(stops, scene)` runtime behavior.

**Cross-plan dependency:** asserted up-front — needs the engine plan's `interactions-schema.mjs` (validator) and `generate.mjs` interaction emission. The real #3-generator-in-worker path is gated on the LLM/spike (stated in the Scope note); this plan's loop is proven offline via the injected `fakeGenerator`.

---

## Execution Handoff

This completes spec #5 (engine + editor/persistence). Remaining #5-adjacent work, each its own future plan:
1. **Wire the #3 generator into the worker** (replace `generateStub` with `makePreziGenerator`) — needs the #2 LLM research path + the Hermes drivability spike. Once done, real agent-proposed interactions flow through this editor with no further changes here.
2. **Sub-project #6 — Classroom & Capture** (students/cohorts/assignments/attempts/responses, tokenized class-mode serving, capture endpoint, agent-graded free-text, instructor dashboards) — layers onto the stable interaction ids this plan persists.
