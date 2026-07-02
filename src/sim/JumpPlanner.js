// The two-sided obstacle⇄jump contract (spec §2.2.3 final paragraph, item 4).
// Pure functions, no state — shared by ObstacleSpawner (predictive placement
// side) and JumpController (accommodation side). Both sides must agree on the
// same arc model, so this module is the single source of truth for "where is
// Midio airborne and how high."
//
// Midio's jumps are kick-quantized and deterministic: every kick that catches
// Midio GROUND produces a known arc (takeoff = kick time, H and D from the
// kick's velocity and the live jumpHeight guardrail). A jump clears an
// obstacle of height `oh` during the sub-interval of the arc where
// jumpY(u, H) >= oh + margin. The *plateau* height Ha = (1-W)*H is what the
// hang sustains, so flooring H so that Ha >= oh+margin gives a wide, forgiving
// clean window.
import { jumpY, A, B, GAMMA, W, H_BASE, D_MIN, D_MAX, RETARGET_FALL_MS } from './JumpController.js';
import { clamp } from '../utils/math.js';

/** px of headroom Midio must clear above an obstacle's top. */
export const CLEAR_MARGIN = 8;

const SAMPLES = 240; // fine enough that u-resolution is sub-ms for D up to D_MAX

/**
 * Midio's altitude (px above ground) at absolute time tMs, given a takeoff and
 * arc shape. 0 outside [takeoff, takeoff+D].
 */
export function arcAltitude(tMs, takeoffMs, H, D) {
  const u = (tMs - takeoffMs) / D;
  if (u < 0 || u > 1) return 0;
  return jumpY(u, H);
}

/**
 * Simulate the deterministic kick-driven jump schedule (mirrors JumpController)
 * and return the actual arcs Midio performs: one per kick that launches from
 * GROUND (or retargets out of a fall). This is the predictive pass the spec
 * describes — "at load, simulate the deterministic jump schedule."
 *
 * @param {Array<{tMs:number, vel:number}>} kicks  in time order
 * @param {{hBase?:number, jumpHeight?:number, halftimeBpm?:number}} opts
 * @returns {Array<{takeoffMs:number, H:number, D:number}>}
 */
export function predictArcs(kicks, { hBase = H_BASE, jumpHeight = 1, halftimeBpm = 170 } = {}) {
  const arcs = [];
  let state = 'GROUND';
  let jumpStartMs = 0, curD = 500, curH = 0, jumpEndMs = 0;
  let lastKickMs = null, beatPeriodMs = 500, kickCount = 0;

  for (const k of kicks) {
    // _updateBeatPeriod: EMA the kick interval into beatPeriodMs.
    if (lastKickMs != null) {
      const interval = k.tMs - lastKickMs;
      if (interval > 120 && interval < 2000) beatPeriodMs = beatPeriodMs * 0.7 + interval * 0.3;
    }
    lastKickMs = k.tMs;
    kickCount++;

    const bpm = 60000 / beatPeriodMs;
    // Half-time ghost: above halftimeBpm every other kick skips the jump.
    if (bpm > halftimeBpm && kickCount % 2 === 0) continue;

    const H = hBase * (0.6 + 0.8 * (k.vel ?? 0.75)) * jumpHeight;
    const D = clamp(beatPeriodMs, D_MIN, D_MAX);

    // If the previous arc has ended by now, we're grounded.
    if (state === 'AIR' && k.tMs >= jumpEndMs) state = 'GROUND';

    if (state === 'GROUND') {
      arcs.push({ takeoffMs: k.tMs, H, D });
      state = 'AIR'; jumpStartMs = k.tMs; curD = D; curH = H; jumpEndMs = k.tMs + D;
    } else {
      // AIR — a kick mid-flight only relaunches via the compress retarget
      // window (fall phase, r < 0.3). The new arc starts after the compress.
      const u = (k.tMs - jumpStartMs) / curD;
      if (u >= A + B) {
        const r = (u - A - B) / GAMMA;
        if (r < 0.3) {
          const takeoff = k.tMs + RETARGET_FALL_MS;
          arcs.push({ takeoffMs: takeoff, H, D });
          jumpStartMs = takeoff; curD = D; curH = H; jumpEndMs = takeoff + D;
        }
      }
    }
  }
  return arcs;
}

/**
 * Covered windows derived from the actual jump arcs: for each arc, the
 * absolute-time interval where Midio is high enough to clear `obstacleHeight`,
 * with `mid50` = the central half (the placement target — under the apex).
 *
 * @param {Array<{tMs:number, vel:number}>} kicks
 * @param {{obstacleHeight:number, margin?:number, jumpHeight?:number, hBase?:number, halftimeBpm?:number}} opts
 */
export function coveredWindows(kicks, { obstacleHeight, margin = CLEAR_MARGIN, jumpHeight = 1, hBase = H_BASE, halftimeBpm = 170 } = {}) {
  const threshold = obstacleHeight + margin;
  const windows = [];
  for (const arc of predictArcs(kicks, { hBase, jumpHeight, halftimeBpm })) {
    const { takeoffMs, H, D } = arc;
    // jumpY is unimodal across u in [0,1], so the superlevel set is one interval.
    let first = null, last = null;
    for (let s = 0; s <= SAMPLES; s++) {
      const u = s / SAMPLES;
      if (jumpY(u, H) >= threshold) {
        if (first === null) first = u;
        last = u;
      }
    }
    if (first === null) continue; // this arc never clears the obstacle
    const enterMs = takeoffMs + first * D;
    const exitMs = takeoffMs + last * D;
    const span = exitMs - enterMs;
    windows.push({
      takeoffMs, H, D,
      enterMs, exitMs,
      mid50: [enterMs + 0.25 * span, enterMs + 0.75 * span],
    });
  }
  return windows;
}

/**
 * Snap a salient rhythm-event seed time to the nearest covered window, placing
 * the obstacle inside that window's middle 50% (seeded jitter). Returns null if
 * no window exists — meaning Midio is never airborne high enough anywhere, so
 * the candidate is dropped (not placed where it would be unavoidable).
 */
export function snapToWindow(tMs, windows, rand) {
  let best = null, bestDist = Infinity;
  for (const w of windows) {
    const [lo, hi] = w.mid50;
    const d = Math.abs(tMs - clamp(tMs, lo, hi));
    if (d < bestDist) { bestDist = d; best = w; }
  }
  if (!best) return null;
  const [lo, hi] = best.mid50;
  return { window: best, placeMs: lo + rand() * (hi - lo) };
}

/**
 * The minimum arc height H that guarantees the hang plateau clears an obstacle:
 * Ha = (1-W)*H >= obstacleHeight + margin  →  H >= (oh+margin)/(1-W).
 * Callers cap this against the live jumpHeight guardrail.
 */
export function minClearanceH(obstacleHeight, margin = CLEAR_MARGIN) {
  return Math.ceil((obstacleHeight + margin) / (1 - W));
}