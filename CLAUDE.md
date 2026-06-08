# CLAUDE.md — agentic-prezi

## ⚠️ THIS REPOSITORY IS PUBLIC

This repo is published publicly on GitHub (`lizTheDeveloper/agentic-prezi`).

**Never commit anything that should not be world-readable**, including:

- API keys, tokens, or credentials of any kind (Nous Portal, OpenRouter, SMTP, etc.)
- `.env` files or secrets — keep them out of the repo (see `.gitignore`)
- Personal data, private email addresses, or anything tied to real users
- Internal infrastructure details (Hetzner IPs, SSH keys, server hostnames)

Secrets live in environment variables / a local `.env` that is **git-ignored**, and on
the Hetzner box's runtime config — **not** in source control.

When in doubt, do **not** commit it. Removing a secret from history after a public push
is expensive and unreliable (assume anything pushed is permanently exposed and rotate it).

## Project

Agentic platform that turns a write-up into a researched, cited, Prezi-style (zooming, spatial)
SVG presentation and publishes it to a `*.themultiverse.school` URL.

- **Vision spec:** `docs/superpowers/specs/2026-06-08-agentic-prezi-vision-design.md`
- **Control plane:** Node + TypeScript. **Agent engine:** Hermes Agent (Nous Portal).
- **Hosting:** Hetzner + Docker, remote-only — **do not run Docker locally.**
- **CI/CD:** **Never use GitHub Actions** (or any third-party CI) — ever. CI runs on the Hetzner box via a server-side git `pre-receive` hook (`scripts/ci-gate.sh`). GitHub is a public code mirror only.
- **Local setup:** after cloning, run `sh scripts/setup-dev.sh` once to enable the git hooks (`core.hooksPath`). The Hetzner `pre-receive` gate is authoritative regardless.

## Supply-chain security policy

- **Minimum dependency release age: 7 days.** Do not add any package (direct or transitive)
  published within the last 7 days.
- Vet every new package before adoption; prefer Node stdlib (`node:sqlite`, `node:crypto`, `node:http`).
- Commit lockfiles, pin exact versions, install with `--ignore-scripts`, no `npx -y` auto-install.

## Project status & next steps (handoff — updated 2026-06-08)

**Specs (all 6 written, in `docs/superpowers/specs/`):** vision, #0 security, #1 core-app, #2 research, #3 generator, #4 deploy.
**Build order:** #0 → #1 → #4 → #2 → #3.

**Done:**
- **#0 security/supply-chain is BUILT and merged to `main`** (the gate scripts above + `docs/security/*`; 15 tests; plan in `docs/superpowers/plans/2026-06-08-sub0-security-supply-chain.md`). After cloning, run `sh scripts/setup-dev.sh` once.
- **#1 core app + auth + publish is BUILT and merged** (PR #2): vanilla-JS SPA, magic-link auth (`node:crypto`), `node:sqlite`, SQLite job queue + worker + stub generator, Host-based `<slug>.themultiverse.school` serving with CSP-locked published origin; 44 tests; `npm start` (`node src/server.ts`). The #3 generator later replaces the stub at the `manifest.json` artifact seam in `src/generator.ts`.
- **#2 research engine is BUILT** (`src/research/*`; full pipeline scope→discover→rank→synthesize→**grounding ⚑**→validate, emitting the `#3 §4` contract; OpenAlex/Crossref/arXiv/PubMed adapters; budget caps + HTTP hardening; 95 tests; verified against live APIs; plan in `docs/superpowers/plans/2026-06-08-sub2-research-engine.md`). Run with `npm run research -- "<write-up>"`. **Now that Nous Portal is CONFIRMED, the next step is wiring a real `llm` into `runResearch({ llm })`** (scope/synthesis quality) + the Hermes extraction adapter; until then it runs on scholarly sources with a deterministic synthesis fallback (§8 insulation).
- **#3 presentation-generator core is BUILT** (`src/prezi/*`; Compose → SVG compile → browser-free geometric critique → bounded refine loop → full artifact set incl. CSP-locked `index.html` + vanilla-JS player; scene-graph IR validator; consumes the `#2 §4` contract; emits the `#1` manifest superset; 40 tests, 167 total; plan in `docs/superpowers/plans/2026-06-08-sub3-presentation-generator.md`). Run with `npm run generate -- --research <file> --title "…" --out <dir>` (or `--from-writeup` to chain #2). Like #2, every engine-dependent stage is **dependency-injected with a deterministic offline default** — it runs with no network/LLM/browser. **Still to wire (needs the spike):** the real Generate driver (Hermes `execute_code`), Playwright screenshots + vision-model critic, an `llm` into Compose, an embedded self-hosted typeface (§7.1), and the #2→#3→#1 worker seam (worker still runs the #1 stub).

**Next:** **#4 deploy/hosting** (Hetzner + Docker, wildcard TLS, gVisor sandbox) + the **Hermes drivability spike**; then inject the engine-dependent #3 stages (Hermes Generate, Playwright+vision critic, Compose `llm`) and a real `llm` into `runResearch({ llm })`; then wire **#2 → #3 → #1 worker** (replace the injected generator at `src/worker.ts` with `makePreziGenerator()`). Seam for #2→#1: `runResearch()` in `src/research/pipeline.mjs` feeds the generator that currently produces the #1 stub.

**Open decisions to make before/while building:**
- **Nous Portal subscription** — **CONFIRMED.** #2/#3 use the Tool Gateway (web search, cloud browser/vision, image-gen) + Nous Portal models; OpenRouter stays a secondary `--provider`. Run `hermes setup --portal` (interactive OAuth) when building the engine.
- #1: frontend is **vanilla JS** (decided — no React, no bundler, zero deps); still pick + vet a **transactional email provider** (dev-mode console first).
- **Maintenance:** the `.npmrc` `before=` date is static and safe-when-stale; bump it only when you actually need newer packages — **not on a schedule.**
- Risk gate: the **Hermes drivability spike** (cheap, throwaway VM + plain Docker) before building #2/#3's engine-dependent parts.
