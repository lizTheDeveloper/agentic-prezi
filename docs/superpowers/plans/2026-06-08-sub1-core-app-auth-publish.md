# #1 Core App + Auth + Publish — Implementation Plan

**Date:** 2026-06-08
**Spec:** `docs/superpowers/specs/2026-06-08-sub1-core-app-auth-publish-design.md`
**Inherits:** #0 security/supply-chain (all controls apply).

**Goal:** The walking skeleton — magic-link sign-in → write a presentation → Publish →
a live `https://<slug>.themultiverse.school` URL, end-to-end, using a **stub generator**
in place of the real research/generation engine (#2/#3).

---

## Architecture decisions

- **Zero npm dependencies.** Backend is **TypeScript run natively by Node** (type-stripping;
  no `tsc`, no bundler), using only `node:http`, `node:sqlite`, `node:crypto`, `node:fs`,
  `node:path`. Frontend is **vanilla JS + native ES modules** + HTML/CSS, served as static
  files — **no React, no esbuild.**
  - *This resolves spec open item #1 (bundler choice).* The spec recommended React + esbuild
    "to confirm at review"; the project's stdlib-first policy (#0) and the explicit steer to
    prefer open web standards over libraries make a dependency-free SPA the right call for the
    walking skeleton. The JSON API seam is unchanged, so a framework can be adopted later
    through the #0 gate if it ever earns its keep.
- **TypeScript via Node type-stripping** keeps the spec's "Node + TypeScript" while adding zero
  build tooling. Code uses **erasable syntax only** (no enums, no parameter properties, no
  namespaces) so `node file.ts` and `node --test` run it directly.
- **Two origins by design:** the app origin (SPA + `/api/*`, cookies, auth) and the published
  origin (`<slug>.themultiverse.school`, static, no cookies, strict CSP). Dispatch is on the
  `Host` header so it is testable locally via a `Host` override (#4 provides wildcard DNS/TLS).
- **Time is stored as integer epoch-ms** throughout the DB.

## Tech / runtime notes

- Target runtime Node ≥26 (per `.nvmrc`/`engines`). Verified on this container (Node 22.22):
  `node:sqlite` and `.ts` type-stripping work flag-free under `node --test`, so the suite runs
  on both. `npm ci` is gated by `engine-strict` to ≥26 — there are **no dependencies**, so the
  lockfile stays empty and the #0 gate (`audit:deps`/`scan:secrets`/`test`) stays green.

---

## File structure (created by this plan)

| File | Responsibility |
|---|---|
| `src/config.ts` | Env-driven config (port, base domain, cookie secret, TTLs, limits, dev-mode). |
| `src/db.ts` | `node:sqlite` open + versioned migrations runner + schema. |
| `src/crypto.ts` | Token generation, SHA-256 hashing, constant-time compare. |
| `src/http.ts` | Body reading (size-limited), JSON helpers, cookie parse/serialize, `HttpError`. |
| `src/router.ts` | Tiny method+path router with `:param` capture. |
| `src/static.ts` | Traversal-safe static file server with injectable headers + SPA fallback. |
| `src/validate.ts` | Email/title/write-up validation + `escapeXml`. |
| `src/rate-limit.ts` | SQLite-backed fixed-window counter (per email + per IP). |
| `src/email.ts` | Dev-mode console magic-link sender (real `node:https` provider deferred to 1e). |
| `src/auth.ts` | Magic-link request/verify, sessions, session lookup, logout, `/api/me`. |
| `src/slug.ts` | `slugify` + base62 suffix; collision-checked minting. |
| `src/generator.ts` | **Stub generator**: title+write-up → self-contained SVG + `index.html` + `manifest.json`. The artifact/manifest **contract** #3 must honor. |
| `src/queue.ts` | SQLite-backed job queue: enqueue / claim / complete / fail (retry+backoff). |
| `src/worker.ts` | In-process poller; `generate` handler ties queue → generator → slug → publish. |
| `src/presentations.ts` | Presentation CRUD + publish API, ownership-enforced. |
| `src/app.ts` | App-origin handler: `/api/*` routing + CSRF + auth middleware + SPA static. |
| `src/published.ts` | Published-origin handler: slug → artifact dir, static, no cookies, strict CSP. |
| `src/server.ts` | `node:http` server, Host dispatch (app vs `<slug>`), starts the worker. |
| `public/index.html`, `public/app.js`, `public/app.css` | Vanilla SPA: login, verify, dashboard, editor. |
| `test/*.test.ts` | TDD coverage (auth, presentations, publish, host-routing, slug, generator, rate-limit). |

---

## Build phases (TDD per spec §10)

1. **1a Skeleton:** config, db+migrations, crypto, http/router/static utils, health check.
2. **1b Auth:** magic-link request/verify, sessions, middleware, rate-limit, dev-mode email.
3. **1c Presentations:** CRUD API + vanilla dashboard/editor SPA.
4. **1d Publish loop:** queue + worker + stub generator + slug minting + Host-based serving.
5. **1e Real email:** wire a vetted transactional REST provider over `node:https` (deferred).

## Tests (acceptance)

- **Auth:** token single-use, expiry rejection, session validation, rate-limit, enumeration-neutral 200s.
- **Publish:** publishing a draft yields retrievable artifacts + a unique slug; generator error → `failed`; retry/backoff.
- **Host routing:** app Host → SPA/API; slug Host → correct artifact dir; unknown slug → 404; CSP headers present on published assets.
- **Ownership:** a user cannot read/edit/publish another user's presentation.
- **CSRF:** non-GET `/api/*` without the custom header is rejected.

## Out of scope (deferred)

- Real research + Prezi generation → #2/#3 (stub stands in).
- Hetzner deploy, wildcard DNS, TLS, egress firewall → #4.
- Real transactional-email provider pick → 1e (dev-mode console until then).
