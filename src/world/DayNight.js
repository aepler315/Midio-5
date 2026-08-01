// A sunrise/moonrise cycle: the sun climbs out of the sea, arcs overhead,
// and sets back into it; the moon takes over for the second half. Pure
// math -- BiomeManager consumes it to swap/position the celestial bodies,
// darken the sky, and brighten the stars at night.
import { clamp01, smoothstep } from '../utils/math.js';
import { OCEAN_HORIZON_FRAC } from './Ocean.js';

const MIN_CYCLE_MS = 60000;
const MAX_CYCLE_MS = 120000;
const TARGET_CYCLE_MS = 90000;

/** Full day+night cycle length for a song of `durationMs`. Aims for at
 *  least two full cycles (never just one static "arc") within the 60-120s
 *  band, but never returns something longer than the song itself -- a
 *  very short song (well under two minutes) gets one shorter cycle rather
 *  than sitting frozen at a single altitude for its whole runtime. */
export function cycleMs(durationMs) {
  const d = Math.max(1, durationMs || 1);
  const cycles = Math.max(2, Math.round(d / TARGET_CYCLE_MS));
  const raw = d / cycles;
  const clamped = Math.min(MAX_CYCLE_MS, Math.max(MIN_CYCLE_MS, raw));
  return Math.min(clamped, d);
}

/** Altitude (0..1) and night mix at `nowMs` for a cycle of length `cycle`.
 *  Sun owns the first half (rising, zenith, setting), the moon the second
 *  -- both altitudes are exactly 0 at the handoffs, so there's always a
 *  clean moment where neither body is above the horizon. `night` is 0 at
 *  the sun's zenith, 1 at the moon's zenith, smoothstepped through both
 *  handoffs so the sky darkens/lightens gradually, not on a hard cut. */
export function dayNight(nowMs, cycle) {
  const c = Math.max(1, cycle);
  const p = ((nowMs % c) + c) % c / c; // 0..1 phase within the cycle
  const sunAlt = p < 0.5 ? Math.sin(Math.PI * (p / 0.5)) : 0;
  const moonAlt = p >= 0.5 ? Math.sin(Math.PI * ((p - 0.5) / 0.5)) : 0;

  // night: smoothstep 0->1 across the sunset handoff (p in [0.42,0.5]),
  // hold at 1 through the moon's whole reign (including its zenith at
  // p=0.75), smoothstep 1->0 across the sunrise handoff as p approaches
  // the wrap back to 0 (p in [0.92,1.0]).
  let night;
  if (p < 0.42) night = 0;
  else if (p < 0.5) night = smoothstep(0.42, 0.5, p);
  else if (p < 0.92) night = 1;
  else night = 1 - smoothstep(0.92, 1.0, p);

  // Dawn/dusk washes bracket each handoff (the sun's own rise and set).
  const dawnAlpha = clamp01(1 - Math.abs(p - 0.03) / 0.12) * 0.16;
  const duskAlpha = clamp01(1 - Math.abs(p - 0.47) / 0.12) * 0.18;

  return { sunAlt: clamp01(sunAlt), moonAlt: clamp01(moonAlt), night: clamp01(night), dawnAlpha, duskAlpha };
}

/** Screen-height fraction for a body at altitude `alt` (0 at the horizon,
 *  1 at zenith) -- rises from and sets into the sea horizon rather than an
 *  arbitrary sky band. */
export function celestialYFracFor(alt) {
  const zenithFrac = 0.12;
  return OCEAN_HORIZON_FRAC - clamp01(alt) * (OCEAN_HORIZON_FRAC - zenithFrac);
}

/** Fade multiplier (0..1) for a body near the horizon -- eases it in/out
 *  over its last FADE_BAND of altitude instead of popping at alt=0. */
const FADE_BAND = 0.08;
export function horizonFade(alt) {
  return clamp01(alt / FADE_BAND);
}
