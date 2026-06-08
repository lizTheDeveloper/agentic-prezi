// Pure camera math for the player runtime (spec §7 — "unit-testable pure functions for camera
// math"). NO DOM, NO imports: this file is shipped verbatim to the presentation origin as
// camera-math.js and imported by player.js (a same-origin ES-module import, CSP-clean under
// script-src 'self'). The same source is imported by the Node test suite, so what we test is
// exactly what ships.

/** Clamp `v` into [lo, hi]. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Ease in/out (cubic). Maps [0,1] → [0,1], monotonic, flat at both ends. */
export function easeInOutCubic(t) {
  t = clamp(t, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Interpolate two viewBoxes ({x,y,w,h}) at eased parameter `t` (0→a, 1→b). */
export function lerpViewBox(a, b, t, ease = easeInOutCubic) {
  const e = ease(t);
  return {
    x: lerp(a.x, b.x, e),
    y: lerp(a.y, b.y, e),
    w: lerp(a.w, b.w, e),
    h: lerp(a.h, b.h, e),
  };
}

/** SVG viewBox attribute string for a {x,y,w,h}. */
export function viewBoxToString(vb) {
  return `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
}

/**
 * Re-letterbox a stop's authored viewBox to the *actual* viewport aspect so nothing is cropped
 * on a viewport shaped differently than the authoring aspect (responsive, §7). Expands the
 * shorter dimension, keeping the centre fixed.
 */
export function fitToViewport(vb, viewportAspect) {
  const aspect = vb.w / vb.h;
  let { x, y, w, h } = vb;
  if (viewportAspect > aspect) {
    const nw = h * viewportAspect;
    x -= (nw - w) / 2;
    w = nw;
  } else if (viewportAspect < aspect) {
    const nh = w / viewportAspect;
    y -= (nh - h) / 2;
    h = nh;
  }
  return { x, y, w, h };
}

/** Next stop index (clamped — never wraps past the end). */
export function nextIndex(i, len) {
  return clamp(i + 1, 0, Math.max(0, len - 1));
}

/** Previous stop index (clamped at 0). */
export function prevIndex(i, len) {
  return clamp(i - 1, 0, Math.max(0, len - 1));
}

/**
 * Resolve a location hash (e.g. "#intro" or "intro") to a stop index, or -1 if not found.
 * Deep links target a stop by its `id` (§7).
 */
export function resolveStopIndex(stops, hash) {
  if (!hash) return -1;
  const id = decodeURIComponent(String(hash).replace(/^#/, ''));
  if (!id) return -1;
  return stops.findIndex((s) => s.id === id);
}

/**
 * Given a click in SVG user-space, return the index of the *deepest* (smallest-area) stop whose
 * scene bbox contains the point — i.e. click-to-zoom picks the most specific detail (§7).
 * `sceneBboxById` maps scene id → bbox. Returns -1 if none contain the point.
 */
export function stopAtPoint(stops, sceneBboxById, px, py) {
  let best = -1;
  let bestArea = Infinity;
  for (let i = 0; i < stops.length; i++) {
    const b = sceneBboxById[stops[i].scene];
    if (!b) continue;
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
      const area = b.w * b.h;
      if (area < bestArea) { bestArea = area; best = i; }
    }
  }
  return best;
}
