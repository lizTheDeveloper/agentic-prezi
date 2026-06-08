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

## Architecture (this box)

```
Browser ──HTTPS──► Cloudflare edge (Universal SSL: *.themultiverse.school)
                        │  (proxied, "Full" mode)
                        ▼
            Traefik (coolify-proxy, :443)  ──Host route──►  agentic-prezi container (:8787)
                                                                 │
                                                          volume: /app/data (SQLite + artifacts)
```

The container is built from the repo `Dockerfile` (Node 26, zero npm deps, `node src/server.ts`).
It serves the SPA + `/api/*` on app hosts and `slug.themultiverse.school` published pages by Host
(see `src/server.ts` Host dispatch). Traefik passes the Host header through; the app routes on it.

## Wildcard TLS — the DNS-01 apparatus likely disappears

Cloudflare **Universal SSL** covers a single label of wildcard — `*.themultiverse.school` — for
free at the edge. With per-presentation subdomains one level deep (`slug.themultiverse.school`),
**Cloudflare terminates TLS for all of them** with no DNS-01 on the box. Origin then only needs a
cert Cloudflare trusts in **Full** mode (Coolify/Let's Encrypt for `app.themultiverse.school`, or
Full(strict) with a proper origin cert). **VERIFY** against this account's Cloudflare plan before
relying on it; if it holds, no Cloudflare API token / DNS-01 plugin is needed at all.

## Blockers — none of these are bypassable, and each needs operator-held access

1. **Cloudflare DNS** — add `app.themultiverse.school` and `*.themultiverse.school` records
   pointing at the box (proxied). Needs Cloudflare account access or a scoped API token.
2. **Transactional email** — prod magic-link login is the ONLY auth in prod
   (`DEV_AUTH_BYPASS` is refused when `NODE_ENV=production`). `src/email.ts` currently has only
   `ConsoleEmailSender`. **Until a real provider is wired + its key set in Coolify, no one can
   log in.** Pick + vet a provider (node:https POST, no SDK) through the #0 supply-chain gate.
3. **Coolify access** — adding the app needs Coolify admin (UI at the box, or an API token).

## Go-live sequence (staging gate inside the public launch — no risky big-bang)

1. In Coolify: create an Application from this repo (or `Dockerfile`). Set the persistent
   volume mount `/app/data`. Set env from `deploy/prod.env.example` (real secrets in Coolify's
   secret store). Do **not** set `DEV_AUTH_BYPASS`.
2. Wire + deploy the email provider; confirm a magic link actually delivers.
3. Assign domain `app.themultiverse.school` in Coolify → Traefik route + origin cert.
4. Add the Cloudflare records (proxied). Test login + create + publish on a real subdomain.
5. Verify on the box: app boots with `NODE_ENV=production`, `/api/dev/login` returns 404,
   published origin serves strict CSP with **no** cookies, secrets absent from the image.
6. Flip/confirm `*.themultiverse.school` so published `slug.` pages resolve. Launch.

## Explicitly deferred (need the Hermes drivability spike first; not in this skeleton)

gVisor sandbox-broker, Hermes worker, Playwright vision loop, self-hosted GlitchTip stack.
The stub generator needs no secrets and no sandbox, so the skeleton deploy is just the
control-plane container + its volume + one Traefik route.
