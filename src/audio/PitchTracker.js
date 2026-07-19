// Real pitch analysis for raw audio (the audio->MIDI parity pass). The old
// pseudo-lanes fabricated "pitch" from a 3-band energy centroid, which fed
// garbage into every pitch consumer downstream -- Midasus's vertical dance,
// Broshi's hop heights, VibeDirector's tonality/valence, KeyDirector's key
// changes, and the custom-biome fingerprint's dominant-pitch-class hue.
// This module extracts genuine pitch from the samples themselves:
//
//   - a semitone spectrogram (energy per MIDI note 36..95, via FFT with the
//     per-note energy taken as the max magnitude across that note's
//     frequency band), from which melody pitches and a chromagram fall out;
//   - time-domain autocorrelation for bass fundamentals (FFT bins are far
//     too coarse below ~100 Hz to separate semitones);
//   - tonality (tonic + major/minor balance) from the folded chroma, using
//     the exact third-balance formula VibeDirector applies at runtime;
//   - spectral brightness (log-frequency centroid) as a per-song feature.
//
// Pure numeric on Float32Arrays -- no DOM/AudioContext -- so node --test
// can exercise it against synthesized sines directly.
import { clamp, clamp01 } from '../utils/math.js';

export const SEMITONE_LO = 36; // C2
export const SEMITONE_HI = 95; // B6
const SEMITONE_COUNT = SEMITONE_HI - SEMITONE_LO + 1;

const DEFAULT_WIN = 4096;
const DEFAULT_HOP = 2048;

const BRIGHT_LO_HZ = 50, BRIGHT_HI_HZ = 8000;

export function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** In-place iterative radix-2 FFT. re/im must be power-of-two length. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

/**
 * Semitone spectrogram + per-frame brightness from a mono sample buffer.
 * Each frame holds energy per MIDI note SEMITONE_LO..SEMITONE_HI. Energy
 * is assigned only at spectral PEAKS (local maxima, frequency refined by
 * parabolic interpolation) rather than by band-maxing every bin: FFT
 * leakage from a strong tone smears into the adjacent semitone's band --
 * C bleeding into C# is literally A-minor's major third, so band-maxing
 * corrupts every downstream tonality read. Leakage bins are never local
 * maxima, so peak-picking keeps the chroma clean for free.
 *
 * @returns {{ rate: number, frames: Float32Array[], brightness: Float32Array }}
 */
export function computePitchFeatures(mono, sampleRate, { win = DEFAULT_WIN, hop = DEFAULT_HOP } = {}) {
  const numFrames = Math.max(1, Math.floor((mono.length - win) / hop) + 1);
  const rate = sampleRate / hop;

  const hann = new Float32Array(win);
  for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1));

  const binHz = sampleRate / win;
  const loHz = midiToHz(SEMITONE_LO) * 2 ** (-0.5 / 12);
  const hiHz = midiToHz(SEMITONE_HI) * 2 ** (0.5 / 12);
  const scanLo = Math.max(2, Math.floor(loHz / binHz));
  const scanHi = Math.min(win / 2 - 2, Math.ceil(hiHz / binHz));
  const brightLoBin = Math.max(1, Math.round(BRIGHT_LO_HZ / binHz));
  const brightHiBin = Math.min(win / 2 - 1, Math.round(BRIGHT_HI_HZ / binHz));

  const frames = [];
  const brightness = new Float32Array(numFrames);
  const re = new Float32Array(win), im = new Float32Array(win);
  const mag = new Float32Array(win / 2);

  for (let f = 0; f < numFrames; f++) {
    const start = f * hop;
    for (let i = 0; i < win; i++) {
      re[i] = (mono[start + i] || 0) * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 1; b < win / 2; b++) mag[b] = Math.hypot(re[b], im[b]);

    let frameMax = 0;
    for (let b = scanLo; b <= scanHi; b++) if (mag[b] > frameMax) frameMax = mag[b];
    const floor = frameMax * 0.02;

    const semis = new Float32Array(SEMITONE_COUNT);
    for (let b = scanLo; b <= scanHi; b++) {
      if (mag[b] <= floor || mag[b] < mag[b - 1] || mag[b] < mag[b + 1]) continue;
      // Parabolic refinement of the peak's true frequency between bins.
      const a = mag[b - 1], c0 = mag[b], c = mag[b + 1];
      const denom = a - 2 * c0 + c;
      const delta = Math.abs(denom) > 1e-12 ? clamp(0.5 * (a - c) / denom, -0.5, 0.5) : 0;
      const hz = (b + delta) * binHz;
      const midi = Math.round(69 + 12 * Math.log2(hz / 440));
      const idx = midi - SEMITONE_LO;
      if (idx >= 0 && idx < SEMITONE_COUNT && c0 > semis[idx]) semis[idx] = c0;
    }
    frames.push(semis);

    // Log-frequency spectral centroid, normalized 0..1 over 50Hz..8kHz.
    let num = 0, den = 0;
    for (let b = brightLoBin; b <= brightHiBin; b++) { num += b * binHz * mag[b]; den += mag[b]; }
    if (den > 1e-9) {
      const centroidHz = num / den;
      brightness[f] = clamp01(Math.log2(centroidHz / BRIGHT_LO_HZ) / Math.log2(BRIGHT_HI_HZ / BRIGHT_LO_HZ));
    }
  }

  return { rate, frames, brightness };
}

/** Fold the whole spectrogram (energy-weighted) into a 12-bin chroma histogram. */
export function chromaHistogram(features) {
  const hist = new Array(12).fill(0);
  for (const semis of features.frames) {
    for (let m = 0; m < semis.length; m++) hist[(SEMITONE_LO + m) % 12] += semis[m];
  }
  return hist;
}

/**
 * Melody pitch at a moment: argmax semitone (within [loMidi, hiMidi])
 * averaged over the ~120ms after the onset. Returns null when the range
 * holds essentially no energy (silence / percussion-only moment), so the
 * caller can keep its fallback.
 */
export function melodyPitchAt(features, tMs, { loMidi = 52, hiMidi = SEMITONE_HI, spanMs = 120 } = {}) {
  const f0 = Math.max(0, Math.floor((tMs / 1000) * features.rate));
  const f1 = Math.min(features.frames.length - 1, Math.ceil(((tMs + spanMs) / 1000) * features.rate));
  if (f0 >= features.frames.length) return null;

  const lo = Math.max(0, loMidi - SEMITONE_LO);
  const hi = Math.min(SEMITONE_COUNT - 1, hiMidi - SEMITONE_LO);
  let bestIdx = -1, bestE = 0, totalE = 0;
  for (let m = lo; m <= hi; m++) {
    let e = 0;
    for (let f = f0; f <= f1; f++) e += features.frames[f][m];
    totalE += e;
    if (e > bestE) { bestE = e; bestIdx = m; }
  }
  if (bestIdx < 0 || bestE < 1e-6 || bestE < totalE * 0.04) return null;
  return SEMITONE_LO + bestIdx;
}

/**
 * Bass fundamental at a moment via normalized time-domain autocorrelation
 * over a ~2048-sample window -- FFT semitone bands below ~100 Hz are wider
 * than a semitone, so the spectrogram can't resolve bass lines. Returns a
 * MIDI pitch clamped to [loMidi, hiMidi], or null when no periodicity
 * clears the confidence floor (silence, pure noise, a kick thump).
 */
export function estimateBassPitchAt(mono, sampleRate, tMs, { loMidi = 28, hiMidi = 52, winLen = 2048 } = {}) {
  const start = Math.max(0, Math.round((tMs / 1000) * sampleRate));
  if (start + winLen > mono.length) return null;

  let r0 = 0;
  for (let i = 0; i < winLen; i++) r0 += mono[start + i] * mono[start + i];
  if (r0 < 1e-8) return null;

  const lagMin = Math.max(2, Math.floor(sampleRate / midiToHz(hiMidi)));
  const lagMax = Math.min(winLen - 1, Math.ceil(sampleRate / midiToHz(loMidi)));
  let bestLag = 0, bestR = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let r = 0;
    for (let i = 0; i + lag < winLen; i++) r += mono[start + i] * mono[start + i + lag];
    const norm = r / r0;
    if (norm > bestR) { bestR = norm; bestLag = lag; }
  }
  if (bestR < 0.25 || bestLag === 0) return null;

  const hz = sampleRate / bestLag;
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return clamp(midi, loMidi, hiMidi);
}

// Krumhansl-Kessler key profiles: how strongly each scale degree implies a
// major/minor key. The 24-key template match below is what lets a bare
// A-minor triad read as A minor instead of "C major missing its fifth" --
// a naive argmax tonic can't tell relative major/minor pairs apart.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * Tonality from a 12-bin chroma histogram. The tonic and mode come from a
 * 24-key Krumhansl template match; `majorness` is then the third-balance
 * at that tonic (the same formula VibeDirector applies live), which stays
 * continuous for real songs instead of a hard binary mode flag.
 * @returns {{ tonic: number, mode: 'major'|'minor', majorness: number, confidence: number }}
 *   majorness in [-1, 1]: +1 firmly major, -1 firmly minor.
 */
export function tonalityFrom(hist) {
  let total = 0;
  for (const v of hist) total += v;
  if (total < 1e-9) return { tonic: 0, mode: 'major', majorness: 0, confidence: 0 };

  let best = { tonic: 0, mode: 'major', score: -Infinity };
  let secondScore = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, tpl] of [['major', KK_MAJOR], ['minor', KK_MINOR]]) {
      let score = 0;
      for (let d = 0; d < 12; d++) score += hist[(tonic + d) % 12] * tpl[d];
      if (score > best.score) { secondScore = best.score; best = { tonic, mode, score }; }
      else if (score > secondScore) { secondScore = score; }
    }
  }

  const M = hist[(best.tonic + 4) % 12], m = hist[(best.tonic + 3) % 12];
  const majorness = clamp((M - m) / (M + m + 1e-6), -1, 1);
  const confidence = Number.isFinite(secondScore)
    ? clamp01((best.score - secondScore) / (Math.abs(best.score) + 1e-6) * 6)
    : 1;
  return { tonic: best.tonic, mode: best.mode, majorness, confidence };
}

/** The brightness (log-frequency centroid, 0..1) around one moment --
 *  averaged over a short window so a single noisy frame can't flip a
 *  note's clean/lead casting verdict. */
export function brightnessAt(features, tMs, { spanMs = 120 } = {}) {
  const f0 = Math.max(0, Math.floor((tMs / 1000) * features.rate));
  const f1 = Math.min(features.brightness.length - 1, Math.ceil(((tMs + spanMs) / 1000) * features.rate));
  if (f0 >= features.brightness.length) return null;
  let sum = 0, n = 0;
  for (let f = f0; f <= f1; f++) { sum += features.brightness[f]; n++; }
  return n > 0 ? sum / n : null;
}

/** Energy-weighted mean of the per-frame brightness curve, 0..1. */
export function meanBrightness(features) {
  let num = 0, den = 0;
  for (let f = 0; f < features.frames.length; f++) {
    let e = 0;
    for (const v of features.frames[f]) e += v;
    num += features.brightness[f] * e;
    den += e;
  }
  return den > 1e-9 ? num / den : 0.5;
}

/**
 * Top-N chroma classes over a time window, for PAD chord synthesis: the
 * sustained harmonic content of a bar collapsed to its strongest pitch
 * classes. Returns [] when the window is essentially silent.
 */
export function windowChroma(features, fromMs, toMs, topN = 3) {
  const f0 = Math.max(0, Math.floor((fromMs / 1000) * features.rate));
  const f1 = Math.min(features.frames.length - 1, Math.floor((toMs / 1000) * features.rate));
  if (f1 < f0) return [];
  const hist = new Array(12).fill(0);
  let total = 0;
  for (let f = f0; f <= f1; f++) {
    const semis = features.frames[f];
    for (let m = 0; m < semis.length; m++) { hist[(SEMITONE_LO + m) % 12] += semis[m]; total += semis[m]; }
  }
  if (total < 1e-6) return [];
  const mean = total / 12;
  return hist
    .map((e, pc) => ({ pc, e }))
    .filter((c) => c.e > mean * 1.1) // only classes genuinely above the noise floor
    .sort((a, b) => b.e - a.e)
    .slice(0, topN)
    .map((c) => ({ pc: c.pc, strength: clamp01(c.e / (hist.reduce((a, b) => Math.max(a, b), 0) || 1)) }));
}
