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
