// Presentation player runtime (spec §7) — minimal, zero-dependency, CSP-safe vanilla JS.
// Shipped to the presentation origin as player.js (a <script type="module">). It reads the
// inline camera data + inline SVG already in the page (NO fetch — the published CSP is
// connect-src 'none'), then drives the camera by animating the SVG viewBox between stops.
//
// All non-trivial math lives in camera-math.js (imported same-origin, CSP-clean, unit-tested);
// this file is the imperative DOM glue. The generator rewrites the import specifier below from
// './camera-math.mjs' to './camera-math.js' when it emits the artifact.

import {
  lerpViewBox,
  viewBoxToString,
  fitToViewport,
  nextIndex,
  prevIndex,
  resolveStopIndex,
  stopAtPoint,
} from './camera-math.mjs';

(function start() {
  function init() {
    const dataEl = document.getElementById('camera-data');
    const svg = document.querySelector('main.stage svg');
    if (!dataEl || !svg) return;

    let camera;
    try { camera = JSON.parse(dataEl.textContent); } catch { return; }
    const stops = Array.isArray(camera.stops) ? camera.stops : [];
    if (!stops.length) return;

    // scene id → bbox, read off the <g data-bbox> the SVG compiler emits (for click-to-zoom).
    const sceneBboxById = {};
    svg.querySelectorAll('g[data-scene][data-bbox]').forEach((g) => {
      const p = g.getAttribute('data-bbox').split(',').map(Number);
      if (p.length === 4 && p.every((n) => Number.isFinite(n))) {
        sceneBboxById[g.getAttribute('data-scene')] = { x: p[0], y: p[1], w: p[2], h: p[3] };
      }
    });

    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const progress = document.getElementById('progress');
    let index = 0;
    let raf = 0;

    function viewportAspect() {
      const r = svg.getBoundingClientRect();
      return r.height > 0 ? r.width / r.height : camera.viewport.aspect;
    }

    function targetFor(i) {
      return fitToViewport(stops[i].viewBox, viewportAspect());
    }

    function applyViewBox(vb) { svg.setAttribute('viewBox', viewBoxToString(vb)); }

    function updateHud() {
      if (progress) progress.textContent = `${index + 1} / ${stops.length}`;
      svg.setAttribute('aria-label', `Stop ${index + 1} of ${stops.length}: ${stops[index].scene}`);
    }

    function animateTo(i, { instant } = {}) {
      if (raf) cancelAnimationFrame(raf);
      const from = currentViewBox();
      const to = targetFor(i);
      index = i;
      updateHud();
      if (instant || reduceMotion) { applyViewBox(to); return; } // §7 reduced-motion: instant cut
      const durationMs = 650;
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / durationMs);
        applyViewBox(lerpViewBox(from, to, t));
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }

    function currentViewBox() {
      const p = (svg.getAttribute('viewBox') || '0 0 100 100').split(/\s+/).map(Number);
      return { x: p[0], y: p[1], w: p[2], h: p[3] };
    }

    function go(i, opts) { animateTo(Math.max(0, Math.min(stops.length - 1, i)), opts); }
    function goNext() { go(nextIndex(index, stops.length)); }
    function goPrev() { go(prevIndex(index, stops.length)); }

    // Keyboard navigation (§7).
    window.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': case ' ': case 'Spacebar': e.preventDefault(); goNext(); break;
        case 'ArrowLeft': case 'PageUp': e.preventDefault(); goPrev(); break;
        case 'Home': e.preventDefault(); go(0); break;
        case 'End': e.preventDefault(); go(stops.length - 1); break;
        case 'Escape': e.preventDefault(); goPrev(); break; // zoom back out
      }
    });

    // Click a scene to zoom into its most specific detail (§7).
    svg.addEventListener('click', (e) => {
      const pt = svg.createSVGPoint ? svg.createSVGPoint() : null;
      if (!pt) return;
      pt.x = e.clientX; pt.y = e.clientY;
      const ctm = svg.getScreenCTM && svg.getScreenCTM();
      if (!ctm) return;
      const loc = pt.matrixTransform(ctm.inverse());
      const i = stopAtPoint(stops, sceneBboxById, loc.x, loc.y);
      if (i >= 0) go(i);
    });

    // Wheel / swipe → next/prev (debounced).
    let wheelLock = 0;
    window.addEventListener('wheel', (e) => {
      const now = Date.now();
      if (now - wheelLock < 450) return;
      if (Math.abs(e.deltaY) < 8) return;
      wheelLock = now;
      e.deltaY > 0 ? goNext() : goPrev();
    }, { passive: true });

    let touchY = null;
    window.addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
    window.addEventListener('touchend', (e) => {
      if (touchY == null) return;
      const dy = (e.changedTouches[0].clientY) - touchY;
      if (Math.abs(dy) > 40) (dy < 0 ? goNext() : goPrev());
      touchY = null;
    }, { passive: true });

    // Deep links: #<stopId> jumps to that stop; respond to manual hash edits too.
    window.addEventListener('hashchange', () => {
      const i = resolveStopIndex(stops, location.hash);
      if (i >= 0) go(i, { instant: true });
    });
    // Keep the camera correct on resize (re-letterbox without animating).
    window.addEventListener('resize', () => applyViewBox(targetFor(index)));

    // Initial stop: deep link if present, else the first stop.
    const deep = resolveStopIndex(stops, location.hash);
    go(deep >= 0 ? deep : 0, { instant: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
