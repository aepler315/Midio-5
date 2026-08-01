// Movement VII (The Light): a grounding cue every airborne subject was
// missing. A soft ellipse on the ground plane, offset away from the light
// and fading/spreading as the subject rises -- cheap (one radial-gradient
// fill, no shadowBlur, no pixel readback) and driven entirely by LightField.
const OFFSET_GAIN = 1.6; // exaggerates the perspective offset so it reads at stage scale
const RADIUS_GROWTH = 0.006; // px of extra radius per px of height
const FADE_HEIGHT = 260; // height above ground at which the shadow has fully faded

/** Pure math: where the shadow sits and how it looks. No canvas calls, so this is directly testable. */
export function computeShadow({ x, groundY, heightAboveGround, width, light, opacity = 0.35 }) {
  const h = Math.max(0, heightAboveGround);
  const lightDy = light ? groundY - light.y : 0;
  const dx = light ? x - light.x : 0;
  const offsetX = lightDy > 0 ? (dx / lightDy) * h * OFFSET_GAIN : 0;

  const radiusX = Math.max(1, (width * 0.5) * (1 + h * RADIUS_GROWTH));
  const radiusY = radiusX * 0.32;

  // No light means "don't know how lit the scene is" -- default to no
  // shadow rather than assuming full sun, so an absent/perf-gated light
  // cleanly suppresses the shadow instead of drawing one at full strength.
  const intensity = light ? light.intensity : 0;
  const heightFalloff = Math.max(0, 1 - h / FADE_HEIGHT);
  const alpha = opacity * intensity * heightFalloff;

  return { x: x + offsetX, y: groundY, radiusX, radiusY, alpha };
}

/** Paints the shadow ellipse. No-op when alpha rounds to nothing (offscreen height, dark light, etc)
 *  or when the subject's own position isn't finite yet (e.g. a companion's first frame, before its
 *  own update() has run) -- createRadialGradient throws on non-finite coordinates where the rest of
 *  canvas 2D silently no-ops, so this guard is the difference between a skipped shadow and a dead loop. */
export function drawContactShadow(ctx, params) {
  const s = computeShadow(params);
  if (s.alpha <= 0.005 || s.radiusX < 0.5) return;
  if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.radiusX) || !Number.isFinite(s.radiusY)) return;

  ctx.save();
  const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.radiusX);
  grad.addColorStop(0, `rgba(0,0,0,${s.alpha})`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(s.x, s.y, s.radiusX, s.radiusY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
