# Deploying agentic-prezi onto the main Hetzner box (Coolify / Traefik)

**Status:** runbook for the #1-skeleton public deploy. Supersedes the self-Caddy +
DNS-01-wildcard + build-on-box-tarball design in `docs/.../sub4-deploy-hosting-design.md`
§4/§7 **for this box** — that box is Coolify-managed and we must integrate, not replace.

## Why the original #4 design doesn't apply here

The target is `cto-tycoon-hel1` (37.27.36.108), the operator's **main** box — it already
runs ~40 production containers. Discovered reality:

- **`coolify-proxy` (Traefik v3.6) owns :80 and :443.** We cannot bind our own Caddy there
  without breaking every other site. Hand-editing Traefik or hand-attaching containers with
  Traefik labels gets **clobbered by Coolify**, which owns that proxy's config.
- **DNS for `themultiverse.school` is on Cloudflare** (NS: ishaan/ulla.ns.cloudflare.com),
  apex is Cloudflare-proxied (orange cloud). `app.` and `*.` do **not** resolve yet.
- Disk: 111 GB free — room for the skeleton.

So the native path is: **deploy agentic-prezi as a Coolify application**, let Coolify+Traefik
own routing + origin TLS, and let Cloudflare own edge TLS for the wildcard.

## Architecture (this box) — TWO explicit subdomains, NO wildcard

```
Browser ──HTTPS──► Cloudflare edge (Universal SSL, one-level *.themultiverse.school)
                        │  (proxied, "Full" mode)
                        ▼
            Traefik (coolify-proxy, :443)
                ├── Host app.themultiverse.school           ──► agentic-prezi container :8787  (SPA + /api, cookies)
                └── Host presentations.themultiverse.school ──► same container :8787  (published /p/<slug>, cookieless)
                                                                       │
                                                                volume: /app/data (SQLite + artifacts)
```

ONE container (repo `Dockerfile`, Node 26, zero deps, `node src/server.ts`) serves BOTH hosts;
`src/server.ts` dispatches by Host: `app.` → app origin, `presentations.` → published origin.
Published pages are **path-based** — `presentations.themultiverse.school/p/<slug>/` — so there is
no per-presentation subdomain and therefore **no wildcard DNS record** (a wildcard would swallow
the ~40 sibling deployments already on `folkfork.`, `bazaar.`, … `themultiverse.school`).
Origin isolation is preserved: published pages live on a different host from the cookie-bearing app.

## TLS — no DNS-01, no wildcard needed

Both `app.` and `presentations.` are **single-level** subdomains, covered by Cloudflare
**Universal SSL** at the edge for free. No two-level wildcard, no Cloudflare API token, no DNS-01
plugin. Origin just needs a cert Cloudflare trusts in **Full** mode (Coolify/Let's Encrypt per
host). **VERIFY** Universal SSL is active on this account's plan (it is, by default).

## Blockers — none bypassable; each needs operator-held access

1. **Cloudflare DNS** — add two **explicit** proxied records → the box (37.27.36.108):
   `app.themultiverse.school` and `presentations.themultiverse.school`. **Do NOT add a wildcard.**
   Needs Cloudflare account access or a scoped API token.
2. **SendGrid key in Coolify** — prod magic-link is the ONLY auth (`DEV_AUTH_BYPASS` refused when
   `NODE_ENV=production`), and the app now **refuses to start** in prod without an email provider.
   The sender is wired (`src/email-sendgrid.ts`, zero-dep). Set `SENDGRID_API_KEY` (the token
   already on the box — see `multiverse-email-worker`) + `EMAIL_FROM` (a SendGrid-verified sender)
   in Coolify secrets. **Wiring ≠ key present: login stays broken until the key is set.**
3. **Coolify access** — adding the app needs Coolify admin (UI at the box, or an API token).

## Go-live sequence (staging gate inside the public launch — no risky big-bang)

1. In Coolify: create an Application from this repo (or `Dockerfile`). Set the persistent
   volume mount `/app/data`. Set env from `deploy/prod.env.example` (real secrets in Coolify's
   secret store): `SENDGRID_API_KEY`, `EMAIL_FROM`, `COOKIE_SECURE=true`, `BASE_DOMAIN`,
   `PUBLISHED_HOST`. Do **not** set `DEV_AUTH_BYPASS`.
2. Attach BOTH domains to the one app in Coolify: `app.themultiverse.school` and
   `presentations.themultiverse.school` → Traefik routes + per-host origin certs.
3. Add the two explicit Cloudflare records (proxied) → the box. **No wildcard.**
4. Verify on the box: app boots `NODE_ENV=production` (it refuses to start if email is unset);
   `app.` serves the SPA, `presentations.themultiverse.school/p/<slug>/` serves a published
   deck with strict CSP and **no** cookies; `/api/dev/login` → 404; secrets absent from the image.
5. Confirm a magic link actually delivers (SendGrid) and login → create → publish works end to end.
6. Launch.

## Explicitly deferred (need the Hermes drivability spike first; not in this skeleton)

gVisor sandbox-broker, Hermes worker, Playwright vision loop, self-hosted GlitchTip stack.
The stub generator needs no secrets and no sandbox, so the skeleton deploy is just the
control-plane container + its volume + one Traefik route.
