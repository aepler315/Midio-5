// Topo reveal: in the Range's quiet passages the land gives way to the
// Forest Service map underneath it (contours, woodland tint, streams and
// the section grid, drawn on the terrain itself), then grows back when the
// song lifts. Compiled once per song from its energy curve, so any heard
// time -- forward seek, backward seek, pause -- reads the same amount.
import { smoothstep } from '../../utils/math.js';

export const TOPO_STEP_MS = 100;
/** Song-relative energy (EnergyCurves.globalEnergyNorm) averaged over the
 *  last TOPO_WINDOW_MS, long enough that a beat does not read as loud. A
 *  passage is quiet against the song itself: within the lowest
 *  TOPO_QUIET_FRAC of the span between its p10 and p90 averages, fading
 *  out by TOPO_EDGE_FRAC. */
export const TOPO_WINDOW_MS = 3000;
export const TOPO_QUIET_FRAC = 0.30;
export const TOPO_EDGE_FRAC = 0.45;
/** Below this span the song has no quiet passages to speak of (a wall of
 *  sound, a steady groove, a drone): its map stays under the land. A steady
 *  song with one short breakdown has its p10 on the loud level too, so
 *  when p10..p90 is too narrow the floor drops to the TOPO_BRIEF_PCT
 *  percentile, where a breakdown of a few percent of the song still lands. */
export const TOPO_MIN_SPAN = 0.15;
export const TOPO_BRIEF_PCT = 0.01;
/** A passage must stay quiet this long before the map starts to show: a
 *  single soft bar between hits is not a breakdown. */
export const TOPO_HOLD_MS = 1500;
/** The map surfaces over RISE and sinks back over FALL. */
export const TOPO_RISE_MS = 3000;
export const TOPO_FALL_MS = 2000;
/** The opening belongs to the scene's own arrival. */
export const TOPO_OPENING_MS = 8000;

const EMPTY = Object.freeze({ at: () => 0, durationMs: 0 });

/**
 * The reveal curve for a song: { at(timeMs) -> 0..1 }. `energyCurves`
 * needs globalEnergyNorm (or globalEnergy); without one the map never shows.
 */
export function compileTopoReveal({ energyCurves = null, durationMs = 0 } = {}) {
  const read = typeof energyCurves?.globalEnergyNorm === 'function' ? t => energyCurves.globalEnergyNorm(t)
    : typeof energyCurves?.globalEnergy === 'function' ? t => energyCurves.globalEnergy(t) : null;
  if (!read || !(durationMs > 0)) return EMPTY;
  const n = Math.ceil(durationMs / TOPO_STEP_MS) + 1;
  const window = Math.max(1, Math.round(TOPO_WINDOW_MS / TOPO_STEP_MS));
  const hold = Math.round(TOPO_HOLD_MS / TOPO_STEP_MS);
  const rise = TOPO_STEP_MS / TOPO_RISE_MS, fall = TOPO_STEP_MS / TOPO_FALL_MS;
  // Trailing average, then the song's own quiet edge.
  const avg = new Float32Array(n);
  const recent = new Float64Array(window);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const e = Math.min(1, Math.max(0, read(Math.min(i * TOPO_STEP_MS, durationMs)) || 0));
    sum += e - recent[i % window];
    recent[i % window] = e;
    avg[i] = sum / Math.min(i + 1, window);
  }
  const sorted = Float32Array.from(avg.subarray(Math.min(n - 1, window))).sort();
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
  const p90 = pct(0.9);
  let floor = pct(0.1);
  if (p90 - floor < TOPO_MIN_SPAN) floor = pct(TOPO_BRIEF_PCT);
  const span = p90 - floor;
  if (!(span >= TOPO_MIN_SPAN)) return Object.freeze({ at: () => 0, durationMs });
  const lo = floor + TOPO_QUIET_FRAC * span, hi = floor + TOPO_EDGE_FRAC * span;
  const env = new Float32Array(n);
  let quietRun = 0, level = 0;
  for (let i = 0; i < n; i++) {
    const tMs = i * TOPO_STEP_MS;
    const quiet = 1 - smoothstep(lo, hi, avg[i]);
    quietRun = quiet > 0.5 ? quietRun + 1 : 0;
    const target = quietRun >= hold && tMs >= TOPO_OPENING_MS ? quiet : 0;
    level += Math.max(-fall, Math.min(rise, target - level));
    env[i] = level;
  }
  return Object.freeze({
    durationMs,
    at(timeMs) {
      if (!(timeMs > 0)) return 0;
      const x = Math.min(n - 1, timeMs / TOPO_STEP_MS), i = Math.floor(x), f = x - i;
      const v = env[i] + ((env[Math.min(n - 1, i + 1)] ?? env[i]) - env[i]) * f;
      return v * v * (3 - 2 * v);
    },
  });
}

const cache = new WeakMap();

/** The manager's reveal curve, compiled once per energy curve and length. */
export function topoRevealFor(mgr) {
  const curves = mgr?.energyCurves;
  if (!curves || typeof curves !== 'object') return EMPTY;
  const hit = cache.get(curves);
  if (hit && hit.durationMs === (mgr.durationMs || 0)) return hit;
  const reveal = compileTopoReveal({ energyCurves: curves, durationMs: mgr.durationMs || 0 });
  cache.set(curves, reveal);
  return reveal;
}

/** How much of the map shows at this heard time (a diagnostic override wins). */
export function topoRevealAt(mgr, timeMs) {
  if (Number.isFinite(mgr?.topoOverride)) return Math.min(1, Math.max(0, mgr.topoOverride));
  if (mgr?.terrainPreview) return 0;
  return topoRevealFor(mgr).at(timeMs);
}
