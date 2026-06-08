# Sub-project #0 — Dev & Supply-Chain Security — Design Spec

**Date:** 2026-06-08
**Status:** Draft for review
**Parent:** `2026-06-08-agentic-prezi-vision-design.md` (§6)
**Scope:** Comprehensive — install-time dev-machine protection **and** Hetzner runtime sandbox.

> This repository is **public**. Do not commit secrets. See `CLAUDE.md`.

---

## 1. Purpose & threat model

The asset we protect is the **operator's machine and infrastructure** — *not* the presentations (those are public by design). Two distinct attack surfaces, addressed separately:

| Surface | Where | Primary threat | Built where |
|---|---|---|---|
| **A — Install-time supply chain** | Dev machine + CI | A malicious/compromised npm package (a "worm") runs code on install or ships a backdoor | **#0 — now** |
| **B — Runtime sandbox** | Hetzner box | Agent-*generated* code, a compromised MCP server, or presentation JS does something hostile | **Designed here; implemented in #4 (deploy) & #3 (generation)** |

### Threat → control map

| Threat | Control(s) | Surface |
|---|---|---|
| Worm in a direct/transitive npm dep executes on install | `ignore-scripts=true`; min-age gate; lockfile integrity | A |
| Freshly-published malicious version pulled in | **7-day minimum release-age gate** (resolution + audit) | A |
| Lockfile tampering / version drift | Committed lockfile + exact pins + integrity hashes | A |
| Compromised third-party CI (e.g. GitHub Actions) | **Not used at all** — CI is a Hetzner server-side git `pre-receive` hook; GitHub is a public mirror only | A |
| Secret committed to a public repo | `.gitignore` + env-only secrets + `CLAUDE.md` warning + pre-push scan | A |
| Agent-generated code escapes / exfiltrates | Docker terminal backend, never `local`; default-deny egress; no secrets in sub-sandbox | B |
| `npx -y` auto-installs a malicious MCP server | npx auto-install **disabled**; pinned local MCP allowlist | B |
| Published presentation JS attacks platform/other users | Per-presentation origin isolation + strict CSP + zero credentials | B |
| Long-term key compromise | Keys in runtime secret store, not in images/repo; rotation runbook | B |

---

## 2. Surface A — install-time supply chain (build now)

### A1. 7-day minimum release-age gate (three layers, defense-in-depth)

> **Timing matters — the dev box is the least-protected moment.** A worm has two execution moments: install-time (`postinstall`) and import/run-time (code that runs on `require`). `ignore-scripts` (A3) kills the first; the second is only stopped by keeping the fresh malicious version *out of the tree in the first place*. CI and pre-push (Layer 3) run **after** a developer has already done `npm install` + `npm test` locally — by then the dev box is compromised and CI just reports it. Therefore the **local install itself** must refuse fresh versions. That is Layer 1's job.

**Layer 1 — `.npmrc before` (protects EVERY local install, automatically):**
Set a static, conservative cutoff in the project `.npmrc`:
```
before=2026-06-01T00:00:00Z
```
npm honors `before` (verified: `npm config get before` recognizes the key) and resolves the **entire dependency tree** to versions published on or before that date — so *any* `npm install` on the dev box, including a careless raw one, silently refuses anything newer. A **static** date (bumped periodically, e.g. weekly, by the operator) errs *conservative*: an older cutoff = more min-age = safer, so staleness costs freshness, never security. This is the layer that actually protects the developer's machine at resolution time, before any test or import runs.

**Layer 2 — `add-dep.sh` rolling 7-day window (for intentional adds):**
When deliberately adding/updating a dep, use a precise rolling cutoff of `now − 7 days` (tighter than the static `.npmrc` date):
```
npm install <pkg> --before="$(node -e 'console.log(new Date(Date.now()-7*864e5).toISOString())')"
```
`--before` applies tree-wide (same mechanism as Layer 1). Wrapped in `scripts/add-dep.sh`.

**Layer 3 — audit-time hard gate (authoritative; runs in CI + pre-push):**
A custom **stdlib-only** Node script `scripts/audit-deps.mjs` (uses only `node:https`, `node:fs`, `node:path` — *zero third-party deps, nothing new to trust*):
1. Parse `package-lock.json`; enumerate **every** package + resolved version (direct **and** transitive).
2. For each, GET `https://registry.npmjs.org/<pkg>` and read `time[version]` (publish timestamp). Responses cached to `.cache/registry/` to stay rate-limit-friendly and offline-repeatable.
3. **Exit 1 (fail the build)** if any resolved version was published within the last 7 days.
4. Also assert: every dep has an `integrity` hash in the lockfile; versions are exact-pinned (no ranges in `package.json`).
5. Print a clear violation report (package, version, publish date, age).

> **Why a separate script, not a lifecycle hook:** because `ignore-scripts=true` (A3) intentionally disables npm lifecycle scripts, the gate must be invoked **explicitly** (CI step + git hook), never as a `preinstall`/`postinstall`. This is by design — we do not want *any* automatic script execution on install.

### A2. Lockfile + exact pinning
- Commit `package-lock.json`; treat it as the source of truth.
- `.npmrc`: `save-exact=true` (no `^`/`~` ranges), `engine-strict=true`, plus the `before=<cutoff>` from A1.
- CI installs with `npm ci` (lockfile-exact), never `npm install`.
- Pin Node via `package.json` `engines` + `.nvmrc` to a version where `node:sqlite` is stable (see A3).

### A3. Disable install scripts
- `.npmrc`: `ignore-scripts=true`. This neutralizes the #1 worm *execution* vector (malicious `postinstall`).
- **Native-module tension:** packages needing a build step (e.g. `better-sqlite3`) won't build under this. → Prefer pure-JS / Node stdlib. This is a concrete reason to favor **`node:sqlite`** for storage. **Verified 2026-06-08:** `node:sqlite` runs **flag-free and without an `ExperimentalWarning`** on Node v26 (the operator's machine) — real SQL executed. So storage uses `node:sqlite`, avoiding a native build entirely under `ignore-scripts`. **Action:** pin the project to a Node version where this holds (≥ the release that stabilized `node:sqlite`); confirm the same on the chosen production LTS in #4. Any unavoidable native dep gets an explicit, reviewed, per-package build exception — documented, never blanket.

### A4. No `npx -y`
- Policy: never `npx -y <pkg>` (auto-downloads + runs unpinned code). Tools are pinned in `devDependencies` and run via `npm run`. Applies equally to MCP servers (see B2).

### A5. New-package adoption checklist (manual gate)
A reviewer completes `docs/security/package-adoption-checklist.md` before any new dependency is merged:
- [ ] Published > 7 days ago (gate will enforce, but check intent).
- [ ] npm **provenance / sigstore attestation** present? Source repo matches?
- [ ] Maintainer account age, 2FA, history; not a recent ownership transfer.
- [ ] Download volume + issue tracker indicate a real, maintained project.
- [ ] Transitive dependency count is justified (each transitive dep is also risk).
- [ ] No open security advisories (`npm audit`, GitHub advisories, OSV).
- [ ] Does it *need* install scripts? If yes, scrutinize heavily or reject.
- [ ] Could the Node stdlib do this instead? (Prefer stdlib.)

### A6. CI enforcement (Hetzner server-side — **NO GitHub Actions, ever**)
Third-party CI (GitHub Actions) is itself a supply-chain/trust surface, so we don't use it. **GitHub is a public code mirror only.** The gate runs on our own infrastructure:
- **Authoritative gate = a git `pre-receive` hook on the Hetzner box's bare deploy repo.** On every push it runs `scripts/ci-gate.sh` (`npm ci --ignore-scripts` → `audit:deps` → `scan:secrets` → `npm test`) and **rejects the push if any step fails**, so bad code never lands on the box.
- **`scripts/ci-gate.sh`** encapsulates the gate so the identical command runs locally, in the pre-receive hook, and during the #4 build.
- **Local defense-in-depth:** the `pre-push` hook runs the fast gates (secret scan + `audit:deps`) before a push leaves the dev machine.
- The pre-receive hook is installed on the box in **#4** (where the bare repo + box exist); #0 delivers the hook script + `ci-gate.sh`.

### A7. Dev-machine hygiene
- Secrets live in a git-ignored `.env` (local) and the Hetzner secret store (prod) — **never** in the repo. `.gitignore` + `CLAUDE.md` already enforce/announce this.
- **Pre-push secret scan:** a `pre-push` git hook runs a stdlib `scripts/scan-secrets.mjs` (regex for common key shapes: `sk-`, `gho_`, AWS, PEM headers, high-entropy strings) and blocks the push on a hit. Defense against accidental public-repo leakage.
- **No agent code runs locally.** All agent/`execute_code` execution is on Hetzner (the operator's "no local Docker" constraint doubles as a security boundary — the dev box never executes untrusted generated code).
- GitHub token scopes kept minimal; Hetzner SSH keys are per-machine and not shared.

---

## 3. Surface B — runtime sandbox (design now; implement in #4 / #3)

> These are *requirements + design*. The control-plane/infra to enforce them is built in #4 (deploy) and #3 (generation). Each item below names its implementation home.
>
> **Contingent on the drivability spike (vision spec, Milestone zero).** B1/B2 assume Hermes behaviors not yet verified — that `terminal.backend = docker` reliably isolates execution and that MCP auto-install can be disabled. If the spike disproves these, the runtime-isolation design here must be revisited (e.g. wrap Hermes in our own outer container rather than trusting its backend). Do not treat Surface B as settled until the spike passes.

### B1. Agent code-execution isolation — *(impl: #4 + #3)*
- Hermes config in the worker image **hard-sets `terminal.backend = docker`**; `local` is never permitted. A startup assertion refuses to run if the backend is `local`.
- The execution container per job:
  - **Ephemeral, one-per-job**, destroyed on completion.
  - **Non-root** user; **read-only root filesystem**; the only writable mount is the per-job workspace.
  - **No Docker socket mounted** (prevents container escape / docker-in-docker).
  - Dropped Linux capabilities; `--pids-limit`, CPU/memory limits; no privileged mode.
  - **Default-deny network** for the code-execution sub-sandbox specifically (generated SVG/JS build steps don't need the internet). Research/vision egress happens in the *orchestration* layer (Hermes Tool Gateway), not in the code sub-sandbox.
- **No platform secrets in the code sub-sandbox.** The worker holds model keys for orchestration, but the container that runs *generated* code receives **no** API keys, DB creds, or platform tokens.

### B2. MCP lockdown — *(impl: #3, where Hermes is configured)*
- `npx -y` MCP auto-install is **disabled**.
- Only an **allowlist** of pre-vetted, version-pinned, locally-installed MCP servers may load (each must have passed the A5 checklist). Allowlist documented in `docs/security/mcp-allowlist.md`.

### B3. Egress control — *(impl: #4)*
- Outbound from the Hetzner box restricted to a known allowlist: Nous Portal, OpenRouter, npm registry (build only), and approved paper/research sources.
- The code-execution sub-sandbox (B1) is **default-deny** egress regardless.

### B4. Published-asset isolation & CSP — *(impl: #1 publish path + #4)*
- Each presentation is served from its **own origin** (`<slug>.themultiverse.school`), giving browser origin-isolation between presentations and from the control-plane app origin.
- Published assets are **static**, carry **no credentials/cookies**, and ship a **strict CSP**: `default-src 'self'`, no third-party script/connect origins, restrictive `frame-ancestors`, no access to platform APIs. (Zoom/animation JS runs, but cannot exfiltrate or reach platform internals.)
- The control-plane API lives on a separate, authenticated origin; published assets can't reach it.

### B5. Runtime secrets — *(impl: #4)*
- Nous Portal / OpenRouter / SMTP keys live in the Hetzner secret store (or Docker secrets), injected as env at runtime — **not** baked into images, **not** in the repo.
- Documented **rotation runbook**; assume any key that ever touched the repo is burned and must be rotated.

---

## 4. Deliverables of #0 (build-now subset)

Files/artifacts this sub-project produces:
- `.npmrc` (`save-exact`, `engine-strict`, `ignore-scripts`, `before=<cutoff>`) + `.nvmrc` (pinned Node)
- `scripts/audit-deps.mjs` — the stdlib 7-day min-age + integrity hard gate
- `scripts/add-dep.sh` — `--before` resolution wrapper
- `scripts/scan-secrets.mjs` + `.githooks/pre-push` — secret pre-push scan
- `scripts/ci-gate.sh` + `deploy/git-hooks/pre-receive` — CI enforcement on Hetzner (server-side git hook; **no GitHub Actions**)
- `docs/security/package-adoption-checklist.md`
- `docs/security/mcp-allowlist.md` (stub; populated in #3)
- `docs/security/runtime-sandbox.md` — the §3 requirements, as the contract #4/#3 must satisfy

Surface-B items are **designed here** and **verified/implemented** in their named sub-projects; #0 owns the written requirements they must meet.

---

## 5. Testing & verification

- **`audit-deps.mjs`:** unit-test against fixture lockfiles — a too-fresh package must exit 1; an all-aged tree must exit 0; a missing-integrity entry must fail. Test offline using the `.cache/registry/` fixtures.
- **`scan-secrets.mjs`:** must catch seeded fake keys and not false-positive on the spec docs.
- **CI:** a deliberately-introduced fresh/range dep in a test branch must turn the build red.
- **Surface B:** verification deferred to #4/#3 (e.g., assert a job container has no Docker socket, no egress, no secrets) — listed as acceptance criteria there.

---

## 6. Open items

1. ~~`node:sqlite` confirmation~~ — **RESOLVED 2026-06-08:** flag-free, no `ExperimentalWarning`, real SQL ran on Node v26. Adopt `node:sqlite`; pin Node accordingly; re-confirm on the prod LTS in #4.
2. ~~`npm --before` transitive coverage~~ — **RESOLVED 2026-06-08:** empirically confirmed tree-wide. `npm install express --before=2015-01-01` selected `express@4.10.6` **and** all 35 transitive deps at 2014-era versions (`cookie@0.1.2`, `debug@2.1.1`, …). Layers 1/2 rely on this safely.
3. **Hetzner egress mechanism** — host firewall vs. container network policy vs. both — decided in #4.
4. **Secret store choice** — Docker secrets vs. a small self-hosted manager — decided in #4.
