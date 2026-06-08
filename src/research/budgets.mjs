// Budgets & caps (spec §6). Research is multiplicative (sub-queries × adapters ×
// candidates × verification), so every stage is bounded. Open item §10.2 — these
// defaults are the planning starting point; all are overridable per-run.

export const DEFAULT_BUDGETS = Object.freeze({
  maxSubQueries: 6,        // SCOPE: cap distinct sub-queries
  perQuery: 10,            // DISCOVER: candidates pulled per adapter per sub-query
  topK: 20,                // RANK/FILTER: candidates kept after scoring
  maxExtractions: 12,      // EXTRACT: full-text extractions (cost guard)
  maxCrossChecks: 30,      // VERIFY: resolvability checks performed
  minGroundedFindings: 3,  // §6 graceful-insufficiency floor
  wallClockMs: 120_000,    // overall wall-clock ceiling
  tokenBudget: 60_000,     // LLM token ceiling (advisory; enforced by caller)
});

/** Merge user overrides onto the defaults, ignoring unknown keys. */
export function resolveBudgets(overrides = {}) {
  const out = { ...DEFAULT_BUDGETS };
  for (const k of Object.keys(DEFAULT_BUDGETS)) {
    if (overrides[k] != null) out[k] = overrides[k];
  }
  return out;
}
