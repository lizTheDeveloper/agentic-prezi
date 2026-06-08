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
