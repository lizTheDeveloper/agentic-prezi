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
