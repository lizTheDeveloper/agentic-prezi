// VERIFY stage ⚑ (spec §4): strict grounding & citation integrity — the core
// credibility mechanism. Pure logic; the network "is this DOI/URL live?" check is
// injected as `resolver` so the rules unit-test offline.
//
// Invariants enforced here:
//   1. Provenance — a finding may only cite ids present in the candidate set.
//   2. Resolvability — every citation's DOI/URL must live-resolve, else it is dropped.
//   3. Grounding — a finding must retain ≥1 resolvable citation, else it is dropped.
//   4. Adversarial cross-check — a high-importance claim backed by <2 independent
//      sources is downgraded (asserted less strongly), never published as authoritative.

export const DEFAULT_GROUNDING = {
  minSourcesForHighImportance: 2, // §4 adversarial cross-check threshold
  highImportanceThreshold: 4,     // importance ≥ this is "high" and must cross-check
};

/**
 * Provenance filter (⚑ invariant 1). Drop any citation id a finding claims that is
 * NOT in `candidateIds`. A finding left with zero ids is returned with empty citations
 * (the caller's grounding step then drops it).
 * @returns {{ findings, rejectedIds:string[] }}
 */
export function enforceProvenance(findings, candidateIds) {
  const idSet = candidateIds instanceof Set ? candidateIds : new Set(candidateIds);
  const rejectedIds = [];
  const cleaned = findings.map((f) => {
    const kept = [];
    for (const id of f.citations ?? []) {
      if (idSet.has(id)) kept.push(id);
      else rejectedIds.push(id);
    }
    return { ...f, citations: kept };
  });
  return { findings: cleaned, rejectedIds: [...new Set(rejectedIds)] };
}

/**
 * Resolvability filter (⚑ invariant 2). For each citation, call `resolver(citation)`
 * (async → boolean). Drop citations that don't resolve.
 * @returns {{ resolved: citation[], dropped: citation[] }}
 */
export async function filterResolvable(citations, resolver) {
  const resolved = [];
  const dropped = [];
  await Promise.all(citations.map(async (c) => {
    let ok = false;
    try { ok = await resolver(c); } catch { ok = false; }
    (ok ? resolved : dropped).push(c);
  }));
  // Preserve input order for determinism.
  const order = new Map(citations.map((c, i) => [c.id, i]));
  resolved.sort((a, b) => order.get(a.id) - order.get(b.id));
  dropped.sort((a, b) => order.get(a.id) - order.get(b.id));
  return { resolved, dropped };
}

/**
 * Count independent sources backing a finding, via its citations' `sources` arrays.
 * Used for the adversarial cross-check.
 *
 * Known limitation: sources are treated as fully independent, but OpenAlex ingests
 * Crossref metadata, so an OpenAlex+Crossref pair shares an upstream and isn't truly
 * two independent confirmations. Genuine independence comes from a *different citation*
 * (distinct DOI) corroborating the claim. Refine when source-lineage weighting lands.
 */
export function independentSourceCount(finding, citationsById) {
  const sources = new Set();
  for (const id of finding.citations ?? []) {
    const c = citationsById.get(id);
    if (!c) continue;
    const ss = c.sources ?? (c.source ? [c.source] : []);
    if (ss.length) ss.forEach((s) => sources.add(s));
    else sources.add(id); // distinct citation with no source label still counts as one
  }
  return sources.size;
}

/**
 * Full grounding pass (⚑). Runs provenance → resolvability → grounding → cross-check.
 *
 * @param findings  model-proposed findings (citations are candidate ids)
 * @param citations contract-shaped citations carrying `sources` for cross-check
 * @param resolver  async (citation) => boolean liveness check
 * @returns {{ findings, citations, dropped: {findings, citations}, rejectedIds }}
 */
export async function groundFindings(findings, citations, resolver, opts = {}) {
  const { minSourcesForHighImportance, highImportanceThreshold, maxCrossChecks = Infinity } = { ...DEFAULT_GROUNDING, ...opts };

  // 1. Provenance.
  const declaredIds = new Set(citations.map((c) => c.id));
  const { findings: provFindings, rejectedIds } = enforceProvenance(findings, declaredIds);

  // 2. Resolvability — only check citations actually referenced by surviving findings,
  // capped to `maxCrossChecks` (§6 budget). `citations` arrives in ranked order, so the
  // cap keeps the top-ranked referenced citations; the rest go unchecked (→ unresolved).
  const referenced = new Set();
  for (const f of provFindings) for (const id of f.citations) referenced.add(id);
  const referencedCitations = citations.filter((c) => referenced.has(c.id)).slice(0, maxCrossChecks);
  const { resolved, dropped: droppedCitations } = await filterResolvable(referencedCitations, resolver);
  const resolvedIds = new Set(resolved.map((c) => c.id));
  const citationsById = new Map(resolved.map((c) => [c.id, c]));

  // 3 + 4. Grounding + adversarial cross-check.
  const keptFindings = [];
  const droppedFindings = [];
  for (const f of provFindings) {
    const liveCites = f.citations.filter((id) => resolvedIds.has(id));
    if (liveCites.length === 0) {
      droppedFindings.push({ ...f, reason: 'no-resolvable-citation' });
      continue;
    }
    let importance = f.importance;
    const cross = independentSourceCount({ ...f, citations: liveCites }, citationsById);
    if (importance >= highImportanceThreshold && cross < minSourcesForHighImportance) {
      // Downgrade: assert less strongly rather than dropping a single-source claim.
      importance = highImportanceThreshold - 1;
    }
    keptFindings.push({ ...f, citations: liveCites, importance });
  }

  // Only emit citations that survive AND are still referenced by a kept finding.
  const stillReferenced = new Set();
  for (const f of keptFindings) for (const id of f.citations) stillReferenced.add(id);
  const finalCitations = resolved.filter((c) => stillReferenced.has(c.id));

  return {
    findings: keptFindings,
    citations: finalCitations,
    dropped: { findings: droppedFindings, citations: droppedCitations },
    rejectedIds,
  };
}
