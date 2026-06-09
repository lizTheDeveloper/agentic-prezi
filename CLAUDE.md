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
- **#2 research engine is BUILT** (`src/research/*`; pipeline scope→discover→rank→synthesize→**grounding ⚑**→validate, emitting the `#3 §4` contract; OpenAlex/Crossref/arXiv/PubMed adapters; budget caps + HTTP hardening; plan in `docs/superpowers/plans/2026-06-08-sub2-research-engine.md`). Run: `npm run research -- "<write-up>"`. **Real `llm` wired into `runResearch({ llm })`** via the Nous Portal provider (`src/research/providers/nous.mjs`, OpenAI-compatible `/v1/chat/completions`, Bearer `NOUS_RESEARCH_API_KEY`, default `anthropic/claude-opus-4.8`; override `NOUS_RESEARCH_MODEL`/`NOUS_RESEARCH_BASE_URL`). **NOTE: the LLM is now REQUIRED for scope/synthesize — the deterministic offline fallback was removed (diverges from #2 spec §8; failures error loudly).** **Still TODO:** Hermes/cloud-browser extraction adapter (§8) and the §7.1 Prompt Guard 2 injection scan.
- **#3 presentation-generator core is BUILT** (`src/prezi/*`; Compose → single-canvas SVG compile → browser-free geometric critique → bounded refine loop → full artifact set incl. CSP-locked `index.html` + vanilla-JS player; scene-graph IR validator; consumes `#2 §4`; emits the `#1` manifest superset; plan in `docs/superpowers/plans/2026-06-08-sub3-presentation-generator.md`). Run: `npm run generate -- --research <file> --title "…" --out <dir>` (or `--from-writeup` to chain #2). Engine-dependent stages are **dependency-injected with deterministic offline defaults**. **Still to wire (needs the spike):** real Generate (Hermes `execute_code`), Playwright + vision critic, an `llm` into Compose, embedded typeface (§7.1), enforce the `shape.svg` trust boundary, and the #2→#3→#1 worker seam.

**Routing (changed 2026-06-08):** published presentations are now served **path-based on ONE dedicated host** — `presentations.themultiverse.school/p/<slug>/` (config `PUBLISHED_HOST`, default `presentations.<baseDomain>`) — **not** per-slug subdomains. The app is on `aethrix.themultiverse.school` (cookies; config `APP_HOST` — `app.` is taken by a sibling service on the shared box). Two explicit single-level subdomains, **no wildcard** (a wildcard would capture the ~40 sibling `*.themultiverse.school` deployments on the shared box). Origin isolation preserved (published host is cookieless, strict CSP). `src/published.ts` has both `handlePublishedPath` (path-based, the deploy) and legacy host-based `handlePublished`. **Prod email is wired:** `src/email-sendgrid.ts` (zero-dep `node:https` SendGrid sender); `server.ts` selects it when `SENDGRID_API_KEY`+`EMAIL_FROM` are set and **refuses to start in prod without an email provider** (dead-login guard). 185 tests.

**#4 deploy — IN PROGRESS (skeleton artifacts built 2026-06-08):** the target is the operator's **main** box `cto-tycoon-hel1` (37.27.36.108), which is **Coolify-managed** — `coolify-proxy` (Traefik v3.6) owns :80/:443 and DNS is on **Cloudflare**. So the self-Caddy + DNS-01-wildcard + build-on-box-tarball design in spec §4/§7 **does not apply to this box**; we deploy as a **Coolify application** and let Traefik+Cloudflare own routing/TLS. Built + locally verified (prod-mode boot serves 200, `/api/dev/login` 404s): `Dockerfile` (node:26, zero-dep, `node src/server.ts`), `.dockerignore`, `deploy/prod.env.example`, `deploy/coolify-deploy.md` (architecture + go-live sequence). **Three operator-held blockers before public launch:** (1) Cloudflare DNS records for `app.`/`*.themultiverse.school`; (2) a transactional **email provider** — prod magic-link is the only auth (`DEV_AUTH_BYPASS` refused in prod) and `src/email.ts` has only `ConsoleEmailSender`, so **no login is possible until it's wired**; (3) Coolify admin access to create the app. Wildcard TLS likely needs **no** DNS-01 (Cloudflare Universal SSL covers one-level `*.themultiverse.school` at the edge — verify the account plan). gVisor/Hermes-worker/Playwright/GlitchTip stack deferred (stub needs none).

**Next:** resolve the three deploy blockers → Coolify go-live (`deploy/coolify-deploy.md`); the **Hermes drivability spike**; then the Hermes/cloud-browser **extraction adapter** (§8) + **§7.1 Prompt Guard 2** scan; inject the engine-dependent **#3** stages; then wire **#2 → #3 → #1 worker** (swap the injected generator at `src/worker.ts` for `makePreziGenerator()`). Seam: `runResearch()` in `src/research/pipeline.mjs`.

**Open decisions to make before/while building:**
- **Nous Portal subscription** — **CONFIRMED.** #2/#3 use the Tool Gateway (web search, cloud browser/vision, image-gen) + Nous Portal models; OpenRouter stays a secondary `--provider`. Run `hermes setup --portal` (interactive OAuth) when building the engine.
- #1: frontend is **vanilla JS** (decided — no React, no bundler, zero deps); still pick + vet a **transactional email provider** (dev-mode console first).
- **Maintenance:** the `.npmrc` `before=` date is static and safe-when-stale; bump it only when you actually need newer packages — **not on a schedule.**
- Risk gate: the **Hermes drivability spike** (cheap, throwaway VM + plain Docker) before building #2/#3's engine-dependent parts.
