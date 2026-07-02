// Continuous per-band energy signal, sampled at a fixed rate across the
// whole song and linearly interpolated at query time. This is the
// continuous counterpart to the discrete NoteEvent timeline — Broshi's
// frequency->anatomy mapping and the Rabid morph (spec §3.2) read raw
// band energy directly rather than discrete notes, and both the real
// audio pipeline (Stage 4) and the MIDI/demo synthesis path (spec's
// "MIDI and audio become indistinguishable downstream" philosophy)
// populate this same shape.
import { clamp } from '../utils/math.js';
import { BANDS, RABID_WEIGHTS } from './bands.js';

export class EnergyCurves {
  constructor(durationMs, rateHz = 50) {
    this.rateHz = rateHz;
    this.n = Math.max(2, Math.ceil((durationMs / 1000) * rateHz) + 1);
    this.bands = Array.from({ length: BANDS.length }, () => new Float32Array(this.n));
  }

  _indexAt(tMs) {
    return clamp((tMs / 1000) * this.rateHz, 0, this.n - 1);
  }

  sample(bandIndex, tMs) {
    const idx = this._indexAt(tMs);
    const i0 = Math.floor(idx);
    const i1 = Math.min(this.n - 1, i0 + 1);
    const f = idx - i0;
    const arr = this.bands[bandIndex];
    return arr[i0] * (1 - f) + arr[i1] * f;
  }

  sampleAll(tMs) {
    const out = new Array(BANDS.length);
    for (let b = 0; b < BANDS.length; b++) out[b] = this.sample(b, tMs);
    return out;
  }

  /** Weighted mean across bands — used for Broshi's Rabid gate (spec §3.2.3). */
  globalEnergy(tMs, weights = RABID_WEIGHTS) {
    let sum = 0, wsum = 0;
    for (let b = 0; b < BANDS.length; b++) {
      sum += weights[b] * this.sample(b, tMs);
      wsum += weights[b];
    }
    return wsum > 0 ? sum / wsum : 0;
  }

  /** Write a single sample frame — used by both the audio and synthesis builders. */
  setFrame(frameIndex, values) {
    for (let b = 0; b < BANDS.length; b++) this.bands[b][frameIndex] = values[b];
  }
}
