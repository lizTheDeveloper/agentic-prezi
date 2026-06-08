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
