// The beat zoom: an automatic, music-driven camera breathing on top of
// everything else (camera shake/punch). It picks a new "figure" -- a shape
// of motion, not just an amplitude -- at every phrase boundary, weighted by
// the section's mood: calm phrases get slow, subtle breathing or a long
// swell; energetic phrases get a sharp kick-synced snap, or, right on a
// drop, the big dramatic dive. Composed multiplicatively alongside camera
// shake/punch in Renderer.
//
// Reads as intentional rather than glitchy for three reasons: every figure
// produces a TARGET offset that the displayed value chases through a
// two-rate ease (quick attack, slower release) so figure switches and kick
// onsets are never a same-frame jump; the kick pulse and the breath cycle
// both borrow their timing from the world's own choreography (kickEnv --
// the exact shape the mountains bounce with -- and the bar phase, not wall
// clock); and the whole thing is gated by the song's own energy, so it's
// visibly loud when the music is loud and nearly still when it isn't.
import { clamp, clamp01, mulberry32 } from '../utils/math.js';
import { kickEnv } from '../world/MountainChoreo.js';

export const BEAT_ZOOM_MIN = 0.965;
export const BEAT_ZOOM_MAX_BASE = 1.12; // before fever's amplitude boost
const FEVER_AMP_GAIN = 0.5;

export const FIGURES = Object.freeze(['breath', 'swell', 'snap', 'dive']);

const ATTACK_TAU_SEC = 0.10;  // how fast the displayed value chases a rising target
const RELEASE_TAU_SEC = 0.45; // ...and a falling one -- slower, so it never snaps back

const SNAP_GAIN = 0.035;
const DIVE_RISE_BEATS = 2;
const DIVE_GAIN = 0.11;
const DIVE_RELEASE_TAU_SEC = 1.4;
const SWELL_BARS = 4;
const SWELL_GAIN = 0.05;
const SWELL_RELEASE_BARS = 1;
const BREATH_GAIN = 0.015;

/** Which figure a phrase draws, weighted by its mood -- deterministic per
 *  (seed, phraseIdx) so a replay always breathes the same way. */
export function pickFigure(seed, phraseIdx, { calmLevel = 0, energetic = false, onDrop = false } = {}) {
  const rand = mulberry32((seed ^ (phraseIdx * 0x9e3779b1)) >>> 0)();
  if (onDrop) return 'dive';
  if (calmLevel > 0.5) return rand < 0.6 ? 'breath' : 'swell';
  if (energetic) return rand < 0.65 ? 'snap' : 'dive';
  return rand < 0.5 ? 'breath' : (rand < 0.8 ? 'swell' : 'snap');
}

export class BeatZoomDirector {
  constructor(songSeed = 1) {
    this.songSeed = songSeed;
    this.value = 1;
    this._figure = 'breath';
    this._lastPhraseIdx = -1;
    this._lastKickMs = -Infinity;
    this._lastKickVel = 0.8;
    this._diveStartMs = -Infinity;
    this._swellStartMs = -Infinity;
    this._beatPeriodMs = 500;
  }

  /** @param tMs the kick's own exact onset time (not the caller's sim
   *   "now") -- same anchoring discipline as JumpController.onKick, so the
   *   kickEnv-driven snap pulse starts from the true musical instant. */
  onKick(vel = 0.8, tMs = 0) {
    this._lastKickMs = tMs;
    this._lastKickVel = vel;
  }

  onDrop(nowMs) {
    this._figure = 'dive';
    this._diveStartMs = nowMs;
  }

  update(nowMs, dtSec, {
    phraseIdx = 0, barPhase01 = 0, calmLevel = 0, hypeFast = 0, hypeSlow = 0,
    beatPeriodMs = 500, adaptEnv = 0,
  } = {}) {
    this._nowMs = nowMs;
    this._beatPeriodMs = beatPeriodMs;
    if (phraseIdx !== this._lastPhraseIdx) {
      this._lastPhraseIdx = phraseIdx;
      const energetic = hypeFast > 0.5;
      const fig = pickFigure(this.songSeed, phraseIdx, { calmLevel, energetic });
      this._figure = fig;
      if (fig === 'swell') this._swellStartMs = nowMs;
    }

    let rawOffset = 0;
    switch (this._figure) {
      case 'breath':
        // Phase-locked to the bar (not wall-clock) so the inhale always
        // peaks on the downbeat -- the same reason the mountains' own
        // groove wave is driven off strip-space position, not time alone.
        rawOffset = BREATH_GAIN * Math.sin(2 * Math.PI * barPhase01);
        break;
      case 'swell': {
        const riseMs = SWELL_BARS * this._beatPeriodMs * 4;
        const releaseMs = SWELL_RELEASE_BARS * this._beatPeriodMs * 4;
        const age = nowMs - this._swellStartMs;
        if (age < riseMs) rawOffset = SWELL_GAIN * (age / riseMs);
        else rawOffset = SWELL_GAIN * Math.max(0, 1 - (age - riseMs) / releaseMs);
        break;
      }
      case 'snap':
        // Borrows the mountains' own kick-bounce shape (kickEnv: a 40ms
        // rise, ~180ms exponential settle) instead of an instant step, so
        // the frame pulses in the same choreography as the world does.
        rawOffset = SNAP_GAIN * kickEnv(nowMs - this._lastKickMs) * this._lastKickVel;
        break;
      case 'dive': {
        const riseMs = DIVE_RISE_BEATS * this._beatPeriodMs;
        const age = nowMs - this._diveStartMs;
        if (age >= 0 && age < riseMs) rawOffset = DIVE_GAIN * (age / riseMs);
        else if (age >= riseMs) {
          const releaseAge = (age - riseMs) / 1000;
          rawOffset = DIVE_GAIN * Math.exp(-releaseAge / DIVE_RELEASE_TAU_SEC);
        }
        break;
      }
      default:
        rawOffset = 0;
    }

    // Energy-gate: quiet passages barely move, loud ones visibly breathe --
    // amplitude tracking the music is itself what reads as intentional
    // rather than a random jitter. Ducks further while the Lens is
    // adapting back to neutral, so that longer morph stays clean.
    const energyGate = 0.35 + 0.65 * clamp01(hypeSlow);
    const adaptDuck = 1 - 0.5 * clamp01(adaptEnv);
    const ampMul = (1 + FEVER_AMP_GAIN * clamp01(this._fever || 0)) * energyGate * adaptDuck;

    const maxAmp = (BEAT_ZOOM_MAX_BASE - 1) * ampMul;
    const minAmp = -(1 - BEAT_ZOOM_MIN) * ampMul;
    const targetOffset = clamp(rawOffset * ampMul, minAmp, maxAmp);
    const targetValue = 1 + targetOffset;

    // Two-rate ease: quick to rise into a figure's motion, slower to
    // settle back out of it -- the same attack/release asymmetry real
    // camera work uses, and what keeps every discontinuity above (figure
    // switches, kick onsets, dive starts) from ever reaching the screen.
    const tau = targetValue > this.value ? ATTACK_TAU_SEC : RELEASE_TAU_SEC;
    this.value += (1 - Math.exp(-dtSec / tau)) * (targetValue - this.value);
  }

  /** Fever's own amplitude boost, set externally each step (mirrors how
   *  MountainChoreo/GroundField take fever). */
  set fever(v) { this._fever = v; }
}
