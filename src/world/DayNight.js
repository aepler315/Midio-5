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
  const p = cyclePhase01(nowMs, c); // 0..1 phase within the cycle
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

  // Azimuth: how far each body is along its OWN arc, 0 at its rise and 1 at
  // its set. This is the same progress term the altitude above is built from
  // (altitude is sin(pi * u), peaking mid-arc), so a body's height and its
  // horizontal travel are guaranteed to stay in step -- it climbs as it
  // crosses and descends as it finishes, which is what makes the path read
  // as one arc rather than a bob and a slide happening independently.
  //
  // Held at its terminal value while a body is down (sun: 1 through the
  // whole night; moon: 0 through the whole day) rather than left undefined,
  // so anything reading it across a handoff sees a body parked at the
  // horizon it just left/has yet to reach, never a jump back across the sky.
  const sunAz01 = p < 0.5 ? p / 0.5 : 1;
  const moonAz01 = p >= 0.5 ? (p - 0.5) / 0.5 : 0;

  return {
    sunAlt: clamp01(sunAlt), moonAlt: clamp01(moonAlt), night: clamp01(night),
    dawnAlpha, duskAlpha, sunAz01, moonAz01,
  };
}

/** Screen-x fraction for a body `az01` along its arc (0 = rise, 1 = set).
 *
 *  Bodies rise ahead of Midio (screen right, the direction he runs) and set
 *  behind him, so the sky's travel agrees with the world's. Both ends sit
 *  inset from the true screen edge: a body is already fading out over its
 *  last stretch of altitude (horizonFade), and letting the arc run all the
 *  way to 0/1 would push that fade off-frame, so the rise and set would
 *  happen out of sight rather than at a visible horizon. */
export const CELESTIAL_RISE_XFRAC = 0.92;
export const CELESTIAL_SET_XFRAC = 0.08;
export function celestialXFracFor(az01) {
  const u = clamp01(az01);
  return CELESTIAL_RISE_XFRAC + (CELESTIAL_SET_XFRAC - CELESTIAL_RISE_XFRAC) * u;
}

/**
 * Where the SUN is at cycle phase `p`, continued below the horizon through
 * the whole night rather than stopping at the handoff.
 *
 * Nothing draws a below-horizon sun, but the moon is lit by it, so the moon
 * needs to know which way it is even while it's down -- that direction is
 * what decides which way the moon's bright limb faces. Getting this wrong is
 * visible: a moon high at midnight is lit from almost directly below, and a
 * moon lit from the side (or, worse, from a sun frozen at the horizon where
 * it happened to set) reads as lit by nothing in particular.
 *
 * Signed altitude runs the full circle -- sin(2*pi*p): 0 rising, +1 at the
 * sun's zenith, 0 setting, -1 at its nadir under the moon's zenith. Azimuth
 * runs out to the setting edge and back again, so the sun retraces its own
 * path underneath instead of teleporting across to rise from where it set.
 *
 * @returns {{xFrac:number, yFrac:number, altSigned:number}} screen fractions;
 *   yFrac is BELOW OCEAN_HORIZON_FRAC (larger) whenever the sun is down.
 */
export function sunScreenFrac(p01) {
  const p = ((p01 % 1) + 1) % 1;
  const altSigned = Math.sin(2 * Math.PI * p);
  // Out to the set edge over the day, then back the same way underneath.
  const az01 = p < 0.5 ? p / 0.5 : 1 - (p - 0.5) / 0.5;
  const span = OCEAN_HORIZON_FRAC - 0.12; // horizon -> zenith, same as celestialYFracFor
  return {
    xFrac: celestialXFracFor(az01),
    // Symmetric about the horizon: as far below at the nadir as above at noon.
    yFrac: OCEAN_HORIZON_FRAC - altSigned * span,
    altSigned,
  };
}

/** Cycle phase 0..1 for `nowMs`, the same term dayNight() works in --
 *  exported so callers can feed sunScreenFrac without re-deriving it. */
export function cyclePhase01(nowMs, cycle) {
  const c = Math.max(1, cycle);
  return ((nowMs % c) + c) % c / c;
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
