# Sub-project #3 — Presentation Generator — Build Plan / Handoff

**Date:** 2026-06-08
**Spec:** `docs/superpowers/specs/2026-06-08-sub3-presentation-generator-design.md`
**Status:** Engine-agnostic core BUILT (offline, deterministic). Engine-dependent stages (Hermes
`execute_code` Generate, Playwright screenshots, vision-model critique) are injected seams, not yet
wired — they await the Milestone-zero spike (spec §11).

## What was built (`src/prezi/`)

The whole pipeline is **dependency-injected with deterministic, offline defaults** — mirroring how
#2 was insulated from the undecided LLM (§8). It runs and unit-tests with **zero network, no LLM,
no browser**, and the engine-dependent pieces drop in later as `deps` without touching any contract.

```
research §4 doc + write-up
  → COMPOSE          compose.mjs      findings → validated scene-graph IR (layout + nesting + tour)
  → GENERATE         svg.mjs          IR → presentation.svg (deterministic compiler = §11 Fallback B)
  → RENDER+CRITIQUE  critique.mjs     geometricCritique: browser-free overflow/crowding/citation checks
  → REVISE           compose.mjs      deterministicRevise: shrink/repair flagged scenes
  ↑ refineLoop (bounded N, re-critique full deck) until no HIGH issues or budget; publish best-effort
  → EMIT             generate.mjs     index.html + presentation.svg + camera.json + player.js
                                      + camera-math.js + styles.css + manifest.json
```

| File | Role |
|---|---|
| `ir-schema.mjs` | Scene-graph IR validator (§3). Rejects overlap, over-nesting, child-outside-parent, parent cycles, dangling citation/tour refs. |
| `layout.mjs` | Deterministic non-overlapping packer; children inset inside parents with reserved margins (§6, open item #1). |
| `compose.mjs` | findings + write-up → IR; threads citations; nests figure/detail (the Prezi zoom). Plus `deterministicRevise`. |
| `svg.mjs` | IR → `presentation.svg` using **only SVG presentation attributes** (no `<style>`/`style=` — `style-src 'self'` blocks those). Returns the layout report the critique reads. |
| `camera.mjs` | IR tour → `camera.json`; `fitViewBox` letterboxes each stop to the viewport aspect. |
| `runtime/camera-math.mjs` | Pure camera math (no DOM). Shipped verbatim as `camera-math.js`, imported by the player **and** the tests (what ships is what we test). |
| `runtime/player.mjs` | Vanilla-JS player (§7). Reads inline SVG + inline camera JSON (**no fetch** → `connect-src 'none'` holds); keyboard/click-zoom/wheel/swipe nav, deep links, `prefers-reduced-motion`. Shipped as `player.js`. |
| `critique.mjs` | §5.1 critique schema validator + the bounded §5.2 `refineLoop` (engine-agnostic; default critic = geometric). |
| `manifest.mjs` | `manifest.json` — a **superset** of the #1 stub manifest (same required fields, `schemaVersion:1`) + dimensions, scene/stop counts, citations[], quality report. |
| `generate.mjs` | Orchestrator + artifact writer (CSP-locked `index.html`); `makePreziGenerator()` adapter for the #1 `Generator` seam. |
| `cli.mjs` | `npm run generate -- --research <file> --title "…" --out <dir>` (or `--from-writeup` to chain #2). |

**Tests:** 40 new (`src/prezi/**/*.test.mjs`), full suite 167 green. Covers the spec §12 matrix: IR
valid/invalid + overlap/over-nesting rejection; player camera math + nav state machine + reduced-motion +
deep-link; critique schema conformance + a deliberately-clipped fixture yielding a HIGH `clipping`
issue + bounded-loop termination + non-convergence reporting; end-to-end fixture → valid artifacts
with the strict CSP and a fetch-free module player; idempotent re-run.

## Deliberate choices / boundaries

- **CSP-clean by construction.** `index.html` carries the same strict CSP as the published origin
  (`default-src 'self'; … connect-src 'none'`). The player reads an inline `<script
  type="application/json">` (JSON `<`-escaped) instead of `fetch`, and imports `camera-math.js`
  same-origin (governed by `script-src 'self'`, not `connect-src`). SVG styling is attributes only.
- **Worker still runs the #1 stub — by design.** Wiring #3 into the worker also requires the
  **#2 research → worker** seam (still deferred) and the Generate-via-Hermes spike. So #3 ships as a
  standalone engine + CLI + `makePreziGenerator()` adapter, exactly like #2 shipped before wiring.
- **Fonts (§7.1) plumbed but not embedded.** No license-clean font binary is committed to this
  **public** repo, so the default is a system fallback stack; `generate.mjs` accepts
  `deps.fonts={files,faceCss}` to self-host faces under `assets/fonts` (keeps `font-src 'self'`).
  The "sandbox render == viewer render" fidelity check stays **open** until a font is embedded.

## Next (engine-dependent — needs the Milestone-zero spike, §11)

1. **Inject the real Generate driver.** Swap the deterministic `render` for Hermes `execute_code`
   (docker backend) writing the SVG, or Fallback A (Claude Agent SDK headless). Contract unchanged.
2. **Inject screenshot + vision critic.** `render` → Playwright jump-to-viewBox screenshots in the
   #0 sandbox; `critic` → a vision model returning the §5.1 schema (pick the model in planning).
3. **Inject an LLM into Compose** for narrative/wording refinement (deterministic build stays the floor).
4. **Embed a self-hosted typeface** + run the §7.1 sandbox↔viewer fidelity check.
5. **Wire #2 → #3 → #1 worker** once the research-in-worker seam lands (replace the stub at
   `src/worker.ts`'s injected generator with `makePreziGenerator()`).
6. **Image-gen (§8)** stays YAGNI-gated until a scene genuinely needs it.
