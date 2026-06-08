// Deterministic layout helper (spec §6, open item #1: "deterministic helper proposes, agent
// refines, vision loop polices"). Given a scene tree it assigns non-overlapping bboxes — children
// packed strictly inside their parent's inner area, with reserved margins so text never sits at a
// bbox edge (pre-empting the clipping the vision loop would otherwise have to fix, §6).
//
// Input tree node: { id, children:[node], weight? }   (weight biases cell size; default 1)
// Output: Map<id, bbox>   bbox = { x, y, w, h }   (all within the canvas)

import { insetBbox, roundBbox } from './util.mjs';

export const LAYOUT_DEFAULTS = {
  margin: 80, // reserved inner margin at every nesting level (canvas units)
  gap: 60, // gap between sibling cells
  childInset: 0.62, // children occupy this fraction of the parent's inner area (leaves a frame)
};

// Choose a near-square grid (cols×rows) that holds `n` cells, slightly favouring width
// (landscape canvases / viewports read better wide).
function gridFor(n) {
  if (n <= 1) return { cols: 1, rows: 1 };
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

// Pack `nodes` into `region`, recursing into each node's children within its own cell.
function packInto(nodes, region, out, opts) {
  const { margin, gap, childInset } = opts;
  const inner = insetBbox(region, margin);
  const { cols, rows } = gridFor(nodes.length);
  const cellW = (inner.w - gap * (cols - 1)) / cols;
  const cellH = (inner.h - gap * (rows - 1)) / rows;

  nodes.forEach((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cell = {
      x: inner.x + col * (cellW + gap),
      y: inner.y + row * (cellH + gap),
      w: cellW,
      h: cellH,
    };
    out.set(node.id, roundBbox(cell));
    if (node.children && node.children.length) {
      // Children live in a centred, inset sub-region so the parent keeps a visible frame
      // around them — the zoom-into-detail affordance.
      const cw = cell.w * childInset;
      const ch = cell.h * childInset;
      const childRegion = {
        x: cell.x + (cell.w - cw) / 2,
        y: cell.y + (cell.h - ch) / 2,
        w: cw,
        h: ch,
      };
      packInto(node.children, childRegion, out, opts);
    }
  });
}

/**
 * Assign bboxes for a scene forest within a canvas.
 * @param roots  top-level nodes (each may have nested children)
 * @param canvas { width, height }
 * @param opts   LAYOUT_DEFAULTS overrides
 * @returns Map<id, bbox>
 */
export function layoutScenes(roots, canvas, opts = {}) {
  const merged = { ...LAYOUT_DEFAULTS, ...opts };
  const out = new Map();
  packInto(roots, { x: 0, y: 0, w: canvas.width, h: canvas.height }, out, merged);
  return out;
}
