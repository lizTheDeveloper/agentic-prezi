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
