// A distant swell that stands in for the back ridge when the view angle has
// buried it.
//
// The far range (L2) carries the biggest dance -- that is deliberate, the
// drama belongs at the back. But the camera's angle and pull-back decide how
// much of that range the nearer hills eat, and at some framings L2 spends
// nearly the whole song under L3/L4. ConnectorHills already patches the
// SIGHTLINE in that case (it fills the dead band the hidden ridge left), but
// nothing replaces the MOTION: the one thing at the back of the scene that
// was moving is gone, and the horizon goes static.
//
// So when the ridge is mostly covered, a distant wave takes its place: a long,
// slow ocean swell drawn behind everything terrestrial, rolling along the
// horizon where the ridge used to dance. The near ranges still occlude its
// body, so it reads as water seen past the mountains rather than a band pasted
// over the sky.
//
// Two things this module is careful about:
//
//  - **The switch is a section-boundary decision, not a per-frame one.** A
//    threshold sampled every frame would flip the horizon between rock and
//    water whenever a tall column danced past the crossover -- the exact
//    strobing ConnectorHills' own MIN_SPAN_PX guard exists to avoid. The
//    decision here is only ever *evaluated* at a section change (see
//    BiomeManager.update), and `decideDistantWave` additionally carries
//    hysteresis so a song hovering near the threshold doesn't alternate at
//    every boundary either.
//
//  - **Pure geometry.** No canvas: BiomeManager fills these points, tests
//    exercise the maths directly. Same split as GeoCrest.js /
//    MountainChoreo.js / ConnectorHills.js.
import { clamp01 } from '../utils/math.js';

// How much of the ridge has to be buried before the wave takes over, and how
// little before it hands the horizon back. The gap between them is the
// hysteresis: a song sitting at 0.5 occlusion keeps whatever it has rather
// than swapping at every section.
export const WAVE_ON_FRAC = 0.62;
export const WAVE_OFF_FRAC = 0.42;

// Seconds to cross-fade in or out once a boundary has flipped the decision.
// The DECISION only happens at a section change; this is just how long the
// crossfade the boundary started takes to finish.
export const WAVE_FADE_SEC = 1.4;

// Swell shape: three incommensurate components so the horizon never repeats on
// a visible cycle, with the long one dominant -- distance flattens detail, and
// a busy chop at the back of the scene reads as noise, not as water.
// Wavelengths in world px, angular speeds in rad/s. The middle component
// travels the other way, which is what keeps crests from marching in lockstep.
const COMPONENTS = [
  { len: 620, speed: 0.42, amp: 0.55, phase: 0 },
  { len: 293, speed: -0.61, amp: 0.30, phase: 1.3 },
  { len: 137, speed: 0.95, amp: 0.15, phase: 2.7 },
];
// Amps sum to 1, so `swellAt` is bounded to [-1, 1] before the set envelope.

// Swells arrive in sets rather than at a constant height -- a very slow
// envelope over the whole horizon, never dropping the wave to nothing.
const SET_LEN = 1500, SET_SPEED = 0.17, SET_DEPTH = 0.25;

/**
 * How much of the dancing ridge is hidden behind the skyline in front of it,
 * as a fraction of the samples across the screen.
 *
 * The companion to ConnectorHills' `occludedSpans`: that one asks "where are
 * the gaps and how deep", this one asks the single global question the
 * substitution decision turns on. Same "buried" test (screen y, ridge below
 * skyline, past a minimum depth) so the two agree about what covered means.
 *
 * @param {Array<{y:number}>} ridge  the dancy range's crest
 * @param {number[]} skyline  the occluding crest y at each of those x's
 * @returns {number} 0 (fully visible) .. 1 (nothing showing)
 */
export function occludedFraction(ridge, skyline, { minDepthPx = 10 } = {}) {
  if (!ridge || !skyline || !ridge.length) return 0;
  const n = Math.min(ridge.length, skyline.length);
  if (n <= 0) return 0;
  let buried = 0;
  for (let i = 0; i < n; i++) {
    if (ridge[i].y - skyline[i] > minDepthPx) buried++;
  }
  return buried / n;
}

/**
 * Should the distant wave be standing in for the ridge?
 *
 * Hysteretic: crossing WAVE_ON_FRAC turns it on, and only dropping back below
 * WAVE_OFF_FRAC turns it off again. Between the two the previous answer
 * stands, so a framing that hovers around the threshold settles instead of
 * alternating every time it's asked.
 *
 * Call this ONLY at a section boundary -- the whole point is that the horizon
 * doesn't change identity mid-section.
 */
export function decideDistantWave(occlusion01, wasOn = false) {
  const occ = clamp01(occlusion01);
  if (wasOn) return occ >= WAVE_OFF_FRAC;
  return occ >= WAVE_ON_FRAC;
}

/**
 * Advance the substitution state by one frame.
 *
 * This exists as a function rather than as four lines inside BiomeManager
 * because the section-only rule is the whole feature, and inline it would be
 * unreachable from a test (BiomeManager needs a canvas and a schedule). Here
 * it is exactly what it claims: `decideDistantWave` is called if and only if
 * `sectionChanged` is true, and every other frame only walks the crossfade
 * toward whatever the last boundary decided.
 *
 * @param {{on:boolean, mix:number}} state  previous frame's state
 * @returns {{on:boolean, mix:number}} the next one (a new object; the caller
 *   owns its own state, this borrows nothing)
 */
export function stepDistantWave(state, { occlusion01 = 0, sectionChanged = false, dtSec = 0 } = {}) {
  const prevOn = !!(state && state.on);
  const prevMix = clamp01(state && state.mix);
  const on = sectionChanged ? decideDistantWave(occlusion01, prevOn) : prevOn;
  const target = on ? 1 : 0;
  const step = Math.max(0, dtSec) / Math.max(0.05, WAVE_FADE_SEC);
  const mix = target > prevMix
    ? Math.min(target, prevMix + step)
    : Math.max(target, prevMix - step);
  return { on, mix };
}

/** The swell's height at one world x, in [-1, 1] before amplitude. */
export function swellAt(worldX, tSec) {
  let s = 0;
  for (const c of COMPONENTS) {
    s += c.amp * Math.sin((worldX / c.len) * 2 * Math.PI + tSec * c.speed + c.phase);
  }
  const set = 1 - SET_DEPTH + SET_DEPTH * Math.sin(tSec * SET_SPEED + worldX / SET_LEN);
  return s * set;
}

/**
 * The swell's crest line across the screen.
 *
 * Phase is keyed to world x (scrollX + screen x), not screen x, so the wave
 * travels with the parallax of the depth it's drawn at instead of sliding
 * across the land -- the same discipline ConnectorHills' `rollAt` uses to keep
 * its hills planted.
 *
 * @returns {Array<{x:number,y:number}>} left to right, one sample past each edge
 */
export function swellCrest({
  width, baselineY, ampPx, tSec, scrollX = 0, stepPx = 12, energy01 = 1,
}) {
  const pts = [];
  const amp = ampPx * (0.6 + 0.4 * clamp01(energy01));
  for (let x = -stepPx; x <= width + stepPx; x += stepPx) {
    // Negative is up on a canvas, and a crest is a rise.
    pts.push({ x, y: baselineY - amp * swellAt(scrollX + x, tSec) });
  }
  return pts;
}
