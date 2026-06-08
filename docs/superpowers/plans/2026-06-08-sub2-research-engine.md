# #2 Research Engine — Implementation Plan (built)

**Goal:** Take a user write-up and produce a structured, strictly-grounded, cited findings document — the **only** interface to #3 (the `#3 §4` contract). Mirrors the proven deep-research shape: **fan-out search → fetch/extract → adversarially verify → synthesize cited report.**

**Spec:** `docs/superpowers/specs/2026-06-08-sub2-research-engine-design.md`

**Architecture:** Stdlib-only `.mjs` (zero npm deps, per #0), tested with `node:test`. The repo's **pure-core / thin-I/O** split: every stage's logic is a pure, exported, offline-unit-tested function; network and model calls are **dependency-injected** (`adapters`, `llm`, `resolver`), so the whole pipeline runs and tests without a live provider. This realizes spec **§8 insulation**: the scholarly adapters are direct HTTPS and independent of the (undecided) Nous Portal / Hermes LLM, and the pipeline degrades to a deterministic synthesis when no `llm` is wired.

**Tech Stack:** Node ≥26, ESM `.mjs`, `node:test`, `node:https`, `node:crypto`, `node:fs`. No runtime dependencies.

---

## File structure (created)

| File | Responsibility |
|---|---|
| `src/research/schema.mjs` | Hand-rolled validator for the `#3 §4` contract (no ajv). `validateFindingsDoc` + the grounding invariant that every cited id exists in `citations[]`. |
| `src/research/citations.mjs` | DOI/title normalization, canonical dedup key, dedup+merge (unions `sources`), stable id minting (`smith2025`). Pure. |
| `src/research/http.mjs` | `node:https` GET (text/JSON) with polite User-Agent + contact email, 429/503 backoff, redirect follow; `isResolvable` DOI/URL liveness check. I/O layer. |
| `src/research/adapters/openalex.mjs` | OpenAlex adapter — discovery + metadata, abstract inverted-index reconstruction. Pure `parseWorks`. |
| `src/research/adapters/crossref.mjs` | Crossref adapter — DOI metadata, JATS abstract strip. Pure `parseItems`. |
| `src/research/adapters/arxiv.mjs` | arXiv adapter — Atom feed, dependency-free XML extraction. Pure `parseAtom`. |
| `src/research/adapters/pubmed.mjs` | PubMed adapter — NCBI E-utilities (esearch→esummary), keyless (optional `PUBMED_API_KEY`). Pure `parseSummary`/`parseSearchIds`. |
| `src/research/cache.mjs` | Adapter-response cache under `.cache/research/` (git-ignored), recency-aware TTL. Pure key/TTL logic. |
| `src/research/budgets.mjs` | Default caps (§6): sub-queries, per-query, top-K, cross-checks, grounded-floor, wall-clock, tokens. |
| `src/research/scope.mjs` | SCOPE: write-up → topic + sub-queries (+ outline). LLM-backed; deterministic keyword heuristic fallback. |
| `src/research/discover.mjs` | DISCOVER: fan sub-queries across all adapters, dedup, collect non-fatal per-adapter errors. |
| `src/research/rank.mjs` | RANK/FILTER: score by recency / credibility / impact (tunable weights, §10.1), cap to top-K. Pure. |
| `src/research/ground.mjs` | **VERIFY ⚑** — provenance → resolvability → grounding → adversarial cross-check. Pure logic; injected resolver. |
| `src/research/synthesize.mjs` | SYNTHESIZE: assign citation ids; LLM maps claims → ids (never invents); deterministic fallback. |
| `src/research/llm.mjs` | LLM `json()` contract + robust JSON extraction from a model reply. Provider-agnostic. |
| `src/research/pipeline.mjs` | Orchestrator: SCOPE→DISCOVER→RANK→SYNTHESIZE→VERIFY→assemble+validate `#3 §4` doc. |
| `src/research/cli.mjs` | `npm run research -- "<write-up>"` — exercises the live adapters end-to-end. |
| `src/research/*.test.mjs` | 86 unit + end-to-end tests (offline; injected adapters/llm/resolver). |

---

## Grounding & citation integrity ⚑ (spec §4 — the credibility core)

Enforced in `ground.mjs`, independently re-checked by `schema.mjs`:

1. **Provenance** — a finding may cite only ids in the candidate set; model-invented ids are stripped and reported (`rejectedIds`).
2. **Resolvability** — every citation's DOI/URL is live-checked (`isResolvable`); dead ones dropped.
3. **Grounding** — a finding with zero resolvable citations is dropped (never published).
4. **Adversarial cross-check** — a high-importance claim backed by < 2 independent sources is downgraded, not asserted strongly. Independence is tracked via the unioned `sources` from dedup.
5. **Graceful insufficiency** (§6) — below the grounded-findings floor, the doc returns with `insufficient_sources: true` rather than fabricating coverage.

Verified end-to-end: an LLM that fabricates citation ids cannot poison the doc (test in `pipeline.test.mjs`).

---

## Security (inherits #0, spec §7)

- Orchestration-layer only — no `execute_code` / code sandbox here.
- Egress is the scholarly hosts + (later) Nous Portal — to be added to the **#0 §B3 egress allowlist** in #4: `api.openalex.org`, `api.crossref.org`, `export.arxiv.org`, `doi.org`.
- Contact email for the polite pool reads from `RESEARCH_CONTACT_EMAIL` (env), defaulting to a project-neutral mailbox — **no personal data in this public repo** (resolves open item §10.3 without committing a personal address).
- Retrieved third-party text is treated as **untrusted data**: passed to the LLM as `user` data, never folded into `system` instructions; all model output is schema-validated and grounding-checked.

---

## Status & remaining work

**Done & verified:** full pipeline runs offline (deterministic) and against **live** OpenAlex/Crossref/arXiv/PubMed, emitting a valid, fully-grounded, DOI-resolved `#3 §4` document. `npm test` → 95 pass. Secret scan clean. Zero new dependencies.

**Resolved in review follow-up (PR #1):**
- **PubMed adapter** landed (§2/§10.4) — biomedical coverage, keyless E-utilities, in `DEFAULT_ADAPTERS`.
- **Budget enforcement** (§6) — `maxCrossChecks` caps resolvability checks in `ground.mjs`; `wallClockMs` deadline in `pipeline.mjs` returns a clean partial `insufficient_sources` doc on timeout.
- **Graceful figure handling** (§7/§8) — a malformed LLM `figure` is now dropped (`sanitizeFigure`) instead of failing the whole doc.
- **HTTP hardening** (§7) — redirect hop cap, response-size cap, HEAD-based resolvability (no PDF download), opt-in `RESEARCH_EGRESS_ALLOWLIST` SSRF seam.

**Deferred (provider-gated / later):**
- **LLM scope + synthesis quality** — the deterministic fallback de-risks the pipeline but produces naive findings (keyword breadth, no topical synthesis). Nous Portal is now **confirmed**; next step is wiring a `makeJsonLlm(complete)` impl into `runResearch({ llm })`.
- **Hermes web search + cloud-browser extraction** adapter (§2/§8 enrichment path) — extraction-shaped (not `search`/`fetchMeta`); track with the engine work.
- **Per-presentation research cache** (§5) — belongs at the #1 job/worker seam; the adapter-response cache is in place.
- **Tuning** (§10.1/§10.2): ranking weights and budget numbers — defaults are sensible starting points.
- **Egress allowlist entries** — infra-level enforcement registered in the #4 deploy config (the app-layer `RESEARCH_EGRESS_ALLOWLIST` seam exists now).
- **Source-lineage weighting** — OpenAlex ingests Crossref, so they aren't fully independent for the cross-check (known limitation, noted in `ground.mjs`).
