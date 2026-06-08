# Sub-project #2 — Research Engine — Design Spec

**Date:** 2026-06-08
**Status:** Draft for review
**Parent:** `2026-06-08-agentic-prezi-vision-design.md` (§4)
**Inherits:** `2026-06-08-sub0-security-supply-chain-design.md`
**Produces:** the research-input contract defined in `#3` §4 (the *only* interface to #3)

> **Spike-relevant, but partly insulated.** Web search/extraction uses Hermes Tool Gateway (Nous Portal). The scholarly APIs (§2) are called **directly** by our orchestrator, independent of Hermes — so even if Hermes extraction underperforms, research can still run on scholarly sources + a direct fetch/extract fallback (§8).

---

## 1. Purpose & contract

Take the user's **write-up** and produce a structured, **strictly-grounded, cited findings document** — the latest *actual* scientific research on the topic, with resolvable links to real papers. Output is exactly the `#3` §4 schema:

```jsonc
{ "topic", "narrative_outline": [...],
  "findings": [ { "claim", "detail", "importance":1-5, "citations":[id...], "figure"? } ],
  "citations": [ { "id", "title", "authors":[...], "year", "venue", "doi", "url" } ] }
```

#2 owns *how* it researches; #3 never sees anything but this contract. Design mirrors the proven deep-research shape: **fan-out search → fetch/extract → adversarially verify → synthesize cited report.**

---

## 2. Source adapters (unified interface; each REST over `node:https`, no npm deps)

A common `SourceAdapter` interface (`search(query) → candidates[]`, `fetchMeta(id) → citation`) with these implementations:

| Adapter | Role | Key? | Notes |
|---|---|---|---|
| **OpenAlex** | Cross-domain paper discovery + metadata | none | "Polite pool" via `mailto` contact; rich metadata, DOIs. |
| **Crossref** | Authoritative DOI metadata + resolution | none | Polite pool via `User-Agent` + contact email. |
| **arXiv** | Preprints (physics/CS/math/quant-bio) | none | Latest preprints — strong for "latest research". |
| **PubMed (E-utilities)** | Biomedical literature | optional | Optional key raises rate limit. |
| **Hermes web search + cloud browser** | Breadth + extracting page/PDF content | Nous Portal | General web + extraction; used to enrich/extract, not as primary citation authority. |

- Each adapter: polite **User-Agent** + contact email, **rate-limit** handling (backoff), response **caching** (§5).
- Adding/removing a source = one adapter; the pipeline is source-agnostic.
- All adapter endpoints added to the **#0 §B3 egress allowlist**.

---

## 3. Pipeline

```
write-up
  → SCOPE        LLM: write-up → topic + N research questions / sub-queries
  → DISCOVER     fan-out sub-queries across adapters → candidate set; dedup by DOI/normalized-title
  → RANK/FILTER  score by recency ("latest"), credibility (peer-reviewed > preprint > web),
                 relevance; cap to top-K candidates
  → EXTRACT      scholarly APIs give structured abstract/metadata; Hermes cloud browser
                 extracts claims/figures from full text/PDF where needed
  → SCAN 🛡       prompt-injection scan (Llama Prompt Guard 2, §7.1) of EVERY ingested
                 free-text field BEFORE it can reach any LLM; quarantine MALICIOUS chunks
  → VERIFY ⚑     STRICT grounding (see §4) — resolve citations, cross-check key claims, drop ungrounded
  → SYNTHESIZE   cluster surviving findings → narrative_outline, rank by importance,
                 attach citation ids → emit §1 contract; validate against JSON Schema
```

Each stage is budget-bounded (§6) and cached (§5).

---

## 4. Strict grounding & citation integrity ⚑ (the core credibility mechanism)

The main LLM-research failure mode is fabricated/mis-attributed citations. Defenses:

- **Citations come only from retrieved adapter metadata — never model-invented.** The synthesis model maps each claim to citation **ids from the candidate set**; a post-step **rejects any citation id not in that set.**
- **Resolvability check:** every citation's **DOI/URL is live-checked** (HEAD/GET via `node:https`, or DOI resolves through Crossref). Unresolvable → citation dropped.
- **Grounding requirement:** every `finding` must retain **≥1 resolvable citation** after checks, else the finding is **dropped or downgraded** (never published as authoritative).
- **Adversarial cross-check:** key/high-importance claims are verified against **≥2 independent sources**; a claim only one source supports is flagged lower-importance, not asserted strongly.
- **Dedup & canonicalization:** citations keyed by DOI (fallback normalized title+year); duplicates merged.
- Result: nothing reaches #3 that isn't backed by a real, resolvable paper.

---

## 5. Caching

- **Per-presentation research cache** (the #3 §10 expectation): the final §1 findings doc is cached against the presentation so re-publish doesn't re-research.
- **Adapter-response cache** (`.cache/research/`) keyed by normalized query, with a **recency-aware TTL** (short enough that "latest" stays fresh).
- Re-running research is idempotent; cache hits short-circuit the expensive stages.

---

## 6. Budgets & cost

Research is multiplicative (sub-queries × adapters × candidates × verification). Enforced caps:
- max sub-queries, max candidates (top-K), max full-text extractions, max cross-checks, wall-clock, token budget — all configurable.
- **Graceful insufficiency:** if too few credible sources survive grounding, return a partial findings doc with `topic` + a clear `insufficient_sources` flag (#3/#1 surface it) rather than fabricating coverage.

---

## 7. Security (inherits #0)

- Runs in the **orchestration layer**, not the code sandbox — no `execute_code` needed here.
- Egress: Nous Portal + the scholarly API hosts only (added to #0 §B3 allowlist).
- Any optional API keys (PubMed) live in the **runtime secret store** (#0 §B5), never in repo/images.
- Extracted third-party text is treated as untrusted data (it can carry prompt-injection); the synthesis prompt is structured so retrieved content is **data, not instructions**, and outputs are schema-validated. **This is layer 1; the active classifier scan in §7.1 is layer 2.**

### 7.1 Prompt-injection scanning of ingested content 🛡 (Llama Prompt Guard 2)

**Everything the research engine brings in from the outside world is untrusted** — paper titles/abstracts, extracted full-text/PDF body, figure captions, quotes, web snippets — and can carry prompt-injection / jailbreak payloads aimed at the downstream LLM (SCOPE/SYNTHESIZE) or at #3's generation. On top of the structural "content-as-data" defense above, we add an **active classifier scan**.

- **Model:** **Llama Prompt Guard 2 — 22M** (`meta-llama/Llama-Prompt-Guard-2-22M`). DeBERTa-xsmall, 22M params; binary **`BENIGN`/`MALICIOUS`** + logit; ≤512 tokens; CPU-friendly. Meta ships it expressly to scan untrusted third-party content in LLM pipelines as an added defense layer.
- **What gets scanned:** **every ingested free-text field, before it can enter any prompt or be forwarded to #3** — title, abstract, extracted body, captions, quotes, web text. Long text is chunked into ≤512-token windows; if **any** window scores `MALICIOUS` past the threshold, the whole chunk/source is quarantined.
- **On detection (fail-safe):** the offending text is **quarantined — never placed in an LLM prompt, never forwarded to #3**. The source may still contribute *structured* citation metadata (DOI/authors/year) if independently resolvable, but its free text is excluded; a finding that thereby loses textual support is downgraded/dropped by grounding (§4). The result records a `quarantined_sources` count + reasons (mirrors §6's transparency).
- **Threshold:** Prompt Guard 2 publishes no fixed cutoff, so we use a **conservative, configurable logit threshold** (quarantine on doubt — presentations are non-secret, so a false positive costs one source, never correctness). Tunable via `budgets`/config.
- **Defense-in-depth, not sole defense:** layer 2. Layer 1 (content-as-data, schema-validated output, cite-only-from-set provenance §4) stays in force — important because legitimate scientific text *about* prompt injection can trip the classifier; quarantining it is acceptable since the structural defenses still hold.
- **Where it runs — no new egress of research content:** self-hosted as a small local scorer in the **agent/worker plane** (Python, where Hermes already runs), on an internal/localhost endpoint the Node orchestrator calls per chunk. **Research content is never sent to a third party for scanning.** Runtime options + tradeoffs in §10.
- **Supply chain (the model is itself an artifact):** pin the **exact HF revision (commit hash)** and **verify the weight checksum**; weights download (gated **Llama 4 Community License** — terms must be accepted) happens **at build time only** (#4), with `huggingface.co` added to the #0 §B3 egress allowlist for that step. The Python inference deps (transformers/torch-CPU, or an ONNX runtime) are pinned + vetted and live **only in the agent-plane image**, never the Node control plane.

---

## 8. Engine dependency & spike contingency

- **LLM-dependent (REQUIRED — updated 2026-06-08):** `SCOPE` and `SYNTHESIZE` now require an `llm` and **throw without one** — the earlier deterministic heuristic fallback was **removed** (fail-loud over silent degradation). The LLM is a plain **OpenAI-compatible HTTPS call** to Nous Portal (`src/research/providers/nous.mjs`, key `NOUS_RESEARCH_API_KEY`), so it does **not** depend on the Hermes `execute_code`/Docker spike. Offline tests inject a mock `llm`. *(This supersedes the original "deterministic synthesis fallback" insulation; if no-LLM operation is ever needed, restore that path behind a flag.)*
- **Still insulated from the Hermes spike:** the scholarly adapters (OpenAlex/Crossref/arXiv/PubMed) are direct HTTPS. The only Hermes/cloud-browser-dependent piece is **full-text extraction** (still TODO); until it lands, research runs on scholarly metadata/abstracts + the required LLM.

---

## 9. Testing (TDD)

- **Adapters:** mock-HTTP fixtures per source; query→candidate parsing; rate-limit backoff; dedup by DOI/title.
- **Grounding ⚑:** a model output citing an id **not** in the candidate set must be rejected; a finding with only an **unresolvable** DOI must be dropped; a one-source key claim must be downgraded.
- **Resolvability:** dead DOI/URL → citation removed (mocked).
- **Synthesis:** output conforms to the #3 §4 JSON Schema; importance ordering sane.
- **End-to-end (fixture topic):** produces a valid, fully-grounded findings doc; the `insufficient_sources` path returns cleanly.
- **Injection scan 🛡:** a fixture chunk containing a known injection string (e.g. "ignore previous instructions …") must score `MALICIOUS` → quarantined (excluded from every prompt + not forwarded to #3); a benign abstract passes. The scorer is injected/mockable so pipeline rules unit-test offline.

---

## 10. Open items

1. **Per-domain ranking weights** (recency vs. citation count vs. venue) — tune in planning.
2. **Default budget numbers** (sub-queries, top-K, extractions, cross-checks, wall-clock, tokens) — set in planning.
3. **Polite-pool contact email** for OpenAlex/Crossref `mailto`/User-Agent — pick a project contact.
4. **PubMed API key** — optional; decide if biomedical volume warrants it.
5. **PDF figure/data extraction** depth — how much beyond abstracts to pull (cost vs. richness).
6. Depends on the **Milestone-zero spike** for the Hermes-extraction path (§8 fallback covers the rest).
7. **Prompt Guard 2 inference runtime** (§7.1) — choose: (a) **recommended** — a small Python scorer in the agent plane (matches the Hermes/Python plane; adds transformers/torch-CPU to that image, pinned+vetted); (b) ONNX export + `onnxruntime` in Node (in-process, no Python sidecar, but a native npm dep — tension with `ignore-scripts`); (c) HF-hosted Inference API (simplest, but egresses research content to HF — disfavored). Decide in #4 with the worker image. Also: accept the **Llama 4 Community License** and pin the model **revision + checksum**.
8. **NOT YET IMPLEMENTED** — the merged #2 engine has the structural layer-1 defense (§7) but the §7.1 active scan is a **pending enhancement** to build (tracked in CLAUDE.md handoff).
