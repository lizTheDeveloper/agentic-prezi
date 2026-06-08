import { readFileSync } from 'node:fs';

export const DEFAULT_PATTERNS = [
  { name: 'private-key',       re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'aws-access-key',    re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github-token',      re: /\bgh[opusr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'github-pat',        re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { name: 'openai-key-modern', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'openai-key',        re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'slack-token',       re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
];

export function scanText(text, patterns = DEFAULT_PATTERNS) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    for (const p of patterns) if (p.re.test(line)) hits.push({ pattern: p.name, line: i + 1 });
  });
  return hits;
}

// Scan the ADDED lines of a `git log -p` / `git diff` patch (lines starting with '+',
// excluding the '+++' file header). Catches secrets in committed history even if later redacted.
export function scanDiff(diffText, patterns = DEFAULT_PATTERNS) {
  const hits = [];
  for (const line of diffText.split('\n')) {
    if (line[0] !== '+' || line.startsWith('+++')) continue;
    for (const p of patterns) if (p.re.test(line.slice(1))) hits.push({ pattern: p.name });
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { execSync } = await import('node:child_process');
  const rangeIdx = process.argv.indexOf('--range');
  if (rangeIdx !== -1) {
    const range = process.argv[rangeIdx + 1];
    const diff = execSync(`git log ${range} -p --no-color -U0`, { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
    const hits = scanDiff(diff);
    if (hits.length) {
      const counts = {};
      for (const h of hits) counts[h.pattern] = (counts[h.pattern] || 0) + 1;
      console.error(`✗ ${hits.length} potential secret(s) in pushed history (${range}):`);
      for (const [pat, n] of Object.entries(counts)) console.error(`  - ${pat}: ${n}`);
      console.error('Push blocked. The secret is in committed history (not just the working tree) — remove it from history and rotate it.');
      process.exit(1);
    }
    console.log('✓ secret scan (history): clean');
  } else {
    const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
    let total = 0;
    for (const f of files) {
      let text;
      try { text = readFileSync(f, 'utf8'); } catch { continue; }
      for (const h of scanText(text)) { console.error(`${f}:${h.line}: possible ${h.pattern}`); total++; }
    }
    if (total) { console.error(`\n✗ ${total} potential secret(s) found. Push blocked.`); process.exit(1); }
    console.log('✓ secret scan: clean');
  }
}
