import { cameraBasis } from '../terrain/SceneTravel.js';
/** One frame's Range-specific upper-sky ownership. Keep faint star depth
 * behind the live ridge while reserving its body for incidental figures. */
export function createRangeSkyComposition(spaceRidge, canvas, { voyageActive = false, performance = false } = {}) {
  const corridorAt = spaceRidge.corridor(canvas);
  const allowPoint = (x, y) => {
    const { top, bottom } = corridorAt(x);
    return y < top || y > bottom;
  };
  const starBrightnessAt = (x, y) => {
    const { top, bottom } = corridorAt(x);
    const feather = Math.max(1, canvas.height * 0.025);
    const distance = Math.max(top - y, y - bottom, 0);
    const u = Math.min(1, distance / feather);
    // The passive stage keeps a dense night sky behind the aurora. Its
    // translucent curtain still dims stars, without erasing their cores.
    const floor = performance ? 0.55 : 0.12;
    return floor + (1 - floor) * u * u * (3 - 2 * u);
  };
  return {
    allowPoint,
    starBrightnessAt,
    decorativeAlpha: 0.18,
    showWeaver: !voyageActive,
    weaverOptions: { maxFigures: 1, maxRetained: 0, allowPoint },
    celestialShafts: false,
    biomeRays: false,
  };
}

export function rangeMoonRadius(canvasHeight, scale) {
  return Math.min(Math.max(14, canvasHeight * 0.0361) * scale, canvasHeight * 0.07);
}

// ---------------------------------------------------------------------------
// Range v2 sky hierarchy (Task 13). The reference moon is a secondary object
// about 3.5% of the frame width across, textured and partly crossed by cloud;
// the sky holds sparse, low-contrast cloud banks, mostly below the aurora's
// resting hem. The banks never read the aurora's live (musical) outline: a
// cloud that came and went with every flash read as a lump that twitched on
// the beat and then froze.

/** Moon radius under Range v2: ~3.5% of the frame width across. */
export function rangeV2MoonRadius(canvasWidth, approachScale = 1) {
  return canvasWidth * 0.0175 * Math.min(1.25, Math.max(0.85, approachScale));
}

const hash = (i, salt) => {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** Lunar maria: a few soft darker basins, fixed on the face (clipped to it). */
export function drawMoonMaria(ctx, cx, cy, R, alpha = 1) {
  const basins = [[-0.28, -0.22, 0.34], [0.12, -0.3, 0.22], [-0.05, 0.1, 0.28], [0.3, 0.18, 0.16], [-0.35, 0.28, 0.14]];
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  for (const [dx, dy, r] of basins) {
    const g = ctx.createRadialGradient(cx + dx * R, cy + dy * R, 0, cx + dx * R, cy + dy * R, r * R);
    g.addColorStop(0, `rgba(96,104,122,${(0.28 * alpha).toFixed(3)})`);
    g.addColorStop(1, 'rgba(96,104,122,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  }
  ctx.restore();
}

/** Cloud drift, as a fraction of the frame width per second of heard time:
 *  one wind for the whole sky, so the banks move together, slowly, the same
 *  way (about seven minutes to cross the frame). */
export const CLOUD_DRIFT_W_PER_SEC = 0.0025;

/** Vertical band of the calm sky's banks (fractions of the frame height):
 *  under the aurora's resting hem, over and behind the peaks. */
export const CLOUD_BAND = Object.freeze([0.15, 0.33]);
/** Puffs per bank: enough for an irregular outline, few enough to stay cheap
 *  (two gradients each, seven banks). */
export const CLOUD_PUFFS = 11;

/** A bank's shape in its own units (x along its width 0..1, y and r in
 *  multiples of its height, y up negative): domed puffs on a flat base,
 *  largest in the middle and tapering at both ends, plus a faint veil that
 *  ties them into one layer. Pure in (i, seed). */
export function cloudShape(i, seed, puffs = CLOUD_PUFFS) {
  const shape = [];
  for (let k = 0; k < puffs; k++) {
    const u = Math.min(0.97, Math.max(0.03, (k + 0.5 + (hash(i * 31 + k, seed + 11) - 0.5) * 0.7) / puffs));
    const envelope = Math.pow(Math.sin(Math.PI * u), 0.7);
    const r = (0.45 + 0.55 * hash(i * 31 + k, seed + 12)) * (0.35 + 0.65 * envelope);
    // Sitting on the base: the centre rises by about half the puff, with a
    // little scatter, so the top billows and the underside stays level.
    const y = -r * 0.5 + (hash(i * 31 + k, seed + 13) - 0.5) * 0.18;
    shape.push({ u, y, r });
  }
  return shape;
}

/**
 * Deterministic cloud banks for a frame: sparse, elongated, drifting slowly
 * in heard time (pure: pause holds, seek reconstructs). Every bank moves
 * with the one wind (nearer, lower banks a little faster), and `panPx` /
 * `panYPx` carry them with the camera's turn and tilt, so they hang in the sky over the
 * land instead of sliding across the screen on their own. Nothing musical
 * moves or reshapes them.
 */
export function rangeCloudBanks({ width, height, tSec = 0, seed = 0, panPx = 0, panYPx = 0, count = 7 }) {
  const banks = [];
  const span = width * 1.6;
  for (let i = 0; i < count; i++) {
    const y01 = hash(i, seed + 3);
    const speed = width * CLOUD_DRIFT_W_PER_SEC * (0.85 + 0.3 * y01);
    const raw = hash(i, seed + 2) * span + tSec * speed + panPx;
    const x = ((raw % span) + span) % span - width * 0.3;
    const y = height * (CLOUD_BAND[0] + (CLOUD_BAND[1] - CLOUD_BAND[0]) * y01) + panYPx;
    const w = width * (0.12 + 0.16 * hash(i, seed + 4));
    banks.push({ id: `bank${i}`, x, y, w, h: w * (0.1 + 0.06 * hash(i, seed + 5)), alpha: 0.24 + 0.12 * hash(i, seed + 6),
      puffs: CLOUD_PUFFS, shape: cloudShape(i, seed) });
  }
  return banks;
}

/** How far the sky has turned for a camera pose, as tangents (independent
 *  of any lens): where the direction `refForward` (the unmoved rail's view
 *  direction) lies right of (x) and above (y) the pose's view axis. Divide
 *  by the rendered tan(fovY/2) (times the aspect, for x) to get NDC. */
export function skyTurn(pose, refForward) {
  if (!pose || !refForward) return { x: 0, y: 0 };
  const { forward, right, up } = cameraBasis(pose);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const depth = dot(refForward, forward);
  if (!(depth > 1e-6)) return { x: 0, y: 0 };
  return { x: dot(refForward, right) / depth, y: dot(refForward, up) / depth };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** A calm cloud's colours from the sky around it ({r,g,b} top and mid
 *  stops) and the scenic light's colour: the shade is that sky, a little
 *  greyer and lifted toward white (more under a brighter sky), so a bank is
 *  never a dark hole in a lit sky; the lit layer is the light, whitened. */
export function cloudColours(top, mid, halo) {
  const sky = [0, 1, 2].map((i) => {
    const k = ['r', 'g', 'b'][i];
    return (top?.[k] ?? 0) * 0.4 + (mid?.[k] ?? 0) * 0.6;
  });
  const lum = 0.2126 * sky[0] + 0.7152 * sky[1] + 0.0722 * sky[2];
  const lift = 0.12 + 0.45 * clamp(lum / 255, 0, 1);
  const shade = sky.map((v) => {
    const grey = v + (lum - v) * 0.3;
    return Math.round(grey + (255 - grey) * lift);
  });
  const h = [halo?.r ?? 255, halo?.g ?? 255, halo?.b ?? 255];
  const lit = h.map((v) => Math.round(v + (255 - v) * 0.35));
  return { shade, lit };
}
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, a).toFixed(3)})`;

/**
 * Paint cloud banks: each puff a soft body in the cloud's shade colour, and
 * a lit layer offset toward the light, strongest on the puffs that face it.
 * The light's side is continuous in its position (no flip as it crosses a
 * bank), and nothing here depends on the music.
 *   shade, lit    rgb arrays (the caller derives them from the sky and light)
 *   light         {x, y} in canvas pixels, or null (lit from above)
 *   fadeTop       [y0, y1]: banks fade out above y1 to nothing at y0 (static)
 * `dark` is accepted for `shade` (older callers).
 */
export function drawRangeClouds(ctx, banks, { shade = null, dark = [52, 60, 78], lit = [196, 176, 168], light = null,
  alpha = 1, directGain = 1, fadeTop = null } = {}) {
  const body = shade || dark;
  const gain = clamp(Number.isFinite(directGain) ? directGain : 1, 0, 1.5);
  ctx.save();
  for (const b of banks) {
    let bankAlpha = b.alpha * alpha;
    if (fadeTop) bankAlpha *= clamp((b.y - fadeTop[0]) / Math.max(1, fadeTop[1] - fadeTop[0]), 0, 1);
    if (!(bankAlpha > 0.002)) continue;
    // Direction to the light, varying smoothly with where it is.
    const lx = light ? clamp((light.x - b.x) / Math.max(1, b.w), -1, 1) : 0;
    const ly = light ? clamp((light.y - b.y) / Math.max(1, b.h * 6), -1, 1) : -1;
    const ll = Math.hypot(lx, ly) || 1;
    const shape = b.shape || cloudShape(Number(String(b.id).replace(/\D/g, '')) || 0, 0, b.puffs || CLOUD_PUFFS);
    // The veil: one long, thin layer under the puffs.
    const veilR = b.w * 0.55;
    const vg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, veilR);
    vg.addColorStop(0, rgba(body, bankAlpha * 0.45));
    vg.addColorStop(1, rgba(body, 0));
    ctx.fillStyle = vg;
    ctx.save();
    ctx.translate(b.x, b.y); ctx.scale(1, (b.h * 0.7) / veilR); ctx.translate(-b.x, -b.y);
    ctx.beginPath(); ctx.arc(b.x, b.y, veilR, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    for (const p of shape) {
      const px = b.x - b.w / 2 + p.u * b.w, py = b.y + p.y * b.h;
      const rx = p.r * b.h * 2.2, ry = p.r * b.h * 1.25;
      // How squarely this puff faces the light: the puffs on the lit side
      // of the bank (and its crown) catch it; the base stays in shade.
      const ox = (px - b.x) / Math.max(1, b.w / 2), oy = (py - b.y) / Math.max(1, b.h);
      const facing = clamp(0.5 + 0.5 * ((ox * lx + oy * ly) / ll) + 0.25 * (-p.y), 0, 1);
      const layers = [[body, 0, 1, 0.8], [lit, 0.3, 0.7, 0.6 * gain * facing]];
      for (const [col, off, size, a] of layers) {
        if (!(a > 0.001)) continue;
        const cx = px + (lx / ll) * rx * off, cy = py + (ly / ll) * ry * off;
        const r = rx * size;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, rgba(col, bankAlpha * a));
        g.addColorStop(0.55, rgba(col, bankAlpha * a * 0.55));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.save();
        ctx.translate(cx, cy); ctx.scale(1, ry / rx); ctx.translate(-cx, -cy);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
  }
  ctx.restore();
}
