// Research pipeline orchestrator (spec §3):
//   SCOPE → DISCOVER → RANK/FILTER → (EXTRACT) → VERIFY ⚑ → SYNTHESIZE
// Emits the #3 §4 findings contract and validates it before returning. All stages
// are budget-bounded (§6) and dependency-injected (adapters / llm / resolver) so the
// whole thing unit-tests offline. The llm is REQUIRED — scope + synthesis have no
// fallback; an absent or failing provider throws rather than degrading.

import { resolveBudgets } from './budgets.mjs';
import { scope as scopeStage } from './scope.mjs';
import { discover } from './discover.mjs';
import { rankAndCap } from './rank.mjs';
import { prepareCitations, synthesizeFindings, toContractCitation } from './synthesize.mjs';
import { groundFindings } from './ground.mjs';
import { scanCandidates } from './scan.mjs';
import { validateFindingsDoc } from './schema.mjs';
import { isResolvable } from './http.mjs';
import openalex from './adapters/openalex.mjs';
import crossref from './adapters/crossref.mjs';
import arxiv from './adapters/arxiv.mjs';
import pubmed from './adapters/pubmed.mjs';

/** The insulated, key-free scholarly adapters (§2/§8). PubMed adds biomedical coverage. */
export const DEFAULT_ADAPTERS = [openalex, crossref, arxiv, pubmed];

/**
 * Run the research pipeline.
 *
 * @param writeup            user's write-up (untrusted data)
 * @param opts.adapters      SourceAdapter[]                       (default: scholarly trio)
 * @param opts.llm           LLM for scope/synthesis               (REQUIRED — throws if absent)
 * @param opts.resolver      async (citation)=>bool liveness check (default: isResolvable)
 * @param opts.budgets       budget overrides (§6)
 * @param opts.cache         adapter-cache options ({ enabled, now, ttlMs })
 * @param opts.nowYear       year for recency scoring (testability)
 * @param opts.scan          §7.1 injection scan: { scorer, threshold?, maxChars? }. Without a
 *                           scorer the active scan is skipped (layer-1 defenses stay in force).
 * @returns {{ doc, validation, trace }}  doc = §4 contract
 */
export async function runResearch(writeup, opts = {}) {
  const {
    adapters = DEFAULT_ADAPTERS,
    llm = null,
    resolver = (c) => isResolvable(c),
    cache = {},
    nowYear,
    scan = {},
  } = opts;
  if (!llm) throw new Error('runResearch: an llm is required (no deterministic fallback)');
  const budgets = resolveBudgets(opts.budgets);
  const trace = { stages: {} };
  const deadline = Date.now() + budgets.wallClockMs;
  const outOfTime = () => Date.now() > deadline;

  // SCOPE
  const scoped = await scopeStage(writeup, { llm, maxSubQueries: budgets.maxSubQueries });
  trace.stages.scope = { topic: scoped.topic, subQueries: scoped.sub_queries.length };

  // Assemble a partial, contract-valid doc when the wall-clock budget (§6) is blown.
  const timedOut = () => {
    trace.timedOut = true;
    return finalize(scoped, [], [], trace, budgets);
  };

  // DISCOVER
  const { candidates, errors } = await discover(scoped.sub_queries, adapters, {
    perQuery: budgets.perQuery,
    cache,
  });
  trace.stages.discover = { candidates: candidates.length, adapterErrors: errors };
  if (outOfTime()) return timedOut();

  // RANK / FILTER
  const ranked = rankAndCap(candidates, { topK: budgets.topK, nowYear });
  trace.stages.rank = { kept: ranked.length };

  // (EXTRACT) — scholarly abstracts already arrive structured from adapters; full-text
  // extraction via Hermes cloud browser is the §8 enrichment path, added when the
  // provider is decided. The abstracts on `ranked` are sufficient to synthesize + ground.

  // SCAN 🛡 (§7.1) — active prompt-injection classifier over every ingested free-text field, BEFORE
  // it can reach the synthesis LLM or be forwarded to #3. Skipped (layer-1 defenses only) when no
  // scorer is configured. Quarantined free text is blanked; structured metadata survives.
  let scanned = ranked;
  let quarantinedSources = 0;
  if (typeof scan.scorer === 'function') {
    const res = await scanCandidates(ranked, scan.scorer, {
      threshold: scan.threshold ?? budgets.injectionThreshold,
      maxChars: scan.maxChars,
    });
    scanned = res.candidates;
    quarantinedSources = res.quarantinedSources;
    trace.stages.scan = { enabled: true, scannedSources: res.scannedSources, quarantinedSources, quarantined: res.quarantined };
  } else {
    trace.stages.scan = { enabled: false };
  }

  // Prepare the citation table (stable ids) the synthesis model must cite from.
  const { citations: enrichedCitations } = prepareCitations(scanned);

  // SYNTHESIZE (model maps claims → candidate ids; never invents citations)
  const proposed = await synthesizeFindings({
    topic: scoped.topic,
    writeup,
    citations: enrichedCitations,
    llm,
  });
  trace.stages.synthesize = { proposedFindings: proposed.length };
  if (outOfTime()) return timedOut(); // VERIFY does live network checks — guard before it

  // VERIFY ⚑ — strict grounding: provenance → resolvability → grounding → cross-check
  const grounded = await groundFindings(proposed, enrichedCitations, resolver, {
    maxCrossChecks: budgets.maxCrossChecks,
  });
  trace.stages.verify = {
    keptFindings: grounded.findings.length,
    droppedFindings: grounded.dropped.findings.length,
    droppedCitations: grounded.dropped.citations.length,
    rejectedCitationIds: grounded.rejectedIds,
  };

  // ASSEMBLE + VALIDATE the §4 contract.
  return finalize(scoped, grounded.findings, grounded.citations, trace, budgets, quarantinedSources);
}

/** Build, sort, flag-if-insufficient, and validate the §4 contract doc. */
function finalize(scoped, keptFindings, keptCitations, trace, budgets, quarantinedSources = 0) {
  const insufficient = keptFindings.length < budgets.minGroundedFindings;
  const findings = [...keptFindings].sort((a, b) => b.importance - a.importance);
  const doc = {
    topic: scoped.topic,
    narrative_outline: scoped.narrative_outline,
    findings,
    citations: keptCitations.map(toContractCitation),
    ...(insufficient ? { insufficient_sources: true } : {}),
    ...(quarantinedSources > 0 ? { quarantined_sources: quarantinedSources } : {}),
  };
  const validation = validateFindingsDoc(doc);
  return { doc, validation, trace };
}
