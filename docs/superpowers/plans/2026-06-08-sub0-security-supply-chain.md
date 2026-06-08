# #0 Security & Supply-Chain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the install-time supply-chain controls (7-day minimum dependency release age, secret pre-push scan, hardened CI) plus the Surface-B runtime-sandbox requirement docs — the foundation every later sub-project installs on.

**Architecture:** All tooling is **stdlib-only** `.mjs` scripts (no npm dependencies), tested with the built-in `node:test` runner. Pure logic is exported and unit-tested offline; thin I/O wrappers (registry fetch, git) run only when a script is invoked directly. The dependency gate has three layers: `.npmrc before=` (every local install), `add-dep.sh` (intentional adds), and `audit-deps.mjs` (authoritative, in CI + pre-push).

**Tech Stack:** Node ≥26 (verified `node:sqlite` is flag-free here), ESM `.mjs`, `node:test`, `node:https`, `node:fs`, `node:child_process`, GitHub Actions. Zero runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-06-08-sub0-security-supply-chain-design.md`

---

## File structure (created by this plan)

| File | Responsibility |
|---|---|
| `package.json` | Project manifest: `engines.node`, `type:module`, scripts (`test`, `audit:deps`, `scan:secrets`). **No dependencies.** |
| `.nvmrc` | Pinned Node version. |
| `.npmrc` | `save-exact`, `engine-strict`, `ignore-scripts`, `before=<cutoff>`. |
| `scripts/audit-deps.mjs` | Min-age + integrity gate. Pure core (`parseLockfile`, `evaluate`) + registry fetch + CLI. |
| `scripts/audit-deps.test.mjs` | Unit tests for the gate's pure core (offline, injected time lookup). |
| `scripts/scan-secrets.mjs` | Secret scanner. Pure `scanText` + CLI that scans tracked files. |
| `scripts/scan-secrets.test.mjs` | Unit tests for `scanText` (fake keys built by concatenation so the source file holds no real-looking literal). |
| `scripts/add-dep.sh` | Wrapper: `npm install … --before=<now-7d>`. |
| `.githooks/pre-push` | Runs the secret scan; blocks push on a hit. |
| `.github/workflows/supply-chain.yml` | CI: SHA-pinned actions, least-priv, runs the gate + tests. |
| `docs/security/package-adoption-checklist.md` | Manual new-dependency review checklist. |
| `docs/security/mcp-allowlist.md` | Stub allowlist (populated in #3). |
| `docs/security/runtime-sandbox.md` | Surface-B requirements that #4/#3 must satisfy. |

---

## Task 1: Project skeleton + `.npmrc` gate config

**Files:**
- Create: `package.json`, `.nvmrc`, `.npmrc`
- Modify: `.gitignore` (add `.cache/`)

- [ ] **Step 1: Create `.nvmrc`**

```
26
```

- [ ] **Step 2: Create `.npmrc`**

```
save-exact=true
engine-strict=true
ignore-scripts=true
before=2026-06-01T00:00:00Z
```

- [ ] **Step 3: Create `package.json` (no dependencies)**

```json
{
  "name": "agentic-prezi",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=26" },
  "scripts": {
    "test": "node --test",
    "audit:deps": "node scripts/audit-deps.mjs",
    "scan:secrets": "node scripts/scan-secrets.mjs"
  }
}
```

- [ ] **Step 4: Add `.cache/` to `.gitignore`**

Append to `.gitignore` (the file already ignores `.env`, `node_modules`, etc.):

```
# audit registry cache
.cache/
# release image tarballs (used in #4)
releases/
```

- [ ] **Step 5: Generate the lockfile and verify clean install**

Run: `npm install`
Expected: creates `package-lock.json` with no dependencies, no scripts run (ignore-scripts), exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .nvmrc .npmrc .gitignore
git commit -m "chore: project skeleton + npm supply-chain gate config"
```

---

## Task 2: `audit-deps.mjs` — min-age + integrity gate (pure core, TDD)

**Files:**
- Create: `scripts/audit-deps.mjs`, `scripts/audit-deps.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/audit-deps.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLockfile, evaluate } from './audit-deps.mjs';

const NOW = Date.UTC(2026, 5, 8); // 2026-06-08
const day = (y, m, d) => Date.UTC(y, m, d);

test('parseLockfile extracts name/version/integrity, skips root', () => {
  const lock = { packages: {
    '': { name: 'root' },
    'node_modules/left-pad': { version: '1.3.0', integrity: 'sha512-aaa' },
    'node_modules/a/node_modules/b': { version: '2.0.0', integrity: 'sha512-bbb' },
  }};
  const pkgs = parseLockfile(lock);
  assert.deepEqual(pkgs, [
    { name: 'left-pad', version: '1.3.0', integrity: 'sha512-aaa' },
    { name: 'b', version: '2.0.0', integrity: 'sha512-bbb' },
  ]);
});

test('flags a package published less than 7 days ago', () => {
  const pkgs = [{ name: 'evil', version: '1.0.0', integrity: 'sha512-x' }];
  const times = () => day(2026, 5, 6); // 2 days old
  const v = evaluate(pkgs, times, { now: NOW, minAgeDays: 7 });
  assert.equal(v.length, 1);
  assert.equal(v[0].reason, 'too-fresh');
});

test('passes a package older than 7 days', () => {
  const pkgs = [{ name: 'fine', version: '1.0.0', integrity: 'sha512-x' }];
  const times = () => day(2026, 4, 1); // weeks old
  assert.deepEqual(evaluate(pkgs, times, { now: NOW, minAgeDays: 7 }), []);
});

test('flags a missing integrity hash', () => {
  const pkgs = [{ name: 'nohash', version: '1.0.0', integrity: null }];
  const v = evaluate(pkgs, () => day(2026, 1, 1), { now: NOW, minAgeDays: 7 });
  assert.equal(v[0].reason, 'missing-integrity');
});

test('flags when publish time is unknown', () => {
  const pkgs = [{ name: 'mystery', version: '9.9.9', integrity: 'sha512-x' }];
  const v = evaluate(pkgs, () => null, { now: NOW, minAgeDays: 7 });
  assert.equal(v[0].reason, 'no-publish-time');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/audit-deps.test.mjs`
Expected: FAIL — `Cannot find module './audit-deps.mjs'` / exports undefined.

- [ ] **Step 3: Implement the pure core**

Create `scripts/audit-deps.mjs`:

```js
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { get } from 'node:https';
import { join } from 'node:path';

const MIN_AGE_DAYS = 7;
const MS_PER_DAY = 86_400_000;
const CACHE_DIR = '.cache/registry';

// --- pure core (unit-tested) ---

export function parseLockfile(lockJson) {
  const out = [];
  const pkgs = lockJson.packages || {};
  for (const [path, meta] of Object.entries(pkgs)) {
    if (path === '') continue;        // root project
    if (!meta.version) continue;      // links / workspaces
    const name = path.split('node_modules/').pop();
    out.push({ name, version: meta.version, integrity: meta.integrity || null });
  }
  return out;
}

export function evaluate(packages, timeLookup, { now, minAgeDays = MIN_AGE_DAYS }) {
  const violations = [];
  for (const p of packages) {
    if (!p.integrity) { violations.push({ ...p, reason: 'missing-integrity' }); continue; }
    const publishedAt = timeLookup(p.name, p.version);
    if (publishedAt == null) { violations.push({ ...p, reason: 'no-publish-time' }); continue; }
    const ageDays = (now - publishedAt) / MS_PER_DAY;
    if (ageDays < minAgeDays) {
      violations.push({ ...p, publishedAt, ageDays, reason: 'too-fresh' });
    }
  }
  return violations;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/audit-deps.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/audit-deps.mjs scripts/audit-deps.test.mjs
git commit -m "feat: audit-deps pure core (min-age + integrity evaluation)"
```

---

## Task 3: `audit-deps.mjs` — registry fetch + CLI

**Files:**
- Modify: `scripts/audit-deps.mjs` (append fetch + CLI)

- [ ] **Step 1: Append the cached registry fetch + CLI to `scripts/audit-deps.mjs`**

```js
// --- registry I/O (not unit-tested; exercised via CLI) ---

function cachePath(name) {
  return join(CACHE_DIR, encodeURIComponent(name) + '.json');
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { 'user-agent': 'agentic-prezi-audit (lizthedeveloper)' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function registryTimes(name) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const cp = cachePath(name);
  if (existsSync(cp)) return JSON.parse(readFileSync(cp, 'utf8'));
  const data = await fetchJson(`https://registry.npmjs.org/${name}`);
  const times = data.time || {};
  writeFileSync(cp, JSON.stringify(times));
  return times;
}

async function main() {
  if (!existsSync('package-lock.json')) {
    console.error('No package-lock.json found.'); process.exit(1);
  }
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const pkgs = parseLockfile(lock);
  if (pkgs.length === 0) { console.log('audit-deps: no dependencies to check.'); return; }

  const timeCache = new Map();
  for (const p of pkgs) {
    if (!timeCache.has(p.name)) {
      try { timeCache.set(p.name, await registryTimes(p.name)); }
      catch (e) { timeCache.set(p.name, {}); console.error(`warn: ${p.name}: ${e.message}`); }
    }
  }
  const lookup = (name, version) => {
    const t = timeCache.get(name)?.[version];
    return t ? Date.parse(t) : null;
  };
  const violations = evaluate(pkgs, lookup, { now: Date.now(), minAgeDays: MIN_AGE_DAYS });
  if (violations.length) {
    console.error(`\n✗ audit-deps: ${violations.length} violation(s):`);
    for (const v of violations) {
      const extra = v.reason === 'too-fresh' ? ` published ${v.ageDays.toFixed(1)}d ago` : '';
      console.error(`  - ${v.name}@${v.version}: ${v.reason}${extra}`);
    }
    process.exit(1);
  }
  console.log(`✓ audit-deps: ${pkgs.length} package(s) OK (min age ${MIN_AGE_DAYS}d).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 2: Verify the existing unit tests still pass**

Run: `node --test scripts/audit-deps.test.mjs`
Expected: PASS (5 tests) — appending the CLI didn't change the pure core.

- [ ] **Step 3: Run the gate against the (empty) lockfile**

Run: `npm run audit:deps`
Expected: `audit-deps: no dependencies to check.` exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/audit-deps.mjs
git commit -m "feat: audit-deps registry fetch + CLI gate"
```

---

## Task 4: `scan-secrets.mjs` — secret pre-push scanner (TDD)

**Files:**
- Create: `scripts/scan-secrets.mjs`, `scripts/scan-secrets.test.mjs`, `.githooks/pre-push`

- [ ] **Step 1: Write the failing test**

Create `scripts/scan-secrets.test.mjs` (fake keys built by concatenation so this file itself holds no matching literal — avoids self-flagging by the pre-push hook):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from './scan-secrets.mjs';

test('detects an AWS access key id', () => {
  const sample = 'const k = "' + 'AKIA' + 'ABCDEFGHIJKLMNOP' + '";';
  const hits = scanText(sample);
  assert.equal(hits.some(h => h.pattern === 'aws-access-key'), true);
});

test('detects a github token', () => {
  const sample = 'token=' + 'ghp_' + 'a'.repeat(36);
  assert.equal(scanText(sample).some(h => h.pattern === 'github-token'), true);
});

test('detects a private key header', () => {
  const sample = '-----BEGIN ' + 'PRIVATE KEY-----';
  assert.equal(scanText(sample).some(h => h.pattern === 'private-key'), true);
});

test('does not flag ordinary prose', () => {
  const sample = 'This spec describes the supply-chain gate and the 7-day rule.';
  assert.deepEqual(scanText(sample), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/scan-secrets.test.mjs`
Expected: FAIL — `Cannot find module './scan-secrets.mjs'`.

- [ ] **Step 3: Implement `scripts/scan-secrets.mjs`**

```js
import { readFileSync } from 'node:fs';

export const DEFAULT_PATTERNS = [
  { name: 'private-key',     re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'aws-access-key',  re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github-token',    re: /\bgh[opusr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'openai-key',      re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'slack-token',     re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
];

export function scanText(text, patterns = DEFAULT_PATTERNS) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    for (const p of patterns) if (p.re.test(line)) hits.push({ pattern: p.name, line: i + 1 });
  });
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { execSync } = await import('node:child_process');
  const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
  let total = 0;
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; } // skip binary/unreadable
    for (const h of scanText(text)) { console.error(`${f}:${h.line}: possible ${h.pattern}`); total++; }
  }
  if (total) { console.error(`\n✗ ${total} potential secret(s) found. Push blocked.`); process.exit(1); }
  console.log('✓ secret scan: clean');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/scan-secrets.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Create the pre-push hook**

Create `.githooks/pre-push`:

```sh
#!/bin/sh
exec node scripts/scan-secrets.mjs
```

- [ ] **Step 6: Make it executable and enable the hooks path**

```bash
chmod +x .githooks/pre-push
git config core.hooksPath .githooks
```

- [ ] **Step 7: Verify the scanner runs clean on the repo**

Run: `npm run scan:secrets`
Expected: `✓ secret scan: clean` exit 0.

- [ ] **Step 8: Commit**

```bash
git add scripts/scan-secrets.mjs scripts/scan-secrets.test.mjs .githooks/pre-push
git commit -m "feat: secret scanner + pre-push hook"
```

> Note: `core.hooksPath` is local git config, not committed. The CI workflow (Task 6) also runs the scan so enforcement doesn't rely on every clone enabling the hook. Document the `git config core.hooksPath .githooks` step in the README during #1.

---

## Task 5: `add-dep.sh` — 7-day `--before` install wrapper

**Files:**
- Create: `scripts/add-dep.sh`

- [ ] **Step 1: Create `scripts/add-dep.sh`**

```sh
#!/bin/sh
# Add an npm dependency enforcing a 7-day minimum release age.
# Usage: scripts/add-dep.sh <package>[@version] [extra npm flags]
if [ "$#" -eq 0 ]; then
  echo "usage: scripts/add-dep.sh <package>[@version] [npm install flags]" >&2
  exit 1
fi
CUTOFF="$(node -e 'console.log(new Date(Date.now()-7*864e5).toISOString())')"
echo "Installing with --before=$CUTOFF (7-day minimum release age)"
exec npm install "$@" --before="$CUTOFF"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/add-dep.sh
```

- [ ] **Step 3: Verify the usage guard**

Run: `scripts/add-dep.sh`
Expected: prints the usage line, exit 1.

- [ ] **Step 4: Commit**

```bash
git add scripts/add-dep.sh
git commit -m "feat: add-dep.sh 7-day min-age install wrapper"
```

---

## Task 6: CI workflow — SHA-pinned, least-privilege

**Files:**
- Create: `.github/workflows/supply-chain.yml`

- [ ] **Step 1: Resolve exact commit SHAs for the actions (do not pin by tag)**

Run these and copy the SHAs into the workflow below (replace the two `REPLACE_WITH_SHA` tokens):

```bash
gh api repos/actions/checkout/git/ref/tags/v4.2.2 --jq .object.sha
gh api repos/actions/setup-node/git/ref/tags/v4.1.0 --jq .object.sha
```

- [ ] **Step 2: Create `.github/workflows/supply-chain.yml`**

```yaml
name: supply-chain
on:
  push: { branches: [main] }
  pull_request:
permissions:
  contents: read
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@REPLACE_WITH_SHA       # actions/checkout v4.2.2
      - uses: actions/setup-node@REPLACE_WITH_SHA     # actions/setup-node v4.1.0
        with:
          node-version-file: .nvmrc
      - name: Install (no scripts, lockfile-exact)
        run: npm ci --ignore-scripts
      - name: Dependency min-age + integrity gate
        run: npm run audit:deps
      - name: Secret scan
        run: npm run scan:secrets
      - name: Unit tests
        run: npm test
      - name: Advisory audit (non-fatal)
        run: npm audit --audit-level=high || true
```

> `npm ci` requires a lockfile; Task 1 created one. With zero deps it is a no-op install, which is fine — the job still exercises the gate, scanner, and tests.

- [ ] **Step 3: Commit and push; confirm the workflow goes green**

```bash
git add .github/workflows/supply-chain.yml
git commit -m "ci: supply-chain gate (SHA-pinned, least-privilege)"
git push
```

Then: `gh run watch` (or check the Actions tab). Expected: the `gate` job passes.

- [ ] **Step 4: Verify the gate actually blocks a too-fresh dep (manual, on a throwaway branch)**

```bash
git checkout -b test/fresh-dep
node -e "const fs=require('node:fs');const l=JSON.parse(fs.readFileSync('package-lock.json'));l.packages['node_modules/__fake__']={version:'9.9.9',integrity:'sha512-x'};fs.writeFileSync('package-lock.json',JSON.stringify(l,null,2));"
npm run audit:deps    # expect: violation 'no-publish-time' (fake pkg) -> exit 1
git checkout main && git branch -D test/fresh-dep && git checkout -- package-lock.json
```

Expected: the gate exits non-zero on the injected package. (Confirms the red-build behavior from the spec's testing section.)

---

## Task 7: Verify `npm --before` covers the transitive tree (spec open item #2)

**Files:** none (verification + note)

- [ ] **Step 1: Empirically confirm tree-wide `--before` behavior**

In a scratch dir (not the repo):

```bash
mkdir /tmp/before-check && cd /tmp/before-check && npm init -y >/dev/null
npm install express --before=2015-01-01T00:00:00Z
node -e "const l=require('./package-lock.json'); const v=Object.entries(l.packages).filter(([p])=>p).map(([p,m])=>p.split('node_modules/').pop()+'@'+m.version); console.log(v.join('\n'))"
```

Expected: express **and its transitive deps** resolve to old (pre-2015) versions — confirming `--before` filters the whole tree, not just the named package. Record the result.

- [ ] **Step 2: If confirmed, note it in the spec's open items as resolved**

Edit `docs/superpowers/specs/2026-06-08-sub0-security-supply-chain-design.md` open item #2 to mark it verified with the date. Commit:

```bash
git add docs/superpowers/specs/2026-06-08-sub0-security-supply-chain-design.md
git commit -m "docs: confirm npm --before is tree-wide (resolves #0 open item)"
```

---

## Task 8: Security documentation deliverables

**Files:**
- Create: `docs/security/package-adoption-checklist.md`, `docs/security/mcp-allowlist.md`, `docs/security/runtime-sandbox.md`

- [ ] **Step 1: Create `docs/security/package-adoption-checklist.md`**

```markdown
# New Dependency Adoption Checklist

Complete this before merging ANY new npm dependency (direct or transitive change).

- [ ] Published > 7 days ago (the gate enforces this; confirm intent).
- [ ] npm provenance / sigstore attestation present; source repo matches the package.
- [ ] Maintainer account age, 2FA, and history look legitimate; not a recent ownership transfer.
- [ ] Real download volume + a maintained issue tracker.
- [ ] Transitive dependency count is justified (each transitive dep is also risk).
- [ ] No open security advisories (`npm audit`, GitHub advisories, OSV).
- [ ] Does it require install scripts? If yes, scrutinize heavily or reject (we run `ignore-scripts`).
- [ ] Could the Node stdlib do this instead? Prefer stdlib.

Add the package with `scripts/add-dep.sh <pkg>` so the 7-day cutoff is applied at resolution.
```

- [ ] **Step 2: Create `docs/security/mcp-allowlist.md`**

```markdown
# MCP Server Allowlist (stub — populated in #3)

Only pre-vetted, version-pinned, locally-installed MCP servers may load.
`npx -y` auto-install of MCP servers is **disabled**.

| Server | Version (pinned) | Why needed | Vetted (date) |
|---|---|---|---|
| _(none yet)_ | | | |

Each entry must have passed `docs/security/package-adoption-checklist.md`.
```

- [ ] **Step 3: Create `docs/security/runtime-sandbox.md`**

```markdown
# Runtime Sandbox Requirements (Surface B)

Designed in spec #0 §3; **implemented in #4** (deploy) and **#3** (generation).
These are the acceptance criteria the runtime must satisfy.

- Agent-generated code / Hermes `execute_code` runs ONLY in the per-job sandbox
  (`terminal.backend=docker`, never `local`), under stronger kernel isolation (gVisor).
- The sandbox: ephemeral (one per job), non-root, read-only root FS, only the per-job
  workspace is writable, all caps dropped, CPU/mem/pids limits.
- NO Docker socket in the sandbox; the worker launches sandboxes via the narrow
  sandbox-broker API only.
- NO egress from the code sandbox (default-deny network).
- NO platform secrets/keys injected into the code sandbox.
- MCP `npx -y` disabled; only the pinned allowlist (`mcp-allowlist.md`) loads.
- Published presentation assets served from a per-presentation origin, no cookies,
  strict CSP (`default-src 'self'`, `font-src 'self'`).

Verification of these lives in #4 (`scripts/spike.sh` acceptance checks).
```

- [ ] **Step 4: Commit**

```bash
git add docs/security/
git commit -m "docs: package-adoption checklist, MCP allowlist stub, runtime-sandbox requirements"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full local gate run**

```bash
npm ci --ignore-scripts && npm run audit:deps && npm run scan:secrets && npm test
```

Expected: install clean, gate OK (no deps), scan clean, all unit tests pass.

- [ ] **Step 2: Confirm CI is green on `main`**

Run: `gh run list --workflow=supply-chain --limit 1`
Expected: latest run `completed / success`.

- [ ] **Step 3: Push**

```bash
git push
```

---

## Self-review (completed by plan author)

- **Spec coverage:** A1 `.npmrc before` (Task 1) + `add-dep.sh` (Task 5) + `audit-deps.mjs` (Tasks 2-3); A2 lockfile/pins/engines (Task 1); A3 `ignore-scripts` (Task 1); A4 no-`npx -y` (checklist Task 8); A5 adoption checklist (Task 8); A6 CI SHA-pinned least-priv (Task 6); A7 secret pre-push scan (Task 4); open item #2 `--before` transitive check (Task 7); Surface-B requirement docs (Task 8). ✓
- **Placeholders:** the only intentional fill-ins are the two action SHAs, with exact `gh` commands to resolve them (Task 6 Step 1) — actionable, not vague.
- **Type consistency:** `parseLockfile`/`evaluate`/`scanText` signatures match across implementation, tests, and CLI. `evaluate` reasons (`too-fresh`/`missing-integrity`/`no-publish-time`) are consistent in tests and CLI output.
```
