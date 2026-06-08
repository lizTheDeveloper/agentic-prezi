// Shared, dependency-free helpers for the #3 presentation generator.
// Text escaping + the deterministic text-metrics used by both the SVG compiler and the
// geometric (browser-free) critique, so "will it overflow?" is decided by the SAME math
// that lays the text out. Metrics are intentionally slightly pessimistic: better to flag a
// near-miss than to let the vision loop approve a layout a viewer sees clipped (§7.1).

/** XML/SVG-escape untrusted text before embedding it in generated markup. */
export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Average glyph advance as a fraction of font-size for a proportional sans/serif face.
// Deliberately conservative (real averages sit nearer 0.5) so wrapping/overflow err safe.
export const AVG_ADVANCE = 0.6;
// Line box as a multiple of font-size.
export const LINE_HEIGHT = 1.3;

/** Estimated rendered width (px) of a single line at a given font-size. */
export function estimateWidth(text, fontSize) {
  return text.length * fontSize * AVG_ADVANCE;
}

/** Max characters that fit in `widthPx` at `fontSize` (at least 1). */
export function charsPerLine(widthPx, fontSize) {
  return Math.max(1, Math.floor(widthPx / (fontSize * AVG_ADVANCE)));
}

/**
 * Greedy word-wrap to a pixel width. Splits on whitespace, hard-breaks any single word
 * longer than the line. Preserves blank lines between paragraphs.
 * @returns {string[]} wrapped lines
 */
export function wrapToWidth(text, widthPx, fontSize) {
  const max = charsPerLine(widthPx, fontSize);
  const out = [];
  for (const para of String(text).split(/\n/)) {
    if (para.trim() === '') { out.push(''); continue; }
    let line = '';
    for (let word of para.split(/\s+/)) {
      // Hard-break a word that can never fit a line on its own.
      while (word.length > max) {
        if (line) { out.push(line); line = ''; }
        out.push(word.slice(0, max));
        word = word.slice(max);
      }
      if (line === '') line = word;
      else if (line.length + 1 + word.length <= max) line += ' ' + word;
      else { out.push(line); line = word; }
    }
    if (line) out.push(line);
  }
  return out;
}

/** Lines that fit in `heightPx` at `fontSize` (line box = LINE_HEIGHT * fontSize). */
export function linesThatFit(heightPx, fontSize) {
  return Math.max(0, Math.floor(heightPx / (fontSize * LINE_HEIGHT)));
}

/** Inset a bbox by a uniform margin, never collapsing below 1×1. */
export function insetBbox(bbox, margin) {
  const w = Math.max(1, bbox.w - 2 * margin);
  const h = Math.max(1, bbox.h - 2 * margin);
  return { x: bbox.x + margin, y: bbox.y + margin, w, h };
}

/** True if `inner` is fully contained within `outer` (closed bounds). */
export function rectContains(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** True if rectangles `a` and `b` overlap with positive area (edge-touching is allowed). */
export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Round a bbox's numbers to integers (stable, compact artifacts). */
export function roundBbox(b) {
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
}
