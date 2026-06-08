// COMPOSE stage (spec §6) + the deterministic reviser the refine loop uses by default.
//
// Compose turns the research §4 findings doc + the user's write-up into a validated scene-graph IR:
// it chooses narrative beats, maps each to a scene, decides nesting (figure/detail zooms INTO its
// finding — the Prezi signature), packs a non-overlapping layout via the deterministic helper, and
// orders the camera tour. Citations are threaded into the scenes that use them and into citations[].
//
// This is the engine-agnostic default (open item #1: "deterministic helper proposes, agent refines,
// vision loop polices"). An optional `llm` can later refine wording/intents; the structure, layout,
// and validation guarantees hold without one (§8-style insulation, mirroring #2).

import { layoutScenes } from './layout.mjs';
import { validateIr, IR_DEFAULTS } from './ir-schema.mjs';
import { LOOP_DEFAULTS } from './critique.mjs';

export const COMPOSE_DEFAULTS = {
  canvas: { width: 12000, height: 6750 }, // 16:9 authoring space
  maxStops: LOOP_DEFAULTS.maxStops, // §10 cost cap on stops/scenes
  headingMax: 120,
  bodyMax: 420,
};

function truncate(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}

/**
 * Compose a validated scene-graph IR from a research findings doc + write-up.
 * @param research  §4 findings doc { topic, narrative_outline, findings, citations, insufficient_sources? }
 * @param opts      { title?, writeup?, canvas?, maxStops?, caps? }
 * @returns { ir }  (throws if the deterministic build somehow fails validation — a build bug)
 */
export function compose(research, opts = {}) {
  const cfg = { ...COMPOSE_DEFAULTS, ...opts };
  const topic = research.topic || opts.title || 'Untitled';
  const title = opts.title || topic;
  const outline = Array.isArray(research.narrative_outline) ? research.narrative_outline : [];
  const citationsById = new Map((research.citations || []).map((c) => [c.id, c]));

  const findings = [...(research.findings || [])].sort((a, b) => (b.importance || 0) - (a.importance || 0));
  // Reserve intro + closing; cap the rest (§10).
  const maxFindings = Math.max(1, cfg.maxStops - 2);
  const used = findings.slice(0, maxFindings);

  const scenes = [];
  const roots = []; // layout tree
  const referenced = new Set();

  // 1. INTRO — the hook.
  const hook = truncate(outline[0] || `What does the latest research say about ${topic}?`, cfg.bodyMax);
  scenes.push({
    id: 'intro', parent: null,
    intent: 'Hook: state the question the research answers',
    blocks: [
      { type: 'heading', text: truncate(title, cfg.headingMax) },
      { type: 'body', text: hook },
    ],
  });
  const introNode = { id: 'intro', children: [] };
  roots.push(introNode);

  // 2. FINDINGS — one root scene each; figure/detail nests inside (zoom-into-detail).
  used.forEach((f, i) => {
    const sid = `f${i + 1}`;
    const cites = (f.citations || []).filter((id) => citationsById.has(id));
    const blocks = [
      { type: 'heading', text: truncate(f.claim, cfg.headingMax) },
      { type: 'body', text: truncate(f.detail || f.claim, cfg.bodyMax) },
    ];
    if (cites[0]) { blocks.push({ type: 'citation', refId: cites[0] }); referenced.add(cites[0]); }
    const scene = { id: sid, parent: null, intent: truncate(f.claim, cfg.headingMax), blocks, _finding: { citations: cites } };
    scenes.push(scene);
    const node = { id: sid, children: [] };

    // Nest a detail scene when there's a figure or a citation worth zooming to (the Prezi move).
    if (f.figure && (f.figure.caption || f.figure.data_or_quote)) {
      const did = `${sid}.detail`;
      const dblocks = [
        { type: 'heading', text: truncate(f.figure.caption || 'Detail', cfg.headingMax) },
        { type: 'body', text: truncate(f.figure.data_or_quote || f.detail, cfg.bodyMax) },
      ];
      if (cites[1] || cites[0]) { const rid = cites[1] || cites[0]; dblocks.push({ type: 'citation', refId: rid }); referenced.add(rid); }
      scenes.push({ id: did, parent: sid, intent: `Detail of: ${truncate(f.claim, 80)}`, blocks: dblocks, _finding: { citations: cites } });
      node.children.push({ id: did, children: [] });
    }
    roots.push(node);
  });

  // 3. CLOSING — implications.
  const implication = truncate(outline[outline.length - 1] || `Implications for ${topic}.`, cfg.bodyMax);
  scenes.push({
    id: 'closing', parent: null,
    intent: 'Implications / takeaway',
    blocks: [
      { type: 'heading', text: 'Implications' },
      { type: 'body', text: implication },
    ],
  });
  roots.push({ id: 'closing', children: [] });

  // 4. LAYOUT — deterministic non-overlapping packing within the canvas.
  const bboxes = layoutScenes(roots, cfg.canvas);
  for (const s of scenes) s.bbox = bboxes.get(s.id);

  // 5. TOUR — DFS: each root, then its nested detail; zoom into detail, pan between roots.
  const tour = [];
  const childrenOf = new Map();
  for (const s of scenes) if (s.parent) (childrenOf.get(s.parent) || childrenOf.set(s.parent, []).get(s.parent)).push(s.id);
  let first = true;
  for (const node of roots) {
    tour.push({ scene: node.id, transition: first ? 'zoom' : 'pan', holdMs: 0 });
    first = false;
    for (const childId of childrenOf.get(node.id) || []) tour.push({ scene: childId, transition: 'zoom', holdMs: 0 });
  }

  // 6. CITATIONS — only those actually referenced, in the §4 contract shape.
  const citations = (research.citations || [])
    .filter((c) => referenced.has(c.id))
    .map((c) => ({ id: c.id, title: c.title, authors: c.authors || [], year: c.year ?? null, venue: c.venue || '', doi: c.doi || '', url: c.url || '' }));

  const ir = { canvas: cfg.canvas, scenes, tour, citations };

  const { valid, errors } = validateIr(ir, { caps: cfg.caps || IR_DEFAULTS });
  if (!valid) throw new Error('compose produced invalid IR:\n  ' + errors.join('\n  '));
  return { ir };
}

/**
 * Deterministic reviser (default for refineLoop). Given the current IR + critiques, shrink/repair
 * the flagged scenes: shorten overflowing text, add a missing citation block, drop crowding blocks.
 * Returns a NEW IR, or the SAME reference when nothing could be changed (loop terminates on that).
 */
export function deterministicRevise(ir, critiques) {
  let changed = false;
  const scenes = ir.scenes.map((s) => ({ ...s, blocks: s.blocks.map((b) => ({ ...b })) }));
  const byId = new Map(scenes.map((s) => [s.id, s]));

  for (const c of critiques) {
    const scene = byId.get(c.stop);
    if (!scene) continue;
    for (const issue of c.issues) {
      if (issue.severity !== 'high') continue;
      if (issue.kind === 'clipping' || issue.kind === 'overflow') {
        // Halve the longest text block on this scene (down to a floor); drop extra citations.
        const texts = scene.blocks.filter((b) => b.type === 'body' || b.type === 'heading');
        const longest = texts.sort((a, b) => (b.text?.length || 0) - (a.text?.length || 0))[0];
        if (longest && longest.text && longest.text.length > 40) {
          longest.text = truncate(longest.text, Math.max(40, Math.floor(longest.text.length / 2)));
          changed = true;
        } else {
          // Can't shrink further: drop a trailing body/citation block to free vertical space.
          const idx = scene.blocks.map((b) => b.type).lastIndexOf('citation');
          const dropAt = idx >= 0 ? idx : scene.blocks.length - 1;
          if (scene.blocks.length > 1 && dropAt >= 1) { scene.blocks.splice(dropAt, 1); changed = true; }
        }
      } else if (issue.kind === 'citation-missing') {
        const want = scene._finding?.citations?.[0];
        if (want && !scene.blocks.some((b) => b.type === 'citation' && b.refId === want)) {
          scene.blocks.push({ type: 'citation', refId: want });
          changed = true;
        }
      } else if (issue.kind === 'crowding') {
        if (scene.blocks.length > 4) { scene.blocks.length = 4; changed = true; }
      }
    }
  }

  if (!changed) return ir;
  return { ...ir, scenes };
}
