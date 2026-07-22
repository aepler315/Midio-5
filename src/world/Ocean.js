// Pure math for the far-distance ocean: a sea line and a handful of
// shimmer bands, both periodic in the horizontal 0..1 coordinate so they
// wrap seamlessly under parallax. No canvas here; BiomeManager consumes
// these, tests exercise them directly.
import { clamp01, mulberry32 } from '../utils/math.js';

/** Vertical offset (px) of the sea line at horizontal position u01 in
 *  [0,1) -- two summed sines, both integer multiples of 2*pi over u so the
 *  curve is exactly periodic (no seam when the ocean band wraps under
 *  parallax scroll). Amplitude breathes with the bass; a kick presses the
 *  whole line down slightly, like a distant swell settling. */
export function seaLineY(u01, tSec, bass, kick = 0) {
  const b = clamp01(bass);
  const amp = 0.35 + 0.65 * b;
  const wave = 2.2 * Math.sin(u01 * Math.PI * 2 * 3 + tSec * 0.5)
    + 1.4 * Math.sin(u01 * Math.PI * 2 * 7 - tSec * 0.9);
  return wave * amp - 2.5 * clamp01(kick);
}

/** Seeded descriptors for the horizontal shimmer rows drawn across the
 *  ocean's face -- deterministic per song. */
export function shimmerBands(seed, count = 5) {
  const rand = mulberry32(seed >>> 0);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      yFrac: 0.15 + rand() * 0.75,
      speed: 6 + rand() * 14,
      phase: rand() * 1000,
      dashLen: 30 + rand() * 60,
      gapLen: 20 + rand() * 40,
      alpha: 0.05 + rand() * 0.09,
    });
  }
  return out;
}

/** Dash-phase offset (px) for one shimmer band at time tSec, scrolled by
 *  scrollX -- feeds ctx.lineDashOffset. Pure modulo arithmetic, no canvas. */
export function shimmerOffsetX(band, tSec, scrollX) {
  const period = band.dashLen + band.gapLen;
  const raw = -(scrollX * 0.1 + tSec * band.speed + band.phase);
  return ((raw % period) + period) % period;
}
