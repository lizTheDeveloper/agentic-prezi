#!/bin/sh
# Full supply-chain + test gate. Runs locally, in the Hetzner pre-receive hook, and during the #4 build.
set -e
npm ci --ignore-scripts
npm run audit:deps
npm run scan:secrets
npm test
echo "✓ ci-gate: all checks passed"
