# Sub-project #4 — Deploy / Hosting — Design Spec

**Date:** 2026-06-08
**Status:** Draft for review
**Parent:** `2026-06-08-agentic-prezi-vision-design.md`
**Inherits:** `2026-06-08-sub0-security-supply-chain-design.md` (this sub-project **implements Surface B**)
**Enables:** the vision-spec **Milestone-zero spike** (provides the host it runs on)

> This repository is **public**. Secrets live only on the box / in Docker secrets — never in repo or images. See `CLAUDE.md`.

> **⚠️ Deployment-reality update (2026-06-08):** the actual target box (`cto-tycoon-hel1`, the operator's **main** host) is **Coolify-managed** — `coolify-proxy` (Traefik v3.6) owns :80/:443 and DNS for `themultiverse.school` is on **Cloudflare**. The §4 self-Caddy + ACME **DNS-01 wildcard** and the §7 build-on-box + `pre-receive` + tarball-rollback pipeline **do not apply to this box** — they would fight Coolify (which owns the Traefik config) and double-bind the proxy ports. The skeleton (#1) deploy is therefore a **Coolify application** behind the existing Traefik, with Cloudflare owning edge TLS. See **`deploy/coolify-deploy.md`** for the live architecture, blockers, and go-live sequence. §5 (gVisor sandbox-broker), §10.1 (self-hosted GlitchTip), and the Hermes worker remain the design for the engine-bearing build, deferred until after the drivability spike.

---

## 1. Purpose & topology

Stand up and operate the platform on **one Hetzner Cloud box**, Docker-based, **remote-only** (the operator runs **no local Docker**). Deliver: wildcard TLS for `*.themultiverse.school`, a build-on-box deploy with tarball rollback, the **Surface-B runtime sandbox** (gVisor-isolated, no-socket, no-egress, no-secrets), a secret store, backups, and OS hardening.

```
                       Hetzner Cloud VM (Ubuntu LTS, hardened)
  Internet ──► Hetzner Cloud Firewall (default-deny)
                       │
                  ┌────▼─────────────────────────────────────────┐
                  │ docker compose                                │
                  │  • caddy        → wildcard TLS + reverse proxy│
                  │  • control-plane→ Node app (#1): API+SPA+publish│
                  │  • hermes-worker→ orchestrates jobs (#2/#3)   │
                  │  • sandbox-broker → narrow API to launch sandboxes│
                  │                                               │
                  │  ⟂ ephemeral JOB SANDBOX (per job, gVisor runsc):│
                  │      runs Hermes execute_code / Playwright    │
                  │      NO socket · NO egress · NO secrets · RO FS│
                  │                                               │
                  │  volume: SQLite db + data/presentations/*     │
                  └───────────────────────────────────────────────┘
```

---

## 2. Box & OS hardening (dev/infra security — extends #0)

- Ubuntu LTS; **SSH key-only**, root login disabled, a non-root **deploy** user; `ssh` on key auth only.
- **Hetzner Cloud Firewall** default-deny inbound except 80/443 (and SSH from known IPs); plus host `ufw` as defense-in-depth.
- Unattended **security updates**; `fail2ban` on SSH.
- **Rootless Docker** for app containers where possible; the only privileged component is the tightly-scoped `sandbox-broker` (§5).
- Secrets never in images or repo (§6); least-privilege deploy key.

---

## 3. Orchestration & services (`docker compose`, single box)

| Service | Role | Notes |
|---|---|---|
| **caddy** | TLS termination + reverse proxy | Automatic wildcard HTTPS (§4); routes Host → control-plane; serves nothing privileged itself. |
| **control-plane** | The #1 Node app (API + SPA + publish + static presentation serving) | Holds DB + artifact volume; has model/secret access. |
| **hermes-worker** | Picks up jobs, runs #2 research (orchestration-layer) + drives #3 generation | Calls `sandbox-broker` to run untrusted code; **never** holds the raw Docker socket. |
| **sandbox-broker** | Small privileged service exposing a **narrow** API: "run this job in a locked-down sandbox, return artifacts" | The only component that can launch containers; audited, minimal surface (§5). |
| **job sandbox** | Ephemeral, per-job, **gVisor** runtime | Runs Hermes `execute_code` + Playwright; destroyed after. |

k8s/swarm are out of scope (one box → compose is the minimal sane choice).

---

## 4. DNS & wildcard TLS

- DNS: `*.themultiverse.school` **A** → box IP, plus `app`/apex records. (Per-presentation subdomains resolve to the box; control-plane routes by Host per #1 §6.)
- TLS: **Caddy** issues a **wildcard cert via ACME DNS-01** (HTTP-01 can't do wildcards). DNS-01 needs the **DNS provider's API token** → **open item: which DNS host manages themultiverse.school** (token goes in the secret store, §6).
- `font-src 'self'` and the published-asset CSP (#0 §B4, #3 §7.1) are enforced at the proxy/app layer.

---

## 5. Surface-B runtime sandbox — implementation (the security crux)

Resolves the #0/#3 requirement to run untrusted **agent-generated code** safely, and the Docker-socket tension head-on.

- **No raw socket for the worker.** Giving `hermes-worker` the Docker socket would be host-root-equivalent. Instead, a small **`sandbox-broker`** holds the launch capability and exposes only: `runJob(jobId, workspaceDir) → {artifacts, logs, exit}`. It launches a **fixed, locked-down** sandbox profile — the worker cannot parameterize it into something dangerous.
- **Kernel isolation: gVisor (`runsc`).** Each job sandbox runs under gVisor so a container-escape exploit hits gVisor's syscall-filtering layer, not the host kernel. **Why gVisor over Firecracker:** Firecracker microVMs need nested KVM (`/dev/kvm`), which Hetzner **Cloud** VMs typically don't expose; gVisor runs in an ordinary cloud VM. (If we later move to Hetzner dedicated/bare-metal, Firecracker becomes an option — noted, not required.)
- **Sandbox profile (enforced by the broker):** non-root, **read-only root FS**, only writable mount = the per-job workspace, **all caps dropped**, `--pids-limit` + CPU/mem caps, **no Docker socket**, **default-deny egress** (no network), **no platform secrets/keys injected**. Ephemeral; destroyed on completion.
- **Hermes config** in the worker image hard-sets `terminal.backend=docker` (never `local`) and routes execution through the broker/gVisor sandbox; MCP `npx -y` auto-install disabled, pinned local MCP allowlist only (#0 §B2).

---

## 6. Secrets & egress

- **Secret store:** secrets (Nous Portal, OpenRouter, DNS-API token, optional PubMed key, SMTP/email key) live **only on the box** as **Docker Compose secrets / a root-owned `600` env file**, injected at runtime into `control-plane` + `hermes-worker` only — **never** the job sandbox, **never** images, **never** the public repo. Provisioned out-of-band over SSH. Rotation runbook per #0 §B5.
- **Egress allowlist (#0 §B3):** at the Hetzner firewall + container network policy — allow outbound only to Nous Portal, OpenRouter, the scholarly API hosts (#2), npm registry (build only), ACME/DNS, system updates. The **job sandbox has no egress at all.**

---

## 7. Deploy pipeline (build-on-box, tarball rollback — no registry)

1. **Gate (Hetzner server-side — NO GitHub Actions):** pushing to the box's **bare deploy repo** triggers a git **`pre-receive` hook** that runs the #0 `scripts/ci-gate.sh` (`npm ci --ignore-scripts`, audit gate, secret scan, tests). Failure **rejects the push** — bad code never reaches the box. GitHub remains a public mirror only.
2. **Release:** push a git **tag**.
3. **Deploy script (`scripts/deploy.sh`, runs over SSH):** on the box → `git fetch && checkout <tag>` → `docker build` (build also re-runs `npm ci --ignore-scripts` + the audit gate as defense-in-depth) → `docker save` the new image to `releases/<tag>.tar` (retain last **N**) → run DB migrations → `docker compose up -d` (brief downtime acceptable for single-box MVP).
4. **Rollback:** `docker load releases/<previous>.tar` + `compose up -d`; migrations are forward-only with documented down-path for risky ones.
- No local Docker involved at any step — build happens on the box.

---

## 8. Data persistence & backups

- **Volume** holds the `node:sqlite` DB + `data/presentations/*` artifacts.
- **Backups:** nightly `cron` → consistent SQLite backup (`.backup`) + tar of artifacts → **off-box** target (Hetzner object storage / volume snapshot). Retention policy; periodic restore test.
- Published artifacts are regenerable from source write-ups, but the DB (users, presentations) is the thing to protect.

---

## 9. Milestone-zero spike (this sub-project provides the host)

**The minimal drivability spike does NOT wait on #4.** It runs first on a throwaway VM with **plain Docker + Nous Portal creds** (no broker, no gVisor, no hardening) to answer the four vision-spec §5 questions cheaply — that is the early engine gate, and it runs in parallel with #0/#1.

What #4 owns instead: once the engine is **proven** and we build the production runtime (broker + gVisor + egress), #4 **re-verifies** the same behaviors under the hardened sandbox (the §11 acceptance checks) via `scripts/spike.sh`. So: cheap spike early (decoupled) → harden here only after it passes.

---

## 10. Monitoring & ops

- Container **healthchecks** + `restart: unless-stopped`; compose logs shipped to disk with rotation.
- Job-failure surfaced in the #1 dashboard (`status=failed`).
- Resource alerts (disk/mem) — keep minimal; expand later.

### 10.1 Error tracking & uptime — self-hosted GlitchTip

**GlitchTip** (open-source, **self-hostable**, **Sentry-SDK/API compatible**) is the platform's error-tracking + uptime + log/perf monitor. It tracks exceptions, log messages, CSP-violation reports, slow requests, and pings the app for uptime.

- **Self-hosted on the Hetzner box** as a `docker compose` service (with its own backing datastore — Postgres/Redis per its compose; confirm versions + pin images at deploy). On-box ⇒ **no third-party SaaS, no error-data egress** off the box — consistent with the project's stance.
- **Reporting WITHOUT the `@sentry/node` SDK:** the control plane + Hermes worker send events via a **tiny stdlib (`node:https`) POST** to GlitchTip's **Sentry-compatible event ingest** (the project DSN), rather than pulling the large `@sentry/*` npm dependency tree — honoring #0's minimal-dependency rule. A small `src/reporter.ts` wraps the top-level error handlers (the `app.ts` 500 path, `worker.ts` job failures, `server.ts` unhandled-rejection hook) and posts `{ exception, message, level, context }` to the DSN.
- **DSN is config, not a secret in repo** — injected from the runtime secret store (#0 §B5 / §6). Internal traffic is box-local (or the GlitchTip ingest host is added to the §6 egress allowlist if split out).
- **Scrubbing:** the reporter strips obvious sensitive fields before sending; since presentations are non-secret this is low-risk, but session cookies / tokens must never be attached to events.
- Uptime: prefer GlitchTip's built-in uptime monitor over a separate external check.

> Pin the GlitchTip image by digest and treat it like any dependency (review + pinned). Implemented as part of #4's compose stack; the `reporter.ts` client is small enough to land with #1/#4 wiring.

---

## 11. Security acceptance (verifies #0 Surface B)

- Job sandbox: **no Docker socket**, **no egress** (network call fails), **no secrets/env keys present**, read-only FS, gVisor runtime active, non-root — all asserted by a test in the spike harness.
- Worker cannot obtain the raw Docker socket (only the broker API).
- Published origin serves with strict CSP, no cookies (#0 §B4).
- Secrets absent from repo + images (scanned).

---

## 12. Open items

1. **DNS provider** for `themultiverse.school` (drives the Caddy ACME DNS-01 plugin + API token) — identify the host.
2. **Backup target** (Hetzner object storage vs. volume snapshots) + retention numbers.
3. **Box sizing** (CPU/RAM/disk) — gVisor + Playwright + Hermes have real footprints; size after the spike measures a real job.
4. **gVisor** confirmed as the runtime (Firecracker only if we move to bare-metal).
5. **Secret store** final form (Compose secrets vs. root-owned env file) — pick in planning.
6. Brief deploy downtime acceptable for MVP; blue-green is a later enhancement.
