// Research pipeline orchestrator (spec §3):
//   SCOPE → DISCOVER → RANK/FILTER → (EXTRACT) → VERIFY ⚑ → SYNTHESIZE
// Emits the #3 §4 findings contract and validates it before returning. All stages
// are budget-bounded (§6) and dependency-injected (adapters / llm / resolver) so the
// whole thing runs and unit-tests offline (§8 insulation from the undecided LLM).

import { resolveBudgets } from './budgets.mjs';
import { scope as scopeStage } from './scope.mjs';
import { discover } from './discover.mjs';
import { rankAndCap } from './rank.mjs';
import { prepareCitations, synthesizeFindings, toContractCitation } from './synthesize.mjs';
import { groundFindings } from './ground.mjs';
import { validateFindingsDoc } from './schema.mjs';
import { isResolvable } from './http.mjs';
import openalex from './adapters/openalex.mjs';
import crossref from './adapters/crossref.mjs';
import arxiv from './adapters/arxiv.mjs';

/** The insulated, key-free scholarly adapters (§2/§8). */
export const DEFAULT_ADAPTERS = [openalex, crossref, arxiv];

/**
 * Run the research pipeline.
 *
 * @param writeup            user's write-up (untrusted data)
 * @param opts.adapters      SourceAdapter[]                       (default: scholarly trio)
 * @param opts.llm           LLM for scope/synthesis               (default: deterministic fallback)
 * @param opts.resolver      async (citation)=>bool liveness check (default: isResolvable)
 * @param opts.budgets       budget overrides (§6)
 * @param opts.cache         adapter-cache options ({ enabled, now, ttlMs })
 * @param opts.nowYear       year for recency scoring (testability)
 * @returns {{ doc, validation, trace }}  doc = §4 contract
 */
export async function runResearch(writeup, opts = {}) {
  const {
    adapters = DEFAULT_ADAPTERS,
    llm = null,
    resolver = (c) => isResolvable(c),
    cache = {},
    nowYear,
  } = opts;
  const budgets = resolveBudgets(opts.budgets);
  const trace = { stages: {} };

  // SCOPE
  const scoped = await scopeStage(writeup, { llm, maxSubQueries: budgets.maxSubQueries });
  trace.stages.scope = { topic: scoped.topic, subQueries: scoped.sub_queries.length };

  // DISCOVER
  const { candidates, errors } = await discover(scoped.sub_queries, adapters, {
    perQuery: budgets.perQuery,
    cache,
  });
  trace.stages.discover = { candidates: candidates.length, adapterErrors: errors };

  // RANK / FILTER
  const ranked = rankAndCap(candidates, { topK: budgets.topK, nowYear });
  trace.stages.rank = { kept: ranked.length };

  // (EXTRACT) — scholarly abstracts already arrive structured from adapters; full-text
  // extraction via Hermes cloud browser is the §8 enrichment path, added when the
  // provider is decided. The abstracts on `ranked` are sufficient to synthesize + ground.

  // Prepare the citation table (stable ids) the synthesis model must cite from.
  const { citations: enrichedCitations } = prepareCitations(ranked);

  // SYNTHESIZE (model maps claims → candidate ids; never invents citations)
  const proposed = await synthesizeFindings({
    topic: scoped.topic,
    writeup,
    citations: enrichedCitations,
    llm,
  });
  trace.stages.synthesize = { proposedFindings: proposed.length };

  // VERIFY ⚑ — strict grounding: provenance → resolvability → grounding → cross-check
  const grounded = await groundFindings(proposed, enrichedCitations, resolver, {});
  trace.stages.verify = {
    keptFindings: grounded.findings.length,
    droppedFindings: grounded.dropped.findings.length,
    droppedCitations: grounded.dropped.citations.length,
    rejectedCitationIds: grounded.rejectedIds,
  };

  // ASSEMBLE the §4 contract.
  const insufficient = grounded.findings.length < budgets.minGroundedFindings;
  const findings = [...grounded.findings].sort((a, b) => b.importance - a.importance);
  const doc = {
    topic: scoped.topic,
    narrative_outline: scoped.narrative_outline,
    findings,
    citations: grounded.citations.map(toContractCitation),
    ...(insufficient ? { insufficient_sources: true } : {}),
  };

  // VALIDATE against the contract before handing to #3.
  const validation = validateFindingsDoc(doc);
  return { doc, validation, trace };
}
