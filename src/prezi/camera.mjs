// Camera tour compiler (spec §5/§7). Turns the IR tour (ordered scene refs) into a concrete
// camera.json: each stop carries the exact target viewBox the player animates to, pre-computed
// server-side so the runtime only has to interpolate (the player stays tiny, §7).
//
// fitViewBox letterboxes a scene's bbox to the viewer's aspect ratio with padding, so a scene
// is always fully visible (never cropped) regardless of viewport shape — and so the sandbox
// screenshot (jumping instantly to this viewBox) frames exactly what a viewer sees (§5).

export const CAMERA_DEFAULTS = {
  aspect: 16 / 9, // target viewport aspect; player re-letterboxes if the real viewport differs
  padding: 0.08, // fraction of the bbox added as breathing room around a stop
};

/**
 * Fit `bbox` into a viewBox of the given aspect ratio (w/h), centred, with padding.
 * The result always *contains* the padded bbox (letterbox, never crop).
 */
export function fitViewBox(bbox, aspect = CAMERA_DEFAULTS.aspect, padding = CAMERA_DEFAULTS.padding) {
  const padW = bbox.w * padding;
  const padH = bbox.h * padding;
  const w0 = bbox.w + 2 * padW;
  const h0 = bbox.h + 2 * padH;
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;

  let w = w0;
  let h = h0;
  if (w0 / h0 < aspect) w = h0 * aspect; // too tall → widen
  else h = w0 / aspect; // too wide → heighten

  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Compile the IR tour into camera.json.
 * @param ir    validated scene-graph IR
 * @param opts  { aspect, padding }
 * @returns { viewport:{aspect}, stops:[ { id, scene, viewBox, transition, holdMs } ] }
 */
export function compileCamera(ir, opts = {}) {
  const aspect = opts.aspect ?? CAMERA_DEFAULTS.aspect;
  const padding = opts.padding ?? CAMERA_DEFAULTS.padding;
  const byId = new Map(ir.scenes.map((s) => [s.id, s]));

  // A scene can appear more than once in a tour (zoom in, then back out to it). Give each
  // stop a stable, unique id for deep-linking (#<stopId>): scene id, suffixed on repeat.
  const seen = new Map();
  const stops = ir.tour.map((stop) => {
    const scene = byId.get(stop.scene);
    const n = (seen.get(stop.scene) ?? 0) + 1;
    seen.set(stop.scene, n);
    const id = n === 1 ? stop.scene : `${stop.scene}~${n}`;
    return {
      id,
      scene: stop.scene,
      viewBox: round(fitViewBox(scene.bbox, aspect, padding)),
      transition: stop.transition ?? 'zoom',
      holdMs: stop.holdMs ?? 0,
    };
  });

  return { viewport: { aspect }, stops };
}

function round(vb) {
  return { x: Math.round(vb.x), y: Math.round(vb.y), w: Math.round(vb.w), h: Math.round(vb.h) };
}
