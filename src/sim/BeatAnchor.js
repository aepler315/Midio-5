// The player's own sense of "where's the beat": a tap anywhere on the
// canvas, or almost any key, marks a phase the ensemble/jump scheduler pull
// toward -- a beat ANCHOR, not a jump trigger, and never a replacement for
// the chart. Phase follows the player immediately (that's the whole point);
// period is deliberately slow to move so a couple of fast taps can't turn
// the whole show into sixteenths, while sustained metrical tapping is still
// allowed to retune it. Pure/testable: no wall clock, no DOM, no audio --
// every timestamp is handed in by the caller.
import { clamp, clamp01 } from '../utils/math.js';

const TWO_PI = Math.PI * 2;

const SESSION_GAP_MS = 4000;   // a gap this long starts a fresh tap session
const PHASE_GAIN = 0.55;       // how hard each tap pulls anchorMs toward it
const HISTORY_MAX = 24;        // taps kept for period inference
const IOI_MIN_MS = 100, IOI_MAX_MS = 3000; // plausible inter-onset-interval range
// Multiples of the song's own beat a tap-period may snap to. 0.25 exists
// only so sustained sixteenth-note tapping matches CLEANLY (rather than
// being rejected as non-metrical) -- it is then clamped to LEVEL_MIN below,
// which is the "level it out to eighth notes" behavior asked for.
const MATCH_LADDER = [0.25, 0.5, 1, 2, 4];
const LEVEL_MIN = 0.5, LEVEL_MAX = 4;
const NONMETRICAL_LOG_TOL = Math.log(1.18); // ~18% off every rung -> reject
const COMMIT_TAPS_UP = 12;    // consecutive taps needed to commit a FASTER level
const COMMIT_TAPS_DOWN = 6;   // consecutive taps needed to commit a SLOWER level
const MIN_TAPS_FOR_PERIOD = 3;
const CONF_GAIN = 0.18, CONF_LOSS = 0.35;
const CONF_HOLD_MS = 6000;    // confidence holds flat this long after the last tap
const CONF_HALFLIFE_MS = 4000; // then decays on this half-life

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const mid = n >> 1;
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export class BeatAnchor {
  constructor(songBeatMs = 500) {
    this.songBeatMs = Math.max(1, songBeatMs);
    this.anchorMs = 0;
    this.periodMs = this.songBeatMs;
    this.confidence = 0;

    this._level = 1; // committed multiple of songBeatMs
    this._history = []; // recent tap timestamps, ascending
    this._lastTapMs = -Infinity;
    this._baseConfidence = 0; // confidence value AT the last tap, before decay
    this._candidateLevel = null;
    this._candidateStreak = 0;
  }

  /** The song's own beat length can become known/change (e.g. a fresh song
   *  load) independent of taps; an anchor with no tap history should track
   *  it directly so the untapped grid stays musically sane. */
  setSongBeatMs(beatMs) {
    if (!(beatMs > 0)) return;
    this.songBeatMs = beatMs;
    if (this._history.length === 0) this.periodMs = beatMs * this._level;
  }

  /** Register a player tap at tMs (already stamped on the audio/visual clock
   *  the caller wants the anchor to reason in). */
  tap(tMs) {
    const freshSession = this._history.length === 0 || (tMs - this._lastTapMs) > SESSION_GAP_MS;
    if (freshSession) {
      this._history = [tMs];
      this.anchorMs = tMs;
      this._candidateLevel = null;
      this._candidateStreak = 0;
    } else {
      // Fold the phase error into [-period/2, +period/2] and pull decisively
      // -- moves the anchor without letting one stray tap own the grid.
      const period = Math.max(1, this.periodMs);
      let err = (tMs - this.anchorMs) % period;
      if (err > period / 2) err -= period;
      else if (err < -period / 2) err += period;
      this.anchorMs += PHASE_GAIN * err;

      const ioi = tMs - this._lastTapMs;
      this._history.push(tMs);
      if (this._history.length > HISTORY_MAX) this._history.shift();

      if (ioi >= IOI_MIN_MS && ioi <= IOI_MAX_MS) {
        const { metrical } = this._recomputePeriod();
        this._baseConfidence = clamp01(this._baseConfidence + (metrical ? CONF_GAIN : -CONF_LOSS));
      } else {
        // A gap too short/long to be a plausible beat interval is evidence
        // AGAINST the current anchor, not just data to discard.
        this._baseConfidence = clamp01(this._baseConfidence - CONF_LOSS);
      }
    }
    this._lastTapMs = tMs;
    this.update(tMs);
  }

  /** Re-derive the committed period level from the tap history's median
   *  inter-onset-interval, snapped to the metrical ladder, gated by
   *  hysteresis so a level only takes effect after winning several taps in
   *  a row. Returns { metrical } for the caller's confidence bookkeeping. */
  _recomputePeriod() {
    const h = this._history;
    if (h.length < MIN_TAPS_FOR_PERIOD) return { metrical: true };
    const ioIs = [];
    for (let i = 1; i < h.length; i++) {
      const d = h[i] - h[i - 1];
      if (d >= IOI_MIN_MS && d <= IOI_MAX_MS) ioIs.push(d);
    }
    if (ioIs.length === 0) return { metrical: true };
    const medIOI = median(ioIs);
    const ratio = medIOI / this.songBeatMs;
    let best = MATCH_LADDER[0], bestDist = Infinity;
    for (const rung of MATCH_LADDER) {
      const dist = Math.abs(Math.log(ratio / rung));
      if (dist < bestDist) { bestDist = dist; best = rung; }
    }
    if (bestDist > NONMETRICAL_LOG_TOL) {
      this._candidateLevel = null;
      this._candidateStreak = 0;
      return { metrical: false };
    }
    const level = clamp(best, LEVEL_MIN, LEVEL_MAX);
    if (level === this._level) {
      this._candidateLevel = null;
      this._candidateStreak = 0;
      return { metrical: true };
    }
    if (this._candidateLevel === level) this._candidateStreak++;
    else { this._candidateLevel = level; this._candidateStreak = 1; }
    // Speeding up (a SMALLER level -- more frequent taps) is the riskier
    // direction (impatience, a stray flurry) and needs the long streak;
    // slowing down commits faster.
    const needed = level < this._level ? COMMIT_TAPS_UP : COMMIT_TAPS_DOWN;
    if (this._candidateStreak >= needed) {
      this._level = level;
      this.periodMs = this.songBeatMs * level;
      this._candidateLevel = null;
      this._candidateStreak = 0;
    }
    return { metrical: true };
  }

  /** Call once per sim step. A closed-form envelope (pure function of time
   *  since the last tap) -- confidence holds flat for a beat or two after
   *  tapping stops, then hands authority back to the chart on a half-life. */
  update(nowMs) {
    const dt = Math.max(0, nowMs - this._lastTapMs);
    this.confidence = dt <= CONF_HOLD_MS
      ? this._baseConfidence
      : this._baseConfidence * (0.5 ** ((dt - CONF_HOLD_MS) / CONF_HALFLIFE_MS));
  }

  /** The anchor's phase at nowMs, in [0, 2π). */
  phaseRad(nowMs) {
    const period = Math.max(1, this.periodMs);
    const t = ((nowMs - this.anchorMs) % period + period) % period;
    return (t / period) * TWO_PI;
  }

  /** The next anchor grid point (anchorMs + k*periodMs) strictly after afterMs. */
  nextGridMs(afterMs) {
    const period = Math.max(1, this.periodMs);
    const k = Math.floor((afterMs - this.anchorMs) / period) + 1;
    return this.anchorMs + k * period;
  }
}
