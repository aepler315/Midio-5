// The energy curves, filled in as the song happens rather than before it.
//
// `EnergyCurves` is the widest seam in the engine: BiomeManager, Broshi's
// rabid gate, CalmDirector, the swarm, the ribbon, the reaction-diffusion
// field -- all of them ask it `sample(band, ms)` / `globalEnergyNorm(ms)` and
// none of them care where the numbers came from. So live listening does not
// need a parallel visual pipeline; it needs this one object to keep answering
// the same questions from a microphone.
//
// Two things had to change to make that honest:
//
//   WRITING FORWARD. The offline builder fills every frame before anything
//   samples. Here frames arrive one at a time, at whatever rate the browser
//   renders, and queries land on times that have only just been written. So
//   `writeAt` fills the whole gap since the last write rather than a single
//   frame -- a dropped frame or a 250ms hitch would otherwise leave a trench
//   of zeros in the curve that reads downstream as a sudden silence.
//
//   PERCENTILES OF WHAT HAS BEEN HEARD. `calibration()` is the reason
//   `globalEnergyNorm` means the same thing on a quiet folk record and a
//   brickwalled master: it maps the song's own p10..p90 onto a fixed span.
//   The base class computes that once over the finished song and caches it;
//   here the song is not finished, and the base class's cache is invalidated
//   by every `setFrame`, which would mean a full sort of the whole buffer on
//   every rendered frame. So this recomputes on a slow cadence, over only the
//   span actually heard so far -- the answer moves as the song reveals its
//   own dynamic range, which is the correct behaviour anyway.
import { EnergyCurves } from './EnergyCurves.js';
import { BANDS } from './bands.js';
import { clamp } from '../utils/math.js';

/** How often the p10/p90 calibration is recomputed, in milliseconds. The
 *  percentiles of a song do not move meaningfully faster than this, and the
 *  sort is O(n log n) over everything heard so far. */
export const CALIBRATION_INTERVAL_MS = 1500;
/** Until this much has been heard, there is no dynamic range to speak of and
 *  a percentile stretch would amplify the room's noise floor into structure. */
export const CALIBRATION_WARMUP_MS = 4000;
/** Frames of "hold forward" written past the current one. Consumers do not
 *  all sample at exactly the time the frame was written -- the fixed-step
 *  integrator can be a step or two ahead of the last pump, and a query past
 *  the written frontier would otherwise read a hard zero, which downstream
 *  is indistinguishable from the song stopping dead. Held, never counted:
 *  `writtenTo` stays at what was actually heard, so the calibration is not
 *  fed frames nobody listened to. */
const HOLD_AHEAD_FRAMES = 8;

export class LiveEnergyCurves extends EnergyCurves {
  constructor(durationMs, rateHz = 50) {
    super(durationMs, rateHz);
    /** Highest frame index written so far; the calibration only looks here. */
    this.writtenTo = -1;
    this._liveCal = new Map();
    this._calAtMs = -Infinity;
    this._lastMs = 0;
  }

  /**
   * Write one heard frame, filling any gap since the previous write.
   *
   * @param {number} tMs song-relative time of this frame
   * @param {number[]} bands seven band energies, 0..1
   */
  writeAt(tMs, bands) {
    const idx = Math.round(clamp((tMs / 1000) * this.rateHz, 0, this.n - 1));
    // Hold the new value backward across the gap rather than interpolating
    // from the old one: the frames in between were never heard, and a ramp
    // would invent a crescendo that did not happen.
    const from = this.writtenTo < 0 ? idx : Math.min(idx, this.writtenTo + 1);
    const to = Math.min(this.n - 1, idx + HOLD_AHEAD_FRAMES);
    for (let i = from; i <= to; i++) {
      for (let b = 0; b < BANDS.length; b++) this.bands[b][i] = bands[b] || 0;
    }
    if (idx > this.writtenTo) this.writtenTo = idx;
    this._lastMs = tMs;
  }

  /** Has anything been heard yet? Before this, every sample is a zero and
   *  callers that can wait should. */
  get hasSignal() { return this.writtenTo >= 0; }

  /**
   * p10/p90 over what has been heard, recomputed on a slow cadence.
   *
   * Overrides the base class rather than extending it: the base cache is
   * cleared by every write, and a full sort per rendered frame is the one
   * thing that would make live listening cost more than the show it drives.
   */
  calibration(weights) {
    const w = weights || [1, 1, 1, 1, 1, 1, 1];
    const key = w.join(',');
    const hit = this._liveCal.get(key);
    const due = this._lastMs - this._calAtMs >= CALIBRATION_INTERVAL_MS;
    if (hit && !due) return hit;
    // Nothing heard, or not enough of it: a zero spread makes
    // globalEnergyNorm fall through to the raw absolute value, which is
    // exactly the right behaviour before there is a range to speak of.
    if (this.writtenTo < 1 || this._lastMs < CALIBRATION_WARMUP_MS) {
      const cold = { lo: 0, hi: 0, spread: 0 };
      this._liveCal.set(key, cold);
      return cold;
    }
    let wsum = 0;
    for (let b = 0; b < BANDS.length; b++) wsum += w[b];
    const count = this.writtenTo + 1;
    const vals = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let b = 0; b < BANDS.length; b++) sum += w[b] * this.bands[b][i];
      vals[i] = wsum > 0 ? sum / wsum : 0;
    }
    vals.sort();
    const at = (p) => vals[clamp(Math.round(p * (count - 1)), 0, count - 1)];
    const lo = at(0.10);
    const hi = at(0.90);
    const cal = { lo, hi, spread: Math.max(0, hi - lo) };
    this._liveCal.set(key, cal);
    this._calAtMs = this._lastMs;
    return cal;
  }
}
