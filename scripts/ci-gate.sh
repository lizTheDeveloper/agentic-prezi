#!/bin/sh
# Full supply-chain + test gate. Runs locally, in the Hetzner pre-receive hook, and during the #4 build.
set -e
# Guard: the gate's own config must not be silently weakened.
for key in save-exact=true ignore-scripts=true before=; do
  grep -q "^$key" .npmrc || { echo "✗ ci-gate: .npmrc missing required '$key'"; exit 1; }
done
npm ci --ignore-scripts
npm run audit:deps
npm run scan:secrets
npm test
echo "✓ ci-gate: all checks passed"
