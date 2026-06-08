// SVG compiler (spec §5 Generate, deterministic driver). Compiles a validated scene-graph IR into
// one `presentation.svg` coordinate space: scenes are <g> groups (nested for zoom-into-detail),
// text is laid out with the SAME metrics the geometric critique uses, so overflow it would flag is
// overflow we actually produced.
//
// CSP NOTE (critical): the published origin sends `style-src 'self'` — which BLOCKS inline <style>
// elements and style="" attributes. So ALL styling here uses SVG *presentation attributes*
// (fill, font-size, font-family, text-anchor, …), never CSS. @font-face, when a font is embedded,
// lives in the external styles.css (font-src 'self'), NOT here.

import { escapeXml, wrapToWidth, linesThatFit, insetBbox, LINE_HEIGHT } from './util.mjs';
import { isSafeShapeSvg } from './shape-guard.mjs';

// Cross-platform fallback stacks. Embedded self-hosted fonts (§7.1), when configured via
// compileSvg(ir,{fonts}), override these family names so the SVG references the embedded faces that
// styles.css declares with @font-face — guaranteeing sandbox↔viewer metric fidelity. Absent that,
// these resolve per-platform (and the vision-loop fidelity guarantee is conditional, §7.1).
const HEADING_FAMILY = "Georgia, 'Times New Roman', serif";
const BODY_FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const THEME = {
  canvasBg: '#05060d',
  panelFill: '#0e1530',
  panelStroke: '#2b3a72',
  heading: '#e8ecff',
  body: '#c2cbe8',
  citation: '#8a96c8',
  rule: '#3a4a8c',
};

function fontSizesFor(inner) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  return {
    heading: Math.round(clamp(inner.h * 0.1, 28, 160)),
    body: Math.round(clamp(inner.h * 0.045, 16, 64)),
    citation: Math.round(clamp(inner.h * 0.03, 12, 40)),
  };
}

// Lay out one scene's blocks top-to-bottom within its inner box. Returns the emitted SVG plus a
// layout report (per-block fit, overflow) the critique consumes.
function layoutScene(scene, opts) {
  const margin = opts.margin ?? 80;
  const headingFamily = opts.headingFamily ?? HEADING_FAMILY;
  const bodyFamily = opts.bodyFamily ?? BODY_FAMILY;
  const inner = insetBbox(scene.bbox, margin);
  const sizes = fontSizesFor(inner);
  const items = [];
  const svgParts = [];
  let cursorY = inner.y; // top of the next block

  const advance = (lines, fontSize) => { cursorY += lines * fontSize * LINE_HEIGHT; };

  for (const block of scene.blocks) {
    if (block.type === 'heading' || block.type === 'body') {
      const fontSize = block.type === 'heading' ? sizes.heading : sizes.body;
      const color = block.type === 'heading' ? THEME.heading : THEME.body;
      const weight = block.type === 'heading' ? 700 : 400;
      const family = block.type === 'heading' ? headingFamily : bodyFamily;
      const lines = wrapToWidth(block.text, inner.w, fontSize);
      const availFromHere = inner.y + inner.h - cursorY;
      const fit = linesThatFit(availFromHere, fontSize);
      const overflow = lines.length > fit;
      const baseY = cursorY + fontSize; // first baseline
      const tspans = lines
        .map((ln, i) => `<tspan x="${r(inner.x)}" y="${r(baseY + i * fontSize * LINE_HEIGHT)}">${escapeXml(ln)}</tspan>`)
        .join('');
      svgParts.push(
        `<text font-family="${family}" font-size="${fontSize}" font-weight="${weight}" ` +
          `fill="${color}" xml:space="preserve">${tspans}</text>`,
      );
      if (block.type === 'heading') {
        const ry = r(baseY + lines.length * fontSize * LINE_HEIGHT * 0.5);
        svgParts.push(`<line x1="${r(inner.x)}" y1="${ry}" x2="${r(inner.x + inner.w)}" y2="${ry}" stroke="${THEME.rule}" stroke-width="${Math.max(2, Math.round(fontSize * 0.05))}"/>`);
        advance(lines.length + 0.6, fontSize);
      } else {
        advance(lines.length + 0.4, fontSize);
      }
      items.push({ kind: block.type, fontSize, lines: lines.length, fit, overflow });
    } else if (block.type === 'citation') {
      const ref = opts.citationsById.get(block.refId);
      const label = ref
        ? `${citeAuthors(ref)}${ref.year != null ? ` (${ref.year})` : ''}. ${ref.title}`
        : block.refId;
      const fontSize = sizes.citation;
      const lines = wrapToWidth(label, inner.w, fontSize);
      const availFromHere = inner.y + inner.h - cursorY;
      const fit = linesThatFit(availFromHere, fontSize);
      const overflow = lines.length > fit;
      const baseY = cursorY + fontSize;
      const tspans = lines
        .map((ln, i) => `<tspan x="${r(inner.x)}" y="${r(baseY + i * fontSize * LINE_HEIGHT)}">${escapeXml(ln)}</tspan>`)
        .join('');
      // Link to the source when a safe http(s) URL exists (selectable, live citation links §7.1).
      const href = ref && /^https?:\/\//i.test(ref.url || '') ? ref.url : null;
      const textEl = `<text font-family="${bodyFamily}" font-size="${fontSize}" font-style="italic" fill="${THEME.citation}" xml:space="preserve">${tspans}</text>`;
      svgParts.push(href ? `<a href="${escapeXml(href)}" target="_blank" rel="noopener noreferrer">${textEl}</a>` : textEl);
      advance(lines.length + 0.3, fontSize);
      items.push({ kind: 'citation', refId: block.refId, fontSize, lines: lines.length, fit, overflow });
    } else if (block.type === 'shape') {
      // Trust boundary (§3/§9), defense-in-depth: validateIr already rejects unsafe shapes, but the
      // compiler emits this fragment verbatim, so re-check the allowlist here and DROP on any doubt
      // rather than ever writing un-vetted markup into presentation.svg.
      if (isSafeShapeSvg(block.svg)) {
        svgParts.push(block.svg);
        items.push({ kind: 'shape' });
      } else {
        items.push({ kind: 'shape', dropped: true });
      }
    } else if (block.type === 'image') {
      const w = inner.w;
      const h = inner.h - (cursorY - inner.y);
      svgParts.push(
        `<image href="assets/${escapeXml(block.assetId)}" x="${r(inner.x)}" y="${r(cursorY)}" ` +
          `width="${r(w)}" height="${r(Math.max(1, h))}" preserveAspectRatio="xMidYMid meet">` +
          `<title>${escapeXml(block.alt)}</title></image>`,
      );
      advance(2, sizes.body);
      items.push({ kind: 'image', assetId: block.assetId });
    }
  }

  const overflow = items.some((it) => it.overflow);
  return { svgParts, report: { id: scene.id, intent: scene.intent, bbox: scene.bbox, sizes, items, overflow } };
}

function citeAuthors(ref) {
  const a = Array.isArray(ref.authors) ? ref.authors : [];
  if (a.length === 0) return 'Anon.';
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} & ${a[1]}`;
  return `${a[0]} et al.`;
}

const r = (n) => Math.round(n);

/**
 * Compile IR → { svg, layout }.
 * layout = { scenes: SceneReport[], byId: Map } — fed to the critique without re-deriving metrics.
 */
export function compileSvg(ir, opts = {}) {
  const citationsById = new Map((ir.citations || []).map((c) => [c.id, c]));
  const margin = opts.margin ?? 80;
  // Embedded-font family overrides (§7.1): opts.fonts = { headingFamily, bodyFamily }.
  const headingFamily = opts.fonts?.headingFamily;
  const bodyFamily = opts.fonts?.bodyFamily;
  const { width, height } = ir.canvas;

  // Paint parents before children so nested detail layers on top (depth order = ancestor count).
  const byId = new Map(ir.scenes.map((s) => [s.id, s]));
  const depthOf = (s) => { let d = 0, cur = s; while (cur && cur.parent) { d++; cur = byId.get(cur.parent); } return d; };
  const ordered = [...ir.scenes].sort((a, b) => depthOf(a) - depthOf(b));

  const reports = [];
  const groups = [];
  for (const scene of ordered) {
    const { svgParts, report } = layoutScene(scene, { margin, citationsById, headingFamily, bodyFamily });
    reports.push(report);
    const b = scene.bbox;
    const tint = Math.min(0.9, 0.5 + depthOf(scene) * 0.12);
    groups.push(
      `<g data-scene="${escapeXml(scene.id)}" data-bbox="${r(b.x)},${r(b.y)},${r(b.w)},${r(b.h)}" ` +
        `role="group" aria-label="${escapeXml(scene.intent)}">` +
        `<rect x="${r(b.x)}" y="${r(b.y)}" width="${r(b.w)}" height="${r(b.h)}" rx="${Math.round(Math.min(b.w, b.h) * 0.03)}" ` +
        `fill="${THEME.panelFill}" fill-opacity="${tint.toFixed(2)}" stroke="${THEME.panelStroke}" stroke-width="3"/>` +
        svgParts.join('') +
        `</g>`,
    );
  }

  const title = ir.scenes[0]?.blocks?.find((bl) => bl.type === 'heading')?.text || 'Presentation';
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
    `preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeXml(title)}">\n` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${THEME.canvasBg}"/>\n` +
    groups.join('\n') +
    `\n</svg>\n`;

  return { svg, layout: { scenes: reports, byId: new Map(reports.map((x) => [x.id, x])) } };
}
