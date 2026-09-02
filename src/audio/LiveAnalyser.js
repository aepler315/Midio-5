// Listening instead of reading.
//
// Everything else in this engine analyses a whole file: it has the entire
// buffer before the first frame, so it can find sections, build an arc, and
// know where the climax is. That is a luxury, and it is the reason a dropped
// song feels composed rather than merely reactive.
//
// It is also unavailable to a phone. Spotify's audio is DRM'd and its
// analysis API 403s for new apps; a YouTube embed is cross-origin, so not one
// sample of it is readable; and tab-audio capture -- the desktop answer --
// does not exist on mobile at all. What every phone DOES have is a
// microphone. The speaker is already playing the song. So the page listens.
//
// That means the engine has to work without knowing the future, and this
// module is the adapter that makes it possible. It presents the same surface
// the offline path does -- band energies, a tempo, a beat grid, sections --
// but every one of them is an estimate over what has been HEARD so far,
// improving as the song goes on:
//
//   BANDS are immediate. An FFT frame is an FFT frame; nothing about the
//   seven-band split needs foreknowledge.
//
//   TEMPO comes from autocorrelating the onset envelope over a rolling
//   window. It is wrong for the first few seconds and then locks.
//
//   SECTIONS are the hard one, and they are found by NOTICING rather than by
//   planning: a long-window running mean of the band vector, compared
//   against the recent one, marks a boundary when the two diverge and stay
//   diverged. The offline path can see a chorus coming; this one recognises
//   that one has arrived. It is the honest version of the same idea, and it
//   is a bar or so late by construction -- there is no way around that
//   without knowing the future.
//
// Pure DSP over plain arrays. No Web Audio, no DOM: the caller pumps
// frequency frames in and reads state out, so all of this is testable in
// node without a browser. LiveInput.js owns the getUserMedia half.
import { clamp01 } from '../utils/math.js';
import { BANDS } from './bands.js';

// Seven bands, matching the offline analyser's split so everything
// downstream reads the same shape. Derived from BANDS rather than restated:
// every weight vector in the engine (RABID_WEIGHTS, ONSET_WEIGHTS) is indexed
// by that table, so a live split that merely LOOKED similar would quietly
// feed "presence" energy into the slot tuned for bass.
export const BAND_EDGES_HZ = [BANDS[0][0], ...BANDS.map((b) => b[1])];

// Rolling windows, in analysis frames (~60/s at a typical rAF cadence).
const ONSET_HISTORY = 512;   // ~8.5s -- enough for tempo autocorrelation
const SHORT_MEAN = 24;       // ~0.4s -- "what is happening now"
const LONG_MEAN = 480;       // ~8s   -- "what this section has been"
// Tempo search range. Wider than most music needs, so a half/double-time
// read has somewhere to land rather than being clamped into a wrong answer.
const MIN_BPM = 60, MAX_BPM = 190;
// A boundary needs the short and long means to stay apart this long, so a
// single loud bar is not a section.
const BOUNDARY_SUSTAIN_FRAMES = 45; // ~0.75s
// ...and to be at least this far apart, relative to the long-run spread.
const BOUNDARY_DIVERGENCE = 0.42;
// Sections cannot be shorter than this -- the same floor the offline
// scheduler uses, for the same reason: nothing downstream can express a
// two-second section.
const MIN_SECTION_MS = 9000;

/** Split one FFT magnitude frame into the seven band energies. */
export function bandEnergies(magnitudes, sampleRate, fftSize) {
  const out = new Array(7).fill(0);
  if (!magnitudes || !magnitudes.length) return out;
  const nyquist = sampleRate / 2;
  const binHz = nyquist / magnitudes.length;
  const counts = new Array(7).fill(0);
  for (let i = 0; i < magnitudes.length; i++) {
    const hz = i * binHz;
    let b = 0;
    while (b < 6 && hz >= BAND_EDGES_HZ[b + 1]) b++;
    out[b] += magnitudes[i];
    counts[b]++;
  }
  for (let b = 0; b < 7; b++) if (counts[b] > 0) out[b] /= counts[b];
  return out;
}

/**
 * Spectral flux: how much the spectrum GREW since the last frame.
 *
 * Rectified on purpose -- only increases count. A note starting is an onset;
 * a note stopping is not, and counting both would double the apparent event
 * rate and halve every tempo estimate.
 */
export function spectralFlux(now, prev) {
  if (!prev || !now) return 0;
  let sum = 0;
  const n = Math.min(now.length, prev.length);
  for (let i = 0; i < n; i++) {
    const d = now[i] - prev[i];
    if (d > 0) sum += d;
  }
  return sum;
}

/**
 * Estimate tempo by autocorrelating an onset envelope.
 *
 * @param {ArrayLike<number>} onsets rolling onset strengths, oldest first
 * @param {number} frameHz how many frames per second the envelope was
 *   sampled at -- the whole answer scales with this, so it is required
 *   rather than assumed
 * @returns {{bpm:number, confidence:number}} bpm 0 when there is not enough
 *   evidence yet; confidence is the peak's height over the mean, squashed
 *   to 0..1
 */
export function estimateTempo(onsets, frameHz) {
  const n = onsets ? onsets.length : 0;
  if (n < 64 || !(frameHz > 0)) return { bpm: 0, confidence: 0 };
  let mean = 0;
  for (let i = 0; i < n; i++) mean += onsets[i];
  mean /= n;
  // Mean-removed autocorrelation: without this a loud passage correlates
  // with itself at every lag and the peak is meaningless.
  const lagMin = Math.max(1, Math.floor((60 / MAX_BPM) * frameHz));
  const lagMax = Math.min(n - 1, Math.ceil((60 / MIN_BPM) * frameHz));
  if (lagMax <= lagMin) return { bpm: 0, confidence: 0 };
  let best = -Infinity, bestLag = 0, sum = 0, count = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let acc = 0;
    for (let i = lag; i < n; i++) acc += (onsets[i] - mean) * (onsets[i - lag] - mean);
    acc /= (n - lag);
    sum += acc; count++;
    if (acc > best) { best = acc; bestLag = lag; }
  }
  if (bestLag <= 0 || count === 0) return { bpm: 0, confidence: 0 };
  const avg = sum / count;
  const spread = Math.abs(best - avg);
  const bpm = (60 * frameHz) / bestLag;
  // Confidence as how far the winning lag stands above the average lag,
  // normalised by the winner itself so it is scale-free.
  const confidence = clamp01(spread / Math.max(1e-9, Math.abs(best)));
  return { bpm, confidence };
}

/**
 * The live analyser.
 *
 * Pump `push(magnitudes, nowMs)` once per rendered frame; read `bands`,
 * `bpm`, `energy01`, `onset`, and `sectionJustChanged` off it. Nothing here
 * blocks or allocates per frame beyond the band array.
 */
export class LiveAnalyser {
  constructor({ sampleRate = 48000, fftSize = 2048 } = {}) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.bands = new Array(7).fill(0);
    this.energy01 = 0;
    this.onset = 0;
    this.bpm = 0;
    this.tempoConfidence = 0;
    /** One-frame flag, same contract BiomeManager's own already has. */
    this.sectionJustChanged = false;
    this.sectionCount = 0;
    this.sectionStartMs = 0;

    this._prevBands = null;
    this._onsets = [];
    this._short = new Array(7).fill(0);
    this._long = new Array(7).fill(0);
    this._warm = 0;
    this._divergedFrames = 0;
    this._seeded = false;
    this._lastMs = null;
    this._frameHz = 60;
    // Running peak, so `energy01` is relative to THIS source's level rather
    // than to an absolute that depends on how loud the room is.
    this._peak = 1e-6;
  }

  /** The loudest thing heard so far, in the same units as the band mean.
   *  Published because the silence check (LiveInput.looksLikeSilence) needs
   *  an absolute level -- `energy01` is relative to this peak, so it reads
   *  high in a silent room, which is exactly backwards for that question. */
  get peak() { return this._peak; }

  /** @returns {boolean} whether a section boundary was crossed this frame. */
  push(magnitudes, nowMs) {
    this.sectionJustChanged = false;
    if (this._lastMs != null) {
      const dt = nowMs - this._lastMs;
      // Track the real frame rate: tempo depends on it, and a dropped frame
      // or a background tab would otherwise skew the estimate silently.
      if (dt > 1 && dt < 500) this._frameHz = this._frameHz * 0.9 + (1000 / dt) * 0.1;
    }
    this._lastMs = nowMs;

    const bands = bandEnergies(magnitudes, this.sampleRate, this.fftSize);
    this.onset = spectralFlux(bands, this._prevBands);
    this._prevBands = bands;
    this.bands = bands;

    let total = 0;
    for (const b of bands) total += b;
    total /= 7;
    if (total > this._peak) this._peak = total;
    else this._peak = Math.max(1e-6, this._peak * 0.99995); // slow decay tracks a fade-out
    this.energy01 = clamp01(total / this._peak);

    this._onsets.push(this.onset);
    if (this._onsets.length > ONSET_HISTORY) this._onsets.shift();

    // Tempo: recomputed occasionally rather than every frame. The
    // autocorrelation is O(window * lags) and the answer does not change
    // meaningfully in 16ms.
    this._warm++;
    if (this._warm % 30 === 0) {
      const { bpm, confidence } = estimateTempo(this._onsets, this._frameHz);
      if (bpm > 0) {
        // Ease rather than jump: a tempo estimate that flickers between
        // half and double time would shake every beat-quantized thing in
        // the show. A confident reading moves it faster.
        const k = 0.15 + 0.5 * confidence;
        this.bpm = this.bpm > 0 ? this.bpm + (bpm - this.bpm) * k : bpm;
        this.tempoConfidence = confidence;
      }
    }

    this._updateSections(bands, nowMs);
    return this.sectionJustChanged;
  }

  /**
   * Notice that a section has arrived.
   *
   * A short running mean is "what is happening now"; a long one is "what this
   * section has been". When they diverge and STAY diverged, the material has
   * changed. This cannot anticipate a boundary the way the offline scheduler
   * does -- it is a bar or so late by construction, because the evidence does
   * not exist until the new material has played. That is the honest cost of
   * listening rather than reading, and pretending otherwise would mean firing
   * on a single loud bar.
   */
  _updateSections(bands, nowMs) {
    // Seed both means from the first frame heard. Starting them at zero
    // gives a warm-up transient -- the short mean converges in ~0.4s and the
    // long one in ~8s, so for several seconds they differ enormously for no
    // musical reason at all, and that difference reads as a boundary. The
    // opening of every song fired a spurious section. Seeding removes the
    // transient rather than trying to outwait it with a frame-count guard,
    // which is a tuning number that would go wrong the moment the window
    // lengths changed.
    if (!this._seeded) {
      for (let i = 0; i < 7; i++) { this._short[i] = bands[i]; this._long[i] = bands[i]; }
      this._seeded = true;
      this.sectionStartMs = nowMs;
      return;
    }
    const kShort = 1 / SHORT_MEAN, kLong = 1 / LONG_MEAN;
    let diverge = 0, scale = 0;
    for (let i = 0; i < 7; i++) {
      this._short[i] += (bands[i] - this._short[i]) * kShort;
      this._long[i] += (bands[i] - this._long[i]) * kLong;
      diverge += (this._short[i] - this._long[i]) ** 2;
      scale += this._long[i] ** 2;
    }
    diverge = Math.sqrt(diverge);
    scale = Math.sqrt(scale);
    // Relative to the section's own level, so a quiet passage's change counts
    // as much as a loud one's.
    const rel = diverge / Math.max(1e-6, scale);

    // Still don't judge on the first moments: seeded or not, a couple of
    // frames is not evidence of anything.
    if (this._warm < SHORT_MEAN * 4) return;
    if (rel > BOUNDARY_DIVERGENCE) this._divergedFrames++;
    else this._divergedFrames = 0;

    if (this._divergedFrames < BOUNDARY_SUSTAIN_FRAMES) return;
    if (nowMs - this.sectionStartMs < MIN_SECTION_MS) return;

    this.sectionJustChanged = true;
    this.sectionCount++;
    this.sectionStartMs = nowMs;
    this._divergedFrames = 0;
    // The new section starts from what it actually sounds like, not from a
    // long mean still full of the previous one -- otherwise the next boundary
    // fires early off stale evidence.
    for (let i = 0; i < 7; i++) this._long[i] = this._short[i];
  }
}
