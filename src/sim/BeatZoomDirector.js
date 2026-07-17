// The beat zoom: an automatic, music-driven camera breathing on top of
// everything else (the player's own Lens zoom, camera shake/punch). It
// picks a new "figure" -- a shape of motion, not just an amplitude -- at
// every phrase boundary, weighted by the section's mood: calm phrases get
// slow, subtle breathing or a long swell; energetic phrases get a sharp
// kick-synced snap, or, right on a drop, the big dramatic dive. Never
// touches ZoomDirector (the player's lens) or camera shake/punch --
// composed multiplicatively alongside them in Renderer.
import { clamp01, mulberry32 } from '../utils/math.js';

export const BEAT_ZOOM_MIN = 0.965;
export const BEAT_ZOOM_MAX_BASE = 1.12; // before fever's amplitude boost
const FEVER_AMP_GAIN = 0.5;

export const FIGURES = Object.freeze(['breath', 'swell', 'snap', 'dive']);

const SNAP_DECAY_TAU_SEC = 0.18;
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
    this._figureStartMs = 0;
    this._lastPhraseIdx = -1;
    this._snap = 0; // exponential kick-snap envelope
    this._diveStartMs = -Infinity;
    this._swellStartMs = -Infinity;
    this._beatPeriodMs = 500;
  }

  onKick() {
    if (this._figure === 'snap') this._snap = 1;
  }

  onDrop(nowMs) {
    this._figure = 'dive';
    this._diveStartMs = nowMs;
  }

  update(nowMs, dtSec, { phraseIdx = 0, calmLevel = 0, hypeFast = 0, beatPeriodMs = 500 } = {}) {
    this._beatPeriodMs = beatPeriodMs;
    if (phraseIdx !== this._lastPhraseIdx) {
      this._lastPhraseIdx = phraseIdx;
      const energetic = hypeFast > 0.5;
      const fig = pickFigure(this.songSeed, phraseIdx, { calmLevel, energetic });
      this._figure = fig;
      this._figureStartMs = nowMs;
      if (fig === 'swell') this._swellStartMs = nowMs;
    }

    this._snap = Math.max(0, this._snap - dtSec / SNAP_DECAY_TAU_SEC);

    const ampMul = 1 + FEVER_AMP_GAIN * clamp01(this._fever || 0);
    const tSec = nowMs / 1000;
    let offset = 0;
    switch (this._figure) {
      case 'breath': {
        const hz = 1000 / (this._beatPeriodMs * 4); // one slow breath per bar
        offset = BREATH_GAIN * Math.sin(2 * Math.PI * hz * tSec);
        break;
      }
      case 'swell': {
        const riseMs = SWELL_BARS * this._beatPeriodMs * 4;
        const releaseMs = SWELL_RELEASE_BARS * this._beatPeriodMs * 4;
        const age = nowMs - this._swellStartMs;
        if (age < riseMs) offset = SWELL_GAIN * (age / riseMs);
        else offset = SWELL_GAIN * Math.max(0, 1 - (age - riseMs) / releaseMs);
        break;
      }
      case 'snap':
        offset = SNAP_GAIN * this._snap;
        break;
      case 'dive': {
        const riseMs = DIVE_RISE_BEATS * this._beatPeriodMs;
        const age = nowMs - this._diveStartMs;
        if (age >= 0 && age < riseMs) offset = DIVE_GAIN * (age / riseMs);
        else if (age >= riseMs) {
          const releaseAge = (age - riseMs) / 1000;
          offset = DIVE_GAIN * Math.exp(-releaseAge / DIVE_RELEASE_TAU_SEC);
        }
        break;
      }
      default:
        offset = 0;
    }

    const maxAmp = (BEAT_ZOOM_MAX_BASE - 1) * ampMul;
    offset = Math.max(-(1 - BEAT_ZOOM_MIN), Math.min(maxAmp, offset * ampMul));
    this.value = 1 + offset;
  }

  /** Fever's own amplitude boost, set externally each step (mirrors how
   *  MountainChoreo/GroundField take fever). */
  set fever(v) { this._fever = v; }
}
