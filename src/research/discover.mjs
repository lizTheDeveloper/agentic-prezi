// DISCOVER stage (spec §3): fan sub-queries out across every adapter, collect the
// candidate set, and dedup by canonical key. Source-agnostic — adding/removing a
// source is one entry in the `adapters` array (spec §2).

import { withCache } from './cache.mjs';
import { dedupCandidates } from './citations.mjs';

/**
 * Fan-out discovery.
 * @param subQueries string[]
 * @param adapters   SourceAdapter[]  ({ name, search })
 * @param opts.perQuery   candidates per adapter per sub-query
 * @param opts.cache      pass-through cache options ({ enabled, now, ttlMs })
 * @returns {{ candidates, errors }}  deduped candidates + per-adapter errors (non-fatal)
 */
export async function discover(subQueries, adapters, { perQuery = 10, cache = {} } = {}) {
  const tasks = [];
  for (const q of subQueries) {
    for (const adapter of adapters) {
      tasks.push(
        withCache(adapter.name, q, () => adapter.search(q, { perQuery }), cache)
          .then((candidates) => ({ ok: true, candidates }))
          .catch((err) => ({ ok: false, adapter: adapter.name, query: q, error: err.message })),
      );
    }
  }
  const settled = await Promise.all(tasks);

  const collected = [];
  const errors = [];
  for (const r of settled) {
    if (r.ok) collected.push(...r.candidates);
    else errors.push({ adapter: r.adapter, query: r.query, error: r.error });
  }

  // A source surfacing the same work for two sub-queries must not inflate
  // cross-check independence — dedup merges by canonical key and unions sources.
  return { candidates: dedupCandidates(collected), errors };
}
