// "Are the characters moving to the music, or just moving?"
//
// Everything the show does is hung off the beat grid: jumps are kick-
// quantized (JumpController.scheduledJumpD), Broshi's surges are bar-
// quantized, section cuts land on bar times. When the tempo estimate is
// wrong -- a half-time read, a downbeat landing on the offbeat, rubato the
// estimator flattened -- none of that fails loudly. It just produces motion
// that has no visible relationship to what you're hearing, which is exactly
// what a viewer describes as "moving randomly."
//
// The signal that catches it: take each detected kick and measure its phase
// error against the nearest beat-grid point. A correct grid puts every kick
// near zero error. A wrong grid scatters them uniformly. Circular variance
// over a rolling window separates the two cleanly, and (being circular) it
// doesn't care about a constant offset -- a grid that's right but shifted
// scores as locked, because it IS locked; the player's tap anchor is what
// fixes the phase.
//
// The prompting policy is deliberately timid. A nudge that interrupts is
// worse than no nudge: it should read as an offer, appear rarely, and never
// while the player is already engaged.
//
// Pure and DOM-free like BeatAnchor -- every timestamp is handed in.
import { clamp01 } from '../utils/math.js';

const WINDOW = 16;              // kicks per verdict
const MIN_KICKS = 10;           // don't judge on a handful
// Circular variance above this = the kicks aren't on the grid. 0 is perfect
// lock, 1 is uniform scatter. 0.55 sits well clear of "human-loose but
// locked" (a live drummer lands ~0.15-0.3) without needing pure chaos.
const SCATTER_THRESHOLD = 0.55;
// The anchor's own confidence is the other half: if the player has already
// tapped a good pass in, the grid is being steered and there is nothing to
// ask for, however scattered the CHART's kicks look.
const ANCHOR_CONFIDENCE_FLOOR = 0.5;

const QUIET_START_MS = 15000;   // never prompt over the opening
const SUSTAIN_MS = 20000;       // badness must persist this long
const REPROMPT_GAP_MS = 90000;  // and at most this often
const MAX_PROMPTS_PER_SONG = 2; // asked twice and ignored twice = they don't want it

/**
 * Circular variance of a set of phases (radians). 0 = perfectly concentrated,
 * 1 = uniformly scattered. Using the resultant-vector length rather than a
 * plain stddev is what makes this wrap correctly at ±π: a kick 1ms before the
 * beat and one 1ms after are adjacent, not maximally distant.
 */
export function circularVariance(phasesRad) {
  if (!phasesRad || phasesRad.length === 0) return 0;
  let sx = 0, sy = 0;
  for (const p of phasesRad) { sx += Math.cos(p); sy += Math.sin(p); }
  const R = Math.hypot(sx, sy) / phasesRad.length;
  return clamp01(1 - R);
}

export class SyncMonitor {
  constructor() {
    this._phases = [];
    this.scatter = 0;
    /** True while the grid looks wrong AND the player hasn't fixed it. */
    this.incoherent = false;
    this._badSinceMs = null;
    this._lastPromptMs = -Infinity;
    this.promptCount = 0;
    /** Latched: set when the monitor decides a nudge is warranted, and it
     *  STAYS set until consumePrompt() takes it. A one-frame flag would be
     *  at the mercy of who calls update() and who reads it in what order --
     *  the UI would silently miss offers depending on frame ordering. A
     *  latch has one producer and one consumer and cannot be lost. */
    this.promptPending = false;
  }

  /**
   * Feed one detected kick.
   * @param {number} tMs        the kick's own time
   * @param {number} beatPeriodMs current beat length (JumpController's live EMA)
   * @param {number} gridOriginMs a known grid point (the anchor's own origin,
   *   or 0 -- any point on the grid works, since only the phase matters)
   */
  onKick(tMs, beatPeriodMs, gridOriginMs = 0) {
    if (!(beatPeriodMs > 0) || !Number.isFinite(tMs)) return;
    const rel = ((tMs - gridOriginMs) % beatPeriodMs + beatPeriodMs) % beatPeriodMs;
    this._phases.push((rel / beatPeriodMs) * Math.PI * 2);
    if (this._phases.length > WINDOW) this._phases.shift();
  }

  /**
   * @param {number} nowMs
   * @param {object} opts
   * @param {number} opts.anchorConfidence BeatAnchor.confidence
   * @param {boolean} [opts.suppress] the overlay is already up, or the song
   *   is paused/ending -- hold everything without losing accumulated state.
   */
  update(nowMs, { anchorConfidence = 0, suppress = false } = {}) {
    if (this._phases.length >= MIN_KICKS) this.scatter = circularVariance(this._phases);

    const anchored = anchorConfidence >= ANCHOR_CONFIDENCE_FLOOR;
    this.incoherent = this._phases.length >= MIN_KICKS
      && this.scatter > SCATTER_THRESHOLD
      && !anchored;

    if (!this.incoherent) {
      // Recovering resets the clock: the next prompt has to earn its own
      // sustained stretch rather than resuming a half-finished one.
      this._badSinceMs = null;
      return;
    }
    if (this._badSinceMs === null) this._badSinceMs = nowMs;

    if (suppress) return;
    if (nowMs < QUIET_START_MS) return;
    if (nowMs - this._badSinceMs < SUSTAIN_MS) return;
    if (nowMs - this._lastPromptMs < REPROMPT_GAP_MS) return;
    if (this.promptCount >= MAX_PROMPTS_PER_SONG) return;

    this.promptPending = true;
    this._lastPromptMs = nowMs;
    this.promptCount++;
    this._badSinceMs = null;
  }

  /** Take a pending prompt, if there is one. Returns true exactly once per
   *  raised prompt, whoever calls it and whenever. */
  consumePrompt() {
    if (!this.promptPending) return false;
    this.promptPending = false;
    return true;
  }

  /** The player tapped a real pass in (or opened the overlay): stop watching
   *  the stretch that prompted it, and drop any offer still in flight. */
  onCalibrated() {
    this._badSinceMs = null;
    this._phases.length = 0;
    this.promptPending = false;
  }
}
