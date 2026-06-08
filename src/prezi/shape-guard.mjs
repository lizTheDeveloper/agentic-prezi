// shape.svg trust boundary (spec §3 / §9 security). A `shape` block carries a raw SVG fragment that
// is emitted VERBATIM into presentation.svg. Today Compose's own templates produce these, but once
// the agentic Generate stage (§5 ⚠️) lands, shape SVG becomes UNTRUSTED model/agent output. The
// published origin's CSP (`default-src 'self'`, no inline script) is the outer wall; this is the
// inner one: a fail-closed allowlist so a shape can only ever be inert vector geometry — never a
// `<script>`, an event handler, a `<foreignObject>`, or an external/`javascript:` reference.
//
// Stdlib-only (no DOM parser, per #0). We do not try to *repair* hostile input — we VALIDATE it and
// reject on any doubt. Anything outside the allowlist makes the whole fragment unsafe.

// Inert, presentational SVG elements only. No <script>, <foreignObject>, <image>, <use>, <a>,
// <animate*>, <set>, <style>, <handler>, <iframe>, etc.
const ALLOWED_ELEMENTS = new Set([
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'g', 'defs', 'lineargradient', 'radialgradient', 'stop',
  'clippath', 'title', 'desc',
]);

// Geometry + presentation attributes only. No href/xlink:href (external refs), no `on*` handlers,
// no `style` (CSP blocks inline style anyway, but reject it here too).
const ALLOWED_ATTRS = new Set([
  'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'points', 'transform', 'gradienttransform', 'gradientunits',
  'offset', 'stop-color', 'stop-opacity', 'spreadmethod', 'fx', 'fy',
  'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'clip-path',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
  'opacity', 'id', 'class', 'transform-origin', 'paint-order', 'vector-effect',
]);

// Reject any value that could reach out of the document or execute: external/protocol URLs,
// javascript:, data:, CSS expression(), and url(...) that isn't a same-document `url(#id)` ref.
function valueIsSafe(value) {
  const v = String(value).toLowerCase();
  if (/javascript:|expression\s*\(|[a-z][a-z0-9+.-]*:\/\//.test(v)) return false; // protocol/scheme
  if (/data:/.test(v)) return false;
  // Allow only same-document fragment refs in url(): url(#foo). Any other url( target is rejected.
  const urlRefs = v.match(/url\(([^)]*)\)/g) || [];
  for (const ref of urlRefs) {
    const inner = ref.slice(4, -1).trim().replace(/^['"]|['"]$/g, '');
    if (!inner.startsWith('#')) return false;
  }
  return true;
}

const TAG_RE = /<\/?([a-zA-Z][\w:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)\/?>/g;
const ATTR_RE = /([a-zA-Z_:][\w:.-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g;

/**
 * Validate a shape SVG fragment against the allowlist. Fail-closed.
 * @returns {{ safe: boolean, reason?: string }}
 */
export function checkShapeSvg(svg) {
  if (typeof svg !== 'string' || !svg.trim()) return { safe: false, reason: 'empty' };
  // Comments / CDATA / DOCTYPE / processing instructions / entity decls are never legitimate here.
  if (/<!--|<!\[|<!|<\?/.test(svg)) return { safe: false, reason: 'comment/CDATA/declaration not allowed' };

  // Every `<` must begin a recognized tag. Strip recognized tags; if any `<` survives, it was a
  // malformed/disguised tag → reject (prevents `< script` and tokenizer-evasion tricks).
  let tagMatch;
  TAG_RE.lastIndex = 0;
  const seenTags = [];
  while ((tagMatch = TAG_RE.exec(svg)) !== null) {
    const name = tagMatch[1].toLowerCase();
    if (!ALLOWED_ELEMENTS.has(name)) return { safe: false, reason: `element <${name}> not allowed` };
    seenTags.push({ raw: tagMatch[0], attrs: tagMatch[2] || '' });

    let attrMatch;
    ATTR_RE.lastIndex = 0;
    while ((attrMatch = ATTR_RE.exec(tagMatch[2] || '')) !== null) {
      const attr = attrMatch[1].toLowerCase();
      const rawVal = attrMatch[2];
      const value = rawVal.replace(/^['"]|['"]$/g, '');
      if (attr.startsWith('on')) return { safe: false, reason: `event handler ${attr} not allowed` };
      if (attr === 'href' || attr.endsWith(':href')) return { safe: false, reason: 'href not allowed (external ref)' };
      if (!ALLOWED_ATTRS.has(attr)) return { safe: false, reason: `attribute ${attr} not allowed` };
      if (!valueIsSafe(value)) return { safe: false, reason: `unsafe value in ${attr}` };
    }
  }

  const withoutTags = svg.replace(TAG_RE, '');
  if (withoutTags.includes('<')) return { safe: false, reason: 'malformed or disguised tag' };

  return { safe: true };
}

/** Convenience boolean wrapper. */
export function isSafeShapeSvg(svg) {
  return checkShapeSvg(svg).safe;
}
