// Pure math for the far-distance ocean: an abstract field of horizontal
// wave-contour rows receding toward a high horizon, seen through/behind the
// mountain silhouettes -- like an infinite flat plane of water in
// perspective. No canvas here; BiomeManager consumes these, tests exercise
// them directly.
import { clamp01, mulberry32 } from '../utils/math.js';

export const OCEAN_HORIZON_FRAC = 0.30;
// Deliberately NOT down at the mountains' feet: everything below the
// tallest ridgelines is occluded by opaque foreground layers anyway, so a
// near edge that reaches down there wastes most of the row stack on rows
// nobody will ever see. Pulling the near edge up to just above where peaks
// typically crest packs the whole field into the band that actually shows.
export const OCEAN_NEAR_FRAC = 0.48;

/** Vertical offset (px) of a wave row at horizontal position u01 in [0,1)
 *  -- two summed sines, both integer multiples of 2*pi over u so the curve
 *  is exactly periodic (no seam when a row wraps under parallax scroll).
 *  Amplitude breathes with the bass; a kick presses the whole line down
 *  slightly, like a distant swell settling. */
export function seaLineY(u01, tSec, bass, kick = 0) {
  const b = clamp01(bass);
  const amp = 0.35 + 0.65 * b;
  const wave = 2.2 * Math.sin(u01 * Math.PI * 2 * 3 + tSec * 0.5)
    + 1.4 * Math.sin(u01 * Math.PI * 2 * 7 - tSec * 0.9);
  return wave * amp - 2.5 * clamp01(kick);
}

/** Row baselines (screen y, px) for `count` wave rows receding from a near
 *  edge to a distant horizon, projected 1/z-style so the gaps between rows
 *  strictly shrink toward the horizon -- the perspective compression that
 *  reads as an infinite flat plane. Row 0 is nearest (largest y, closest to
 *  `nearY`); the last row approaches `horizonY` but never reaches it. */
export function oceanRowYs(horizonY, nearY, count, g = 1.5) {
  const n = Math.max(1, count | 0);
  const span = nearY - horizonY;
  const out = new Array(n);
  for (let j = 0; j < n; j++) {
    const d = Math.pow(g, j);
    out[j] = horizonY + span / d;
  }
  return out;
}

/** Seeded per-row descriptors for the wave field -- deterministic per song. */
export function waveRows(seed, count = 14) {
  const rand = mulberry32(seed >>> 0);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      uPhase: rand(),
      speedMul: 0.6 + rand() * 1.0,
      ampMul: 0.7 + rand() * 0.6,
      alphaMul: 0.75 + rand() * 0.4,
    });
  }
  return out;
}

/** Opacity envelope (0..1) across the row stack, indexed near-to-far
 *  (i=0 nearest). Fades toward the horizon (distance haze) and tapers for
 *  the very nearest rows (mostly occluded by foreground silhouettes
 *  anyway), peaking in the upper-middle of the stack where the field is
 *  actually visible above the ridgelines. */
export function rowAlpha(i, count) {
  const n = Math.max(1, count);
  const u = n <= 1 ? 0.35 : i / (n - 1); // 0 near, 1 far/horizon
  const PEAK_U = 0.35;
  if (u <= PEAK_U) {
    const t = u / PEAK_U;
    return clamp01(0.3 + 0.7 * Math.sin(t * Math.PI / 2)); // nearest rows taper in
  }
  const t = (u - PEAK_U) / (1 - PEAK_U);
  return clamp01(0.05 + 0.95 * (1 - t) * (1 - t)); // fades toward the horizon
}
