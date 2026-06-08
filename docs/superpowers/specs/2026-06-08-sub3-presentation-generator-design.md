# Sub-project #3 — Presentation Generator — Design Spec

**Date:** 2026-06-08
**Status:** Draft for review
**Parent:** `2026-06-08-agentic-prezi-vision-design.md` (§4)
**Inherits:** `2026-06-08-sub0-security-supply-chain-design.md`
**Consumes:** the research-input contract defined in §4 (fulfilled later by **#2**)
**Fulfills:** the artifact/manifest seam defined by **#1** (the stub generator is a degenerate case of this)

> **Spike-contingent.** The *Generate* stage runs code via Hermes (`execute_code`, `terminal.backend=docker`) — behavior the vision-spec **Milestone-zero spike** has not yet proven. Sections tagged ⚠️ depend on it; if the spike fails, see §11 fallback.

---

## 1. Purpose

Turn a write-up + researched, cited findings into an **engaging Prezi-style zooming SVG presentation**, then **agentically refine it by looking at it** (vision-review loop) until it reads well, and emit static artifacts the #1 publish path serves at `<slug>.themultiverse.school`.

The core decisions (locked at design time):
- **Render model:** one large SVG coordinate space; the "camera" animates `viewBox` / a CSS transform between scene bounding boxes. Agents emit **one `presentation.svg` + a `camera.json` tour**.
- **Vision loop screenshots:** **self-hosted Playwright/Chromium** in the sandbox — the same engine that serves viewers, so critiques match reality.

---

## 2. Output artifacts (the seam #1 serves; #3 fulfills in full)

Written to `data/presentations/<id>/` (per #1):

| File | What |
|---|---|
| `presentation.svg` | The whole presentation in one SVG coordinate space: scenes as `<g>` groups, nested for zoom-in detail. |
| `camera.json` | Ordered **tour**: camera stops (target scene bbox + transition hints). |
| `player.js` | Minimal **vanilla-JS** runtime (no deps) that drives the camera and navigation. See §7. |
| `index.html` | Loads the SVG + player; sets the strict CSP `<meta>`; responsive shell. |
| `assets/*` | Optional generated/raster images referenced by `<image>` (see §8). |
| `manifest.json` | Metadata: title, scene count, citations[], generator version, render dimensions, status, quality report. |

The #1 **stub generator** emits this same set in degenerate form (one scene, title + write-up text, single camera stop), so the contract is stable before #3 exists.

---

## 3. Scene-graph IR (the internal contract: Compose → Generate → Vision loop edits this)

A JSON document — the spatial narrative — that everything operates on. Not shipped to viewers; it compiles to `presentation.svg` + `camera.json`.

```jsonc
{
  "canvas": { "width": 10000, "height": 6000 },
  "scenes": [
    {
      "id": "intro",
      "parent": null,                 // nesting → Prezi zoom-into-detail
      "bbox": { "x": 0, "y": 0, "w": 3000, "h": 2000 },
      "intent": "Hook: state the question the research answers",
      "blocks": [
        { "type": "heading", "text": "…" },
        { "type": "body",    "text": "…" },
        { "type": "shape",   "svg": "<path …>" },
        { "type": "image",   "assetId": "fig1", "alt": "…" },
        { "type": "citation","refId": "smith2025" }
      ]
    }
    // … nested children placed inside their parent's bbox
  ],
  "tour": [
    { "scene": "intro", "transition": "zoom", "holdMs": 0 },
    { "scene": "intro.detailA", "transition": "zoom" }
    // … ordered camera stops
  ],
  "citations": [
    { "id": "smith2025", "title": "…", "authors": ["…"], "year": 2025,
      "venue": "…", "doi": "…", "url": "…" }
  ]
}
```

- **Nesting = the Prezi signature:** a child scene lives inside its parent's bbox; the tour can zoom from overview into detail and back out.
- **Layout:** Compose assigns non-overlapping bboxes (children packed within parent). Overlap/clipping is exactly what the vision loop catches and fixes.
- A published-safe **JSON Schema** validates the IR before Generate runs.

---

## 4. Research-input contract (consumed here; **#2** must produce this)

#3 expects a structured findings document so it never parses prose:

```jsonc
{
  "topic": "…",
  "narrative_outline": ["hook", "key finding 1", "…", "implications"],
  "findings": [
    { "claim": "…", "detail": "…", "importance": 1-5,
      "citations": ["smith2025", "doe2024"],
      "figure": { "caption": "…", "data_or_quote": "…" } }
  ],
  "citations": [ /* same shape as scene-graph citations */ ]
}
```

This is the **only** interface between #2 and #3 — #2 can change *how* it researches without touching #3.

---

## 5. Generation pipeline

```
research-input (§4) + write-up
  → COMPOSE        LLM: findings → scene-graph IR (spatial narrative + tour + layout)
  → GENERATE  ⚠️   agent (Hermes execute_code, docker): IR → presentation.svg + camera.json
                    + player.js + index.html
  → RENDER+SHOT    Playwright in sandbox: drive player to each camera stop, screenshot @ viewport
  → VISION CRITIQUE vision model: per-stop structured critique vs. scene.intent + global checks
  → REVISE         agent edits IR/SVG for flagged issues; re-render only affected stops
  ↑__________ loop (bounded) until quality bar or budget; then PUBLISH best-effort
```

### 5.1 Vision critique — structured output (not prose)
Per camera stop the vision model returns:
```jsonc
{ "stop": "intro", "issues": [
  { "kind": "overflow|clipping|contrast|legibility|alignment|off-intent|citation-missing|crowding",
    "severity": "high|med|low", "where": "…", "fix_hint": "…" } ],
  "matches_intent": true }
```
Global checks across stops: visual consistency, readable min font size at the stop's zoom level, WCAG-ish contrast, citation presence where claims appear, no overlapping scenes.

### 5.2 Loop control (bounded — cost/latency safety)
- **Max N iterations** (default 4) per presentation; **per-job token + wall-clock budget**.
- Stop when **no `high`-severity issues** remain, or budget hit.
- **Non-convergence:** publish the best iteration, set `manifest.quality.converged=false` + list residual issues (never hang or fail silently).
- **Re-render only affected stops** (cost control), not the whole tour each pass.
- All iterations logged for debugging; the chosen iteration is recorded.

---

## 6. Compose stage detail

- Input: research-input (§4) + the user's raw write-up (tone/intent).
- Output: a validated scene-graph IR — chooses the narrative beats, maps each to a scene, decides nesting (what zooms into what), assigns canvas layout, and orders the tour.
- Citations from findings are threaded into the scenes that use them and into `citations[]`.
- Deterministic guardrails: schema validation, max scene/nesting caps, reserved margins so text isn't placed at bbox edges (reduces clipping the vision loop would otherwise have to fix).

## 7. Player runtime (`player.js`) — minimal vanilla JS, CSP-safe

- **Zero dependencies** (honors #0; must pass CSP `default-src 'self'`).
- Loads `presentation.svg` inline + `camera.json`; computes each stop's target `viewBox`/transform.
- **Navigation:** next/prev (arrows, space), click-a-scene to zoom in, Esc to zoom out, scroll/swipe, on-screen progress; deep links via `#<stopId>`.
- **Camera animation:** eased `viewBox`/transform interpolation between stops; respects `prefers-reduced-motion` (instant cut).
- **Responsive:** scales the canvas to the viewport while preserving aspect; readable on mobile.
- Unit-testable pure functions for camera math (bbox → viewBox, interpolation).

## 8. Image generation (YAGNI-gated)

- Only when a scene's content genuinely needs generated imagery (diagram/illustration). Default: none.
- Hermes **image-gen tool** (Nous Portal) produces an asset → stored in `assets/` → referenced via SVG `<image>` with required `alt`.
- **Bounded count** per presentation (budget); images go through the same vision-critique pass; provenance noted in `manifest`.
- Prefer crisp **SVG/vector** content the agent draws directly over raster generation when possible.

## 9. Security (inherits #0)

- ⚠️ **All** code generation / `execute_code` / Playwright runs **only** in the Docker sandbox (#0 §B1), one ephemeral container per job, **no platform secrets** in the code sub-sandbox, **default-deny egress** there (image-gen/research happen in the orchestration layer, not the code sandbox).
- Generated SVG/JS is **untrusted**: served static from the per-presentation origin with strict CSP, no credentials (#0 §B4). The player's vanilla JS must satisfy `default-src 'self'` (no inline-eval, no external origins).
- Vision-critique and Compose model calls go through the orchestration layer (Nous Portal / OpenRouter), not from inside the code sandbox.

## 10. Quality, cost & determinism

- Per-job budgets (tokens, wall-clock, max iterations, max images) — all configurable, all enforced.
- Research results cached per presentation so re-publish doesn't re-research.
- `manifest.quality` records: converged?, iterations used, residual issues, budget spent.
- Re-runs are idempotent into a fresh artifact dir; publishing swaps atomically.

## 11. Engine dependency & spike contingency ⚠️

The **Generate** + **Revise** stages assume Hermes drives reliably headless, executes code in the Docker backend, and leaves artifacts we can read (vision-spec Milestone zero). **If the spike fails:**
- Fallback A: keep Compose/Vision/loop control in our Node orchestrator; swap the *code-writing* step to the **Claude Agent SDK / Claude Code headless** (Node-native) inside the same sandbox.
- Fallback B: direct-API code generation (model emits SVG/JS, our orchestrator writes files), losing agentic self-correction but keeping the vision loop.
- The scene-graph IR, player runtime, vision-critique schema, and artifact contract are **engine-agnostic** and survive either fallback — only the Generate step's driver changes.

## 12. Testing (TDD)

- **IR schema:** valid/invalid fixtures; overlap and over-nesting rejected.
- **Player:** camera-math pure functions; navigation state machine; reduced-motion; deep-link resolution.
- **Vision-critique:** schema conformance; a deliberately-clipped fixture must yield a `high` `clipping` issue; loop terminates within N.
- **End-to-end (fixture research-input):** produces valid artifacts that pass CSP + a headless render without console errors; citations present.
- **Security:** job container has no secrets, no egress, no Docker socket (acceptance shared with #4).

## 13. Open items

1. **Compose layout strategy** — agent-proposed bboxes vs. a deterministic packing helper feeding the agent. Lean: deterministic helper proposes, agent refines, vision loop polices. Finalize in planning.
2. **Default iteration / budget numbers** (N, tokens, wall-clock, max images) — set sane defaults in planning; expose as config.
3. **Vision model choice** for critique (Claude vision tier via OpenRouter/Nous) — pick in planning; must accept image input.
4. **Transition vocabulary** in `camera.json` (zoom/pan/rotate/cut) — start minimal (zoom + pan), expand later.
5. Depends on **#2** delivering the §4 research-input contract, and the **Milestone-zero spike** for the ⚠️ stages.
