# Sub-project #1 — Core App + Auth + Publish — Design Spec

**Date:** 2026-06-08
**Status:** Draft for review
**Parent:** `2026-06-08-agentic-prezi-vision-design.md`
**Inherits:** `2026-06-08-sub0-security-supply-chain-design.md` (all controls apply)

> This repository is **public**. No secrets in source. See `CLAUDE.md`.

---

## 1. Purpose

The walking skeleton: a user signs in (magic link), writes a presentation (a title + write-up), hits **Publish**, and gets a live `https://<slug>.themultiverse.school` URL. This sub-project delivers the full request→publish loop **end-to-end** using a **stub generator** in place of the real research/generation engine, so the platform is demonstrable before #2/#3 exist and independent of the Hermes drivability spike.

### In scope
Backend HTTP/API, `node:sqlite` data layer, magic-link auth + sessions, React SPA (dashboard + editor), the publish pipeline + stub generator, slug minting, and Host-based subdomain serving of published static assets.

### Out of scope (named, deferred)
- Real research + Prezi generation → **#2 / #3** (a stub generator stands in).
- Hetzner deploy, wildcard DNS, TLS provisioning, egress/firewall → **#4** (this spec defines the Host-routing *logic*; #4 provides the infra). Local dev runs the Node server directly — **no Docker needed locally**.
- Final transactional-email provider pick → starts in dev-mode (console), real provider wired before real users.

---

## 2. Architecture

```
                    ┌───────────────────────────────────────────────┐
  browser  ───────► │  Node/TS server  (node:http, hand-rolled router)│
                    │                                                 │
   Host: app.*      │   ├─ JSON API            /api/*                 │
   ──────────────►  │   ├─ React SPA (static, built by esbuild)       │
                    │   │                                             │
   Host: <slug>.*   │   └─ Published-presentation static server       │
   ──────────────►  │       (read-only, no cookies, strict CSP)       │
                    │                                                 │
                    │   node:sqlite  (users, sessions, tokens,        │
                    │                 presentations, jobs)            │
                    │   node:crypto  (token + session signing)        │
                    │   SQLite-backed job queue + worker (stub gen)   │
                    └───────────────────────────────────────────────┘
                              │ node:https POST
                              ▼
                    transactional email API  (magic links)
```

- **Backend:** Node + TypeScript, **`node:http`** with a small hand-rolled router. Stdlib-first (`node:sqlite`, `node:crypto`, `node:https`) per #0. No web framework unless hand-rolling becomes painful, in which case one vetted micro-framework is added through the #0 gate.
- **Frontend:** **React SPA** (user's choice), bundled by **esbuild** (recommended — smallest toolchain surface; **the one frontend-toolchain item to confirm at review**). Served as static files from the app origin. The SPA talks to the backend purely via the JSON API.
- **Two origins, by design (security):** the **app** (SPA + API, authenticated, cookies) is a different origin from **published presentations** (`<slug>.themultiverse.school`, static, no cookies, CSP-locked — see #0 §B4).

---

## 3. Data model (`node:sqlite`)

| Table | Columns (essentials) | Notes |
|---|---|---|
| `users` | `id` PK, `email` UNIQUE, `created_at` | Created on first magic-link request. |
| `magic_tokens` | `token_hash` PK, `email`, `expires_at`, `used_at` NULL | Store **hash** only; single-use; short TTL (15 min). |
| `sessions` | `id` PK, `session_hash`, `user_id` FK, `expires_at`, `created_at` | Store hash of the session secret, not the secret. |
| `presentations` | `id` PK, `user_id` FK, `title`, `source_writeup`, `status`, `slug` UNIQUE NULL, `created_at`, `updated_at` | `status` ∈ {`draft`,`queued`,`generating`,`published`,`failed`}. |
| `jobs` | `id` PK, `presentation_id` FK, `type`, `status`, `attempts`, `payload` JSON, `result` JSON, `created_at`, `updated_at` | The SQLite-backed queue; shared contract with #2/#3. |

- Published artifacts (SVG/JS/manifest) are written as **files** under a per-presentation directory (`data/presentations/<id>/`); the DB holds metadata + slug. (Files serve cleanly as static assets; keeps the DB small.)
- A single migrations runner applies versioned SQL at startup.

---

## 4. Auth — passwordless magic link

**Request:** `POST /api/auth/request { email }`
1. Normalize email; upsert `users`.
2. Generate a 32-byte random token (`node:crypto.randomBytes`); store **SHA-256 hash** + 15-min expiry + `used_at = NULL`.
3. Email `https://app.themultiverse.school/auth/verify?token=<token>` (dev-mode: log to console).
4. **Rate-limit** per email + per IP (SQLite-backed counter); always return a neutral 200 ("check your email") to avoid account enumeration.

**Verify:** `POST /api/auth/verify { token }`
1. Hash the token, look it up; reject if missing, expired, or `used_at` set.
2. Mark `used_at = now` (single-use), create a `sessions` row, set cookie.
3. Cookie: **HttpOnly, Secure, SameSite=Lax**, signed session secret (`node:crypto`), ~30-day expiry; store only its hash server-side.

**Session middleware:** validates the cookie (constant-time hash compare) on `/api/*`; `POST /api/auth/logout` deletes the session.

**Security:** hashed token/session storage, single-use short-TTL tokens, constant-time comparisons, neutral responses, rate limiting. **CSRF:** state-changing API calls require a custom header (e.g. `X-Requested-With`) that cross-site HTML forms cannot set, on top of `SameSite` — simple and dep-free for a JSON SPA.

---

## 5. Editor & publish flow

1. **Create/edit** (authed): `POST/PATCH /api/presentations` with `{ title, source_writeup }` → `status = draft`.
2. **Publish:** `POST /api/presentations/:id/publish` → set `status = queued`, enqueue a `generate` job, return immediately (async).
3. **Worker** (in-process, polls `jobs`): claims the job → `status = generating` → runs the **stub generator** → writes artifacts to `data/presentations/<id>/` → mints a unique slug → `status = published`. On error → `status = failed`, with retry/backoff (capped `attempts`).
4. **Stub generator (this sub-project):** produces a *minimal but valid* presentation — a single self-contained SVG showing the title + write-up text (no research, no real zoom narrative) + a `manifest.json`. Its **output contract** (artifact filenames + manifest schema) is the seam that #3's real generator later fulfills unchanged.
5. **Status polling:** `GET /api/presentations/:id` returns status so the SPA can show progress and reveal the URL on `published`.

**Slug minting:** URL-safe, collision-checked — `slugify(title)` + short base62 random suffix (e.g. `quantum-foam-7Kp2`), uniqueness enforced by the `slug` UNIQUE constraint with retry.

---

## 6. Subdomain serving (logic here; DNS/TLS in #4)

The server routes on the `Host` header:
- `themultiverse.school` / `app.themultiverse.school` → React SPA + `/api/*` (cookies, auth).
- `<slug>.themultiverse.school` → serve `data/presentations/<id>/*` as **static, read-only, no-cookie** assets with a strict CSP (`default-src 'self'`; no third-party `script-src`/`connect-src`; restrictive `frame-ancestors`) per #0 §B4. A slug→presentation lookup maps the subdomain to its artifact directory; unknown slug → 404.

Wildcard DNS (`*.themultiverse.school`) and a wildcard TLS cert are provisioned in **#4**; this spec only defines the Host-dispatch behavior so it's testable locally (via `Host` header override).

---

## 7. API surface (initial)

| Method & path | Purpose | Auth |
|---|---|---|
| `POST /api/auth/request` | Send magic link | no |
| `POST /api/auth/verify` | Exchange token → session | no |
| `POST /api/auth/logout` | End session | yes |
| `GET /api/me` | Current user | yes |
| `GET /api/presentations` | List own presentations | yes |
| `POST /api/presentations` | Create draft | yes |
| `PATCH /api/presentations/:id` | Edit title/write-up | yes (owner) |
| `POST /api/presentations/:id/publish` | Enqueue generation | yes (owner) |
| `GET /api/presentations/:id` | Detail + status | yes (owner) |

All write endpoints validate input and enforce ownership.

---

## 8. Security (inherits #0; #1-specific points)

- Cookies HttpOnly/Secure/SameSite; tokens & session secrets stored **hashed**; constant-time compares.
- Auth-request rate limiting + neutral responses (no account enumeration).
- CSRF via custom-header requirement + SameSite.
- Published assets on a **separate origin**, no credentials, strict CSP (#0 §B4).
- React + esbuild + any frontend dep pass the **#0 7-day min-age gate**, pinned, `ignore-scripts`.
- Input validation/size limits on write-ups; output of the stub generator is escaped/sanitized before embedding in SVG.

---

## 9. Build phases (within #1)

1. **1a — Backend skeleton:** `node:http` server + router, `node:sqlite` + migrations, health check, esbuild SPA build pipeline.
2. **1b — Auth:** magic-link request/verify, sessions, middleware — **dev-mode email to console**.
3. **1c — Presentations:** CRUD API + React dashboard & editor (textarea + Publish).
4. **1d — Publish loop:** job queue + worker + **stub generator** + slug minting + Host-based static serving (local, via Host override).
5. **1e — Real email:** wire the transactional REST provider over `node:https` (provider chosen + vetted).

---

## 10. Testing (TDD per superpowers)

- **Auth:** token single-use, expiry rejection, session validation, rate-limit, enumeration-neutral responses.
- **Publish:** publishing a draft yields a retrievable artifact + slug; `failed` path on generator error; retry/backoff.
- **Host routing:** app Host → SPA/API; slug Host → correct artifact dir; unknown slug → 404; CSP headers present on published assets.
- **Ownership:** a user cannot read/edit/publish another user's presentation.

---

## 11. Open items

1. **Bundler confirmation** — esbuild recommended (smallest surface); confirm at review vs. Vite/other.
2. **Transactional email provider** — pick + vet one (Postmark/Resend/SES-class) for phase 1e; dev-mode console until then.
3. **Job-queue schema** is defined here but **shared** with #2/#3 — keep the `jobs` contract stable; the stub generator's artifact/manifest contract is the seam #3 must honor.
