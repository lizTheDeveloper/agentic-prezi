# Sub-project #5 — Interactive Artifact Layer — Design Spec

**Date:** 2026-06-08
**Status:** Draft for review
**Parent:** `2026-06-08-agentic-prezi-vision-design.md`
**Inherits:** `2026-06-08-sub0-security-supply-chain-design.md` (all controls apply)
**Consumes:** #3's scene-graph IR + `player.js` runtime + generation pipeline; #1's editor, publish path, and static subdomain serving
**Fulfills:** the **C9** capability identified in `docs/strategy/2026-06-08-value-chain-feature-mapping.md` (interactive pedagogy)
**Sibling (specced next):** **#6 Classroom & Capture** (recorded responses, students/cohorts, assessment) — see §11

> This repository is **public**. No secrets in source. See `CLAUDE.md`.

---

## 1. Purpose & honest scope

Turn a published Prezi artifact from something a viewer **watches** into something a learner
**does** — by layering interactions onto the existing zooming presentation:

- **reveal / hotspot** — click to progressively disclose detail or zoom a hotspot
- **multiple-choice checkpoint** — a question at a camera stop with instant feedback
- **branching choice** — the learner's choice changes which scene the tour visits next
- **free-text** — a prompt with an **embedded model answer / rubric** the learner reveals to self-check

All four run in **public, anonymous, fully-static self-check mode**: interactions execute entirely
in the viewer's browser, nothing is recorded, and the artifact stays a static, no-cookie,
CSP-locked asset on the published origin (#1 §6, #0 §B4). This preserves the marketing surface
(every interactive deck is still publicly shareable) and adds **no new privacy or egress surface.**

### What #5 delivers
Engagement, shareable interactive demos (marketing), and **self-check learning**.

### What #5 explicitly does NOT do (deferred to #6 — §11)
Recorded responses, student identity, cohorts/enrollment, assignments, instructor visibility,
**agent-graded** free-text, and any backend write path. **Honest framing:** the
formative-assessment / instructor-visibility value that "enhance class delivery" fully implies
**waits for #6.** #5 ships the engagement substrate + self-check learning that #6 builds on.

---

## 2. Position in the build & the additive seam

#5 sequences **after #3** (it consumes #3's IR, runtime, and generation) and integrates with
**#1** (editor, publish, serve). It changes **no existing contract**; it only adds:

- **One new artifact** (`interactions.json`, §3) to the set #1 serves and #3 produces.
- **One generation step** (`INTERACTIVIZE`, §5) after Compose.
- **Player support** for that artifact (§4) — additive to the existing `player.js`.
- **A minimal editor panel** (§6) in the #1 SPA.

**Additive guarantee:** a presentation with **zero interactions renders exactly as today.** #1's
**stub generator** stays valid by emitting an empty/absent `interactions.json`; #3's existing
artifacts are untouched. This is a hard regression-test requirement (§9).

---

## 3. The interaction contract (`interactions.json`)

A **separate artifact** written to `data/presentations/<id>/` alongside the existing set
(`presentation.svg`, `camera.json`, `player.js`, `index.html`, `manifest.json`).

**Why a separate file, not folded into the scene-graph SVG/IR:**
1. Keeps #1's stub-generator seam and #3's SVG/`camera.json` contract **untouched** (additive).
2. Lets **#6 attach responses by interaction `id`** and switch public↔class behavior at
   **serve time — without regenerating artifacts.**
3. The player loads it independently; absent/empty → non-interactive deck (graceful, §8).

```jsonc
{
  "schemaVersion": 1,
  "interactions": [
    {
      "id": "intro.q1",            // STABLE id — the anchor #6 attaches responses to. Never reused/renumbered.
      "stop": "intro",             // camera stop (or scene id) this binds to (must exist in camera.json/IR)
      "type": "mcq",               // reveal | mcq | branch | freetext
      "prompt": "Which mechanism does the 2025 result implicate?",
      "config": {
        // ── type: "mcq" ──
        "options": [
          { "text": "…", "correct": false, "feedback": "Not quite — see the intro scene." },
          { "text": "…", "correct": true,  "feedback": "Right — this is the key finding." }
        ],
        "multiSelect": false
      }
    },
    {
      "id": "intro.reveal1", "stop": "intro", "type": "reveal",
      "prompt": "Tap to see the derivation",
      "config": { "target": "#derivation-group", "reveal": "<g …>…</g>" }   // target element + content to disclose
    },
    {
      "id": "method.branch1", "stop": "method", "type": "branch",
      "prompt": "Explore which pathway?",
      "config": { "choices": [
        { "text": "Experimental", "goto": "method.experiment" },   // goto MUST be an existing stop/scene
        { "text": "Theoretical",  "goto": "method.theory" }
      ] }
    },
    {
      "id": "implications.ft1", "stop": "implications", "type": "freetext",
      "prompt": "In one sentence, why does this matter?",
      "config": {
        "modelAnswer": "…",        // EMBEDDED in the artifact; shown on self-check reveal
        "rubric": ["mentions X", "links to finding Y"]   // optional self-check checklist
        // NO grading, NO scoring, NO network in #5. Agent-graded free-text is #6.
      }
    }
  ]
}
```

- **Validated by a published-safe JSON Schema** before publish (mirrors #3 §3's IR validation).
- **Stable ids** are a contract requirement: #6 keys recorded responses to them, so an id, once
  shipped, is **never reused for a different question.**
- `stop`/`goto` referential integrity is checked at generation (§8): every referenced stop/scene
  must exist in the IR/`camera.json`.
- `manifest.json` gains an `interactions` summary (count by type, schema version) **when interactions are present** — additive, and **omitted for zero-interaction decks** so their manifest is unchanged from today (§9 regression guard).

---

## 4. Player runtime (`player.js`) — fixed, deterministic, CSP-safe

The interaction engine is a **fixed runtime**, **not** agent-generated. **Only the interaction
*data* (`interactions.json`) is produced by the agent.**

> **Risk note (deliberate):** because the runtime is fixed and deterministic, the interaction
> engine is **fully unit-testable and independent of the Hermes drivability spike** (vision-spec
> Milestone zero). Only declarative data rides along with the ⚠️ GENERATE step; if generation is
> weak, interactions degrade to "none," never to "broken." This materially lowers #5's risk.

Responsibilities (additive to #3 §7's `player.js`):
- **Load** `interactions.json`; index interactions by `stop`.
- **Render** the interaction UI when the camera arrives at a stop (reveals as overlays/affordances
  inside the SVG coordinate space; questions in a CSP-clean DOM panel anchored to the stop).
- **Run** behavior fully client-side:
  - *reveal* — toggle disclosure of the target/content.
  - *mcq* — select → show per-option feedback + correct/incorrect; no scoring persisted.
  - *branch* — choice sets the **next camera stop**, reusing the existing tour/camera engine.
  - *freetext* — free input + a "reveal model answer / rubric" self-check; nothing sent anywhere.
- **Constraints (non-negotiable, inherit #3 §7 / #0 §B4):** zero dependencies; satisfies
  `default-src 'self'`; **no inline event handlers, no `eval`/`new Function`**; honors
  `prefers-reduced-motion`; responsive; **accessible** (interactions are real focusable DOM/SVG
  with roles/labels/keyboard support).
- **Pure, unit-testable functions** for: stop→interactions lookup, branch resolution
  (`goto` → next stop), reveal/answer state machines.

---

## 5. Generation — the `INTERACTIVIZE` step (agent proposes)

A new pipeline step **after Compose** (#3 §5), before/independent of the vision loop:

```
scene-graph IR (+ findings, write-up)
  → COMPOSE        (#3) findings → scene-graph IR
  → INTERACTIVIZE  agent reads IR + scene.intent + findings → proposes interactions
                   aligned to each scene's intent; emit declarative interactions.json
  → GENERATE ⚠️    (#3) IR → presentation.svg + camera.json + player.js + index.html
  → VISION LOOP    (#3) + light overlap/clip check that interaction UI doesn't collide (§5.1)
  → PUBLISH        (#1) writes interactions.json with the rest of the artifact set
```

- **Alignment to intent:** the agent maps interactions to pedagogical beats — an **mcq** checking a
  scene's key claim, a **reveal** for nested detail, a **branch** at a genuine decision point, a
  **freetext** prompt whose `modelAnswer` is drawn from the findings (so the self-check answer is
  itself grounded — ties to #2's cited findings).
- **Output is declarative data only** (no code) → schema-validated → `interactions.json`.
- **Deterministic guardrails:** schema validation, **caps per scene and per deck** (config), and
  referential-integrity checks (§8). Interactions that fail validation are dropped, not published.
- **Engine note:** INTERACTIVIZE is an orchestration-layer model call producing JSON; it does **not**
  require `execute_code`/the code sandbox. So it survives a Hermes-spike failure on the same terms
  as #3's Compose (it's a model→JSON step, like #2 synthesis), independent of the ⚠️ GENERATE driver.

### 5.1 Vision-loop scope for interactions (YAGNI)
v1 adds **only** a light check, reusing #3's overlap/clipping critique: **interaction UI must not
overlap or clip scene content** at its stop's zoom level. **Not in v1:** agentic critique of
*pedagogical quality* (is this a good question?). That's a later enhancement; the instructor refine
step (§6) is the human quality gate for v1.

---

## 6. Instructor refine editor (extends #1's editor)

Minimal, in the #1 React SPA editor — **not** a full authoring studio:

- After generation, show the agent's **proposed interactions grouped by scene/stop**.
- Per interaction: **accept / edit / delete / reorder**. Edit covers the prompt, options/feedback,
  branch targets, and the free-text `modelAnswer`/`rubric`.
- **Add** a simple interaction by hand (same four types) — optional, low-effort.
- Saving rewrites the presentation's interaction set; **re-publish regenerates `interactions.json`**
  (separable file → cheap to rewrite without re-rendering the SVG).
- Validation (schema + referential integrity, §8) runs on save; invalid → inline error, not saved.

---

## 7. Data model (minimal #5 additions)

#5 stays near-static — interactions are **part of the presentation artifact**, not per-student state.

- The **editable interaction set** is stored against the presentation so the editor (§6) can round-trip
  it and re-publish deterministically. Implementation: a `presentation_interactions` row/JSON column
  on the #1 `presentations` record (the published `interactions.json` is the rendered output of it).
- **No `students`, `attempts`, `responses`, `cohorts`, or `assignments` tables** — all of that is **#6.**

---

## 8. Error handling & graceful degradation

- **Invalid interaction at generation** (schema fail, `stop`/`goto` references a non-existent
  scene, mcq `correct` index out of range, no correct option) → **that interaction is dropped**,
  the deck still publishes, the drop is logged in `manifest.quality`. One bad question never fails a
  publish.
- **Missing/malformed `interactions.json` at view time** → player runs the deck as a **normal
  non-interactive presentation** (never breaks viewing).
- **Branch `goto` resolves to nothing at runtime** (defense-in-depth beyond generation validation)
  → player falls back to the **linear next stop**.
- **Caps exceeded** → agent proposal is truncated to the cap deterministically; logged.

---

## 9. Testing (TDD per superpowers)

- **Schema:** valid/invalid `interactions.json` fixtures; `stop`/`goto` must reference existing
  scenes; mcq must have ≥1 correct option and in-range indices; unknown `type` rejected.
- **Player pure functions:** stop→interactions lookup; branch resolution (`goto`→next stop);
  reveal & answer state machines; reduced-motion path; deep-link still resolves with interactions present.
- **CSP / render:** an interactive artifact passes `default-src 'self'`, renders headless with **no
  console errors**, no inline handlers, no `eval`.
- **Generation:** agent proposal validates against the schema; per-scene/deck caps enforced; a
  deliberately-overlapping interaction fixture is flagged by the §5.1 check; an invalid proposed
  interaction is dropped while the deck still publishes.
- **Additive regression ⚑:** a **zero-interaction** deck produces an **identical viewer experience
  and artifact set to today** — no `interactions.json` (or an empty one), `manifest.json` unchanged,
  player behaves as the non-interactive #3 runtime (guards the #1 stub-generator seam and the #3
  artifact contract).
- **Editor:** accept/edit/delete/reorder round-trips through `interactions.json`; invalid edit
  rejected inline.

---

## 10. Security (inherits #0)

- **No new egress, no secrets, no write path, no PII, no cookies, no new origin.** #5 is static
  interaction **data** + a fixed runtime served from the existing CSP-locked published origin
  (#1 §6, #0 §B4).
- Interaction content is **untrusted, embedded data** — escaped/sanitized before it enters the SVG/DOM
  exactly as #1 §8 / #3 §9 require for generated content; the player must not interpret interaction
  data as executable (no `innerHTML` of model-supplied strings without sanitization, no `eval`).
- The INTERACTIVIZE model call runs in the **orchestration layer** (not the code sandbox), like
  #2 synthesis and #3 Compose; retrieved/embedded text is **data, not instructions**.

---

## 11. Forward-doc — #6 Classroom & Capture (specced separately)

#5 is deliberately the **engagement half**. The **capture/assessment half** is sub-project **#6**,
which layers onto #5 **without regenerating artifacts**, via the stable interaction `id`s (§3) and a
**serve-time mode switch** (same artifact bytes, two contexts):

- **Identity & grouping:** students are #1 `users` (reuse magic-link); add `cohorts`, `enrollments`,
  `assignments` (a presentation-exercise assigned to a cohort), `attempts`, `responses`.
- **Class-mode serving:** when an enrolled student opens an assignment from the **authenticated app
  origin**, the app mints a short-lived **attempt token** and serves the **same artifact** in a class
  context whose CSP **relaxes `connect-src`** to allow the player to POST responses to a **capture
  endpoint** — the *public* artifact never gains this. The static published artifact's security model
  (§10) is untouched.
- **Capture endpoint:** validates the attempt token, records `{attemptId, interactionId, answer}`.
- **Agent-graded free-text:** evaluated by an orchestration-layer model call against the rubric →
  feedback + score; **this is the network/eval path that #5 deliberately omits.**
- **Instructor results dashboard:** per-assignment/per-question aggregates and per-student progress.
- **Privacy/consent:** student PII handling, consent, retention, and public-vs-class data separation
  are first-class #6 concerns (out of scope for #5 precisely because #5 stores none).

#6 gets its own spec → plan → implementation cycle. Designing #5's contract (stable ids,
serve-time mode, separable `interactions.json`) so #6 is **purely additive** is an explicit goal of
this spec.

---

## 12. Open items (resolve in planning, not hand-waved)

1. **Per-scene / per-deck interaction caps** (default numbers) — set sane defaults in planning; expose as config. Bounds both clutter and INTERACTIVIZE cost.
2. **Interaction-anchor placement** in the SVG coordinate space — do reveal/question affordances live inside the scene `<g>` or in an overlay layer keyed to the stop? Lean: overlay layer positioned from the stop's bbox (keeps the SVG clean, simplifies the §5.1 overlap check). Finalize in planning.
3. **Editor surface depth** — confirm accept/edit/delete/reorder (+ optional manual-add) is the v1 boundary; resist scope-creep toward a full studio.
4. **`modelAnswer` sourcing** — how strongly to tie free-text self-check answers to #2 findings/citations (grounded self-check) vs. free agent phrasing. Lean grounded.
5. **Branch + linear-tour reconciliation** — how a branched path rejoins the main tour (merge points vs. dead-ends that zoom back out). Start minimal (branch then return to parent), expand later.
6. **Stable-id allocation scheme** — confirm the `<stop>.<kind><n>` convention and the rule that ids are append-only across re-publishes (so #6 response history stays valid).
