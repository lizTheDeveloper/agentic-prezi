# agentic-prezi

Turns a write-up into a researched, cited, Prezi-style (zooming, spatial) SVG presentation and
publishes it to a `*.themultiverse.school` URL.

> This repository is **public**. Never commit secrets — see [`CLAUDE.md`](./CLAUDE.md).

## Status

- **#0 security/supply-chain** — built (supply-chain gate, secret scanner, CI hook).
- **#1 core app + auth + publish** — built (this is the walking skeleton). Sign in with a magic
  link, write a presentation, hit **Publish**, get a live `https://<slug>.themultiverse.school`
  URL. Uses a **stub generator** in place of the real research/generation engine (#2/#3).

See `docs/superpowers/specs/` for designs and `docs/superpowers/plans/` for implementation plans.

## Tech choices

- **Zero npm dependencies.** Backend is **TypeScript run natively by Node** (type-stripping — no
  `tsc`/bundler), using only the standard library (`node:http`, `node:sqlite`, `node:crypto`,
  `node:fs`). The frontend is **vanilla JS + native ES modules** served as static files (no React,
  no esbuild). Open web standards over libraries.
- Requires **Node ≥ 26** (`.nvmrc`); `node:sqlite` and `.ts` type-stripping run flag-free.

## Setup

```sh
git clone <repo> && cd agentic-prezi
sh scripts/setup-dev.sh    # one-time: enables git hooks (core.hooksPath=.githooks)
```

There are no dependencies to install. (`npm install` only writes an empty lockfile; the #0 gate
keeps it that way.)

## Run

```sh
npm start            # or: node src/server.ts
```

Then open `http://localhost:8787`. In **dev mode** (the default) magic-link emails are printed to
the server console instead of being sent — copy the link from there to sign in.

### Host-based routing (local)

The server dispatches on the `Host` header (wildcard DNS/TLS comes in #4):

- `localhost` / `app.themultiverse.school` → the app (SPA + `/api/*`, cookies, auth).
- `<slug>.themultiverse.school` → the published presentation (static, no cookies, strict CSP).

To view a published presentation locally, send the matching `Host` header, e.g.:

```sh
curl -H 'Host: <slug>.themultiverse.school' http://localhost:8787/
```

### Configuration (env vars)

`PORT`, `BASE_DOMAIN`, `COOKIE_SECRET` (set a stable value in production), `COOKIE_SECURE`,
`DATA_DIR`, `DB_PATH`, `PUBLIC_DIR`, `DEV_MODE`. Sensible dev defaults let it run with no setup.

## Test

```sh
npm test             # node --test — unit + HTTP integration tests
```

## Security & CI

- Supply-chain gate (7-day min dependency age), secret scanner, and full CI run **server-side on
  Hetzner** via a git `pre-receive` hook — **never GitHub Actions**. GitHub is a public mirror.
- Add a dependency only via `scripts/add-dep.sh <pkg>` (applies the 7-day cutoff). See
  `docs/security/`.
