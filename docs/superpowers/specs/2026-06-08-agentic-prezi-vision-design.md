# Agentic Prezi — Top-Level Vision & Architecture Spec

**Date:** 2026-06-08
**Status:** Approved (top-level vision). Sub-projects to be deep-spec'd individually.
**Owner:** lizTheDeveloper

---

## 1. What we're building

A platform where a user dumps in a write-up and gets back an engaging, **Prezi-style** (zoom-in/zoom-out, dynamic, spatial) presentation — researched, cited, and rendered in SVG by agents. Sign-up is frictionless, and one click publishes the result to a public `*.themultiverse.school` URL.

The platform is **agent-led** end to end:
- **Research** — agents go find the latest actual scientific research, link to papers, extract findings.
- **Generation** — agents write the SVG + JS for a zooming spatial narrative.
- **Vision** — vision-capable agents *look at* the rendered result via screenshots and iterate.
- **Image generation** — only where a slide genuinely needs generated imagery (YAGNI until then).

### Non-goals
- **Presentation privacy/security is NOT a goal.** Published presentations are public by design.
- The security focus is the **development process and the operator's machine/infra** (see §6).
- Not building our own model hosting, our own search index, or our own browser engine — Hermes' Tool Gateway provides these.

---

## 2. Decisions locked in this spec

> **Note:** This repository is **public**. Do not commit secrets, API keys, personal data, or anything you would not publish. See `CLAUDE.md`.

| Area | Decision | Rationale |
|---|---|---|
| Control-plane stack | **Node + TypeScript** | Richest agentic ecosystem; user's choice. Accept npm supply-chain risk, mitigate with the §6 vetting gate. |
| Agent engine | **Hermes Agent (Nous Research)** | User's choice; provides research + vision + image-gen + sandboxed code execution in one tool. |
| Model + tool provider | **Nous Portal** (one OAuth → 300+ models + Tool Gateway: web search, image-gen, TTS, cloud browser/vision) | Restores the Tool Gateway bundle, which is Hermes' headline value and collapses the research/vision sub-projects into the engine. OpenRouter available as secondary `--provider` for specific models. |
| Auth | **Passwordless magic link** | "Really easy to sign up"; no passwords to leak; tokens signed with `node:crypto`. |
| Storage | **SQLite** (`node:sqlite` if non-experimental on target Node LTS, else vetted `better-sqlite3`) | Minimal-deps; single box; no external DB service. **Open item — see §7.** |
| Job queue | **SQLite-backed in-process queue + worker** | Long-running jobs without Redis/broker deps. |
| Hosting | **Hetzner Cloud + Docker, remote-only** | User's infra. **No local Docker** (operator memory constraint). |
| Data egress | Research/vision prompts route through Nous' hosted Tool Gateway — **accepted** | Presentations are non-secret; acceptable trade for the bundled tools. |

---

## 3. System architecture

Two planes on one Hetzner box, both in Docker:

```
┌─────────────────────────────────────────────────────────────┐
│  CONTROL PLANE  (Node/TS)                                    │
│  • Web app: magic-link auth, editor, "Publish" button        │
│  • SQLite (storage) + SQLite-backed job queue                │
│  • Serves published presentations at *.themultiverse.school  │
│  • Spawns + supervises generation jobs                        │
└───────────────┬─────────────────────────────────────────────┘
                │ spawns headless; one isolated HERMES_HOME per job
                ▼
┌─────────────────────────────────────────────────────────────┐
│  AGENT PLANE  (Hermes — Python, sandboxed worker)            │
│  • `hermes chat -q …` via Nous Portal (Tool Gateway)         │
│  • terminal.backend = docker  (NEVER local)                  │
│  • research → generate SVG/JS → screenshot → vision-review   │
│  • writes artifacts into per-job workspace dir; we read them │
└─────────────────────────────────────────────────────────────┘
```

### Boundary contract between planes
The control plane treats the agent plane as **untrusted**:
- The control plane hands the agent plane a **job spec** (write-up + parameters) and an **empty per-job workspace directory**.
- The agent plane is driven **headless** (`hermes chat -q`), one isolated `HERMES_HOME` per job so Hermes' cross-session memory/skills never commingle users.
- Communication of *results* is via **artifacts written to the workspace** (SVG, JS, a manifest JSON, citations), which the control plane reads — **not** by parsing free-text stdout (Hermes has no documented structured-output mode).
- Generated code is published as **static, sandboxed assets** (CSP-locked, no access to platform internals).

---

## 4. The generation pipeline (the product)

```
write-up in
   → RESEARCH      Tool Gateway web search + paper extraction → cited findings
   → COMPOSE       outline the zooming Prezi narrative as a scene graph
   → GENERATE      Hermes writes SVG + JS into the workspace
   → VISION LOOP   screenshot (cloud browser) → Claude-vision critique → revise (N iterations)
   → PUBLISH       control plane reads workspace artifacts, stores them,
                   mints a *.themultiverse.school URL
```

- **Scene graph** is the intermediate representation of the spatial/zoom narrative — the contract between COMPOSE and GENERATE. Its schema is defined in the #3 sub-spec.
- The **vision loop** is bounded (max N iterations, defined in #3) to cap cost/latency.
- **Citations** travel with the artifacts so the published presentation can link to papers.

---

## 5. Sub-projects & build order

Each gets its own spec → plan → implementation cycle.

| # | Sub-project | Summary |
|---|---|---|
| **0** | Dev & supply-chain security | The §6 mechanisms, as concrete tooling. **Specced next.** |
| **1** | Core app + auth + publish | Magic-link auth, editor, publish → URL. Walking skeleton. |
| **4** | Deploy / hosting | Hetzner + Docker, remote build/push, no local Docker. |
| **2** | Research engine | Hermes Tool Gateway research → cited findings contract. |
| **3** | Presentation generator | Scene graph → SVG/JS generation + bounded vision-review loop; optional image-gen. |

**Build order:** `#0 → #1 → #4 → #2 → #3`.

### Milestone zero — de-risking gate (before #2/#3 are deep-spec'd)
The whole platform rests on the least-proven assumption: **that Hermes is reliably drivable headless, non-interactive, in Docker, via Nous Portal, emitting artifacts we can read.** The docs gave us no structured-output story, so before building on it we run a **~1-hour spike** that proves:
1. `hermes chat -q` runs non-interactively to completion with a non-zero-value result.
2. `terminal.backend = docker` executes generated code in isolation.
3. The agent reliably writes a known set of artifacts into the workspace dir that we can read deterministically.
4. Nous Portal auth works from a headless/containerized context.

If the spike fails, we revisit the engine choice (Node-native Agent SDK / Claude Code headless were the runner-up) **before** sinking effort into #2/#3.

**Run the spike cheap and decoupled:** a **throwaway VM with plain Docker + Nous Portal creds** — *not* #4's production sandbox (broker + gVisor + hardening). The spike answers only the four questions above; #4 hardens the runtime **after** the engine is proven. This keeps the gate ~1 hour and early. Critically, the spike is **independent of #0 and #1**, which can be planned and built in parallel (#1 runs locally with **no Docker at all**, thanks to the stub generator).

---

## 6. Cross-cutting security law (operator-focused)

The threat model is the **operator's machine and infrastructure**, not the presentations. Two distinct surfaces:

### Surface A — the dev machine, at *install* time (the worm surface)
Because runtime code execution happens on Hetzner (not locally), the dev-box risk is almost entirely **install-time supply chain**. Mechanisms (concrete, not slogans — detailed in spec #0):
- **Minimum release-age gate:** a preinstall/CI check that queries each **direct *and transitive*** dependency's registry publish date and **fails the build if any dependency is < 7 days old.**
- **Committed lockfiles**, exact-pinned versions.
- **`npm install --ignore-scripts`** by default; no auto-running `npx -y`.
- **Per-package vetting** before adoption (provenance, maintainer, popularity, recent-compromise check).

### Surface B — the Hetzner box, at *runtime*
- Agent-*generated* code and Hermes' `execute_code` run **only** in the Docker terminal backend — **never `local`.**
- The MCP **`npx -y` auto-install path is disabled.** Only pre-vetted, pinned, locally-installed MCP servers are permitted.
- Egress-aware: outbound is limited to known endpoints (Nous Portal, OpenRouter, paper sources).
- Published presentation assets are served with a locked-down CSP and no access to platform internals or other users' data.

---

## 7. Open items (to resolve in sub-specs, not hand-waved)

1. **`node:sqlite` stability** — confirm it is non-experimental on our target Node LTS. If still experimental/flagged, fall back to vetted `better-sqlite3` (a native third-party dep that must itself pass the §6 gate). Resolve when writing spec #0/#1.
2. **Outbound email vendor** for magic links — pick + vet one (SMTP relay or transactional API) in spec #1.
3. **Hermes headless drivability** — unproven; gated by Milestone zero (§5).
4. **Image-gen need** — deferred (YAGNI) until a presentation actually requires it; revisit in #3.

---

## 8. Minimal-dependency posture (summary)

Default to platform/stdlib over third-party: `node:sqlite`, `node:crypto`, `node:http`. Every third-party package must clear the §6 vetting gate. Fewer dependencies is itself a security control here.
