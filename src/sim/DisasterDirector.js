// The arbiter for large-scale hazard events (earthquake today; flood/
// wildfire/tsunami build-out is intended to register here too as they
// land). Owns exclusivity (only one disaster live at a time), a cooldown
// floor, and a per-song schedule anchored to the song's own energy
// hotspots -- the same anchoring technique OceanLife.tsunamiSchedule and
// OrogenyDirector.findClimaxMs already use, so a disaster reads as a
// musical event rather than a wall-clock timer.
//
// Pure scheduling lives in buildDisasterSchedule (directly testable); the
// class just walks that schedule forward and fires the matching director's
// strike(). Each kind's own director (QuakeDirector today) owns its actual
// envelope/rendering -- this file only decides WHEN and IF one may start.
import { mulberry32, hashSeed } from '../utils/math.js';

const MIN_GAP_MS = 45000; // hard cooldown floor between any two disasters
const QUAKE_MIN_DURATION_MS = 30000; // too short a song for a full quake arc to land meaningfully

/**
 * One quake slot per song (the only implemented kind so far), anchored
 * near a hotspot the same way tsunamiSchedule anchors its walls -- jittered
 * off the exact peak so it doesn't always coincide with whatever else is
 * also scheduled against that same hotspot. Returns [] for songs too short
 * to give the ~7s quake arc room to read, or with no candidate window at
 * all. Pure, exported for direct testing.
 */
export function buildDisasterSchedule(rand, durationMs, hotspotMs = []) {
  if (!(durationMs >= QUAKE_MIN_DURATION_MS)) return [];
  const base = hotspotMs.length > 0
    ? hotspotMs[Math.floor(rand() * hotspotMs.length)]
    : durationMs * (0.45 + rand() * 0.3);
  const tMs = Math.min(durationMs * 0.94, Math.max(durationMs * 0.1, base + (rand() - 0.5) * 6000));
  return [{ tMs, kind: 'quake' }];
}

export class DisasterDirector {
  constructor(seed = 1, durationMs = 0, hotspotMs = []) {
    this.durationMs = durationMs;
    const rand = mulberry32(hashSeed(`${seed}:disaster`) || 1);
    this._schedule = buildDisasterSchedule(rand, durationMs, hotspotMs);
    this._nextIdx = 0;
    this._lastStruckMs = -Infinity;
    this.activeKind = null;   // which disaster (if any) currently owns the stage -- exclusivity
    this.justStruck = false;  // one-frame flag, true only on the update() call that fires a strike
    this.struckKind = null;
  }

  /**
   * @param {number} nowMs
   * @param {number} worldX current scroll position -- new strikes are
   *   epicentered here, so the ground shakes hardest right where the
   *   player already is and falls off with distance from there.
   * @param {{quake?: import('./QuakeDirector.js').QuakeDirector}} deps
   *   live directors this arbiter can trigger and must defer to.
   */
  update(nowMs, worldX, deps = {}) {
    this.justStruck = false;
    this.struckKind = null;

    this.activeKind = deps.quake && deps.quake.active ? 'quake' : null;
    if (this.activeKind) return; // exclusivity: nothing new starts while one is live

    if (this._nextIdx >= this._schedule.length) return;
    const next = this._schedule[this._nextIdx];
    if (nowMs < next.tMs) return;
    if (nowMs - this._lastStruckMs < MIN_GAP_MS) return; // belt-and-suspenders vs. the scheduler's own spacing

    this._nextIdx++;
    this._lastStruckMs = nowMs;
    this.justStruck = true;
    this.struckKind = next.kind;
    if (next.kind === 'quake' && deps.quake) deps.quake.strike(nowMs, worldX);
  }
}
