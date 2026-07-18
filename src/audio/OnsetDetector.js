// Per-band RMS envelopes, spectral-flux onset detection/classification, and
// BPM/phase estimation (spec §1.2.3-1.2.5). Pure numeric — operates on
// decoded AudioBuffers from the StemSeparator, no DOM/graphics dependency.
import { BANDS, ONSET_WEIGHTS } from './bands.js';
import { clamp } from '../utils/math.js';

const WIN = 1024, HOP = 512;
const MEDIAN_HALF_WINDOW = 43; // ~+-0.5s at ~86 frames/s
const MIN_ONSET_GAP_MS = 60;
const LOCAL_MAX_WINDOW_MS = 30;

/** Per-band RMS envelope at ~86 frames/s (44.1kHz/512). Mixes down to mono first. */
export function computeBandEnvelopes(stemBuffers) {
  const sampleRate = stemBuffers[0].sampleRate;
  const length = stemBuffers[0].length;
  const numFrames = Math.max(1, Math.floor((length - WIN) / HOP) + 1);
  const rate = sampleRate / HOP;

  const raw = stemBuffers.map((buf) => {
    const chans = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
    const env = new Float32Array(numFrames);
    for (let n = 0; n < numFrames; n++) {
      const start = n * HOP;
      let sum = 0;
      for (let k = 0; k < WIN; k++) {
        let s = 0;
        for (let c = 0; c < chans.length; c++) s += chans[c][start + k] || 0;
        s /= chans.length;
        sum += s * s;
      }
      env[n] = Math.sqrt(sum / WIN);
    }
    return env;
  });

  return { rate, numFrames, raw, sampleRate };
}

/** Slow-release running-max AGC normalization (spec §1.2.3): attack instant, release tau=4s. */
export function normalizeBands(raw, rate, tau = 4) {
  const release = Math.exp(-1 / (rate * tau));
  return raw.map((env) => {
    const norm = new Float32Array(env.length);
    let m = 1e-6;
    for (let n = 0; n < env.length; n++) {
      m = Math.max(env[n], m * release);
      norm[n] = env[n] / Math.max(m, 1e-6);
    }
    return norm;
  });
}

function positiveFlux(band) {
  const flux = new Float32Array(band.length);
  for (let i = 1; i < band.length; i++) flux[i] = Math.max(0, band[i] - band[i - 1]);
  return flux;
}

function weightedFluxSum(normBands, weights) {
  const n = normBands[0].length;
  const fluxes = normBands.map(positiveFlux);
  const O = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let b = 0; b < normBands.length; b++) s += weights[b] * fluxes[b][i];
    O[i] = s;
  }
  return O;
}

function medianAdaptiveThreshold(O, halfWindow, onsetThreshold) {
  const delta = 0.02 * onsetThreshold;
  const lambda = 1.6 * onsetThreshold;
  const n = O.length;
  const theta = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - halfWindow), hi = Math.min(n - 1, i + halfWindow);
    const window = Array.from(O.subarray(lo, hi + 1)).sort((a, b) => a - b);
    const med = window[Math.floor(window.length / 2)];
    theta[i] = delta + lambda * med;
  }
  return theta;
}

function pickPeaks(O, theta, rate, minGapMs = MIN_ONSET_GAP_MS, localWindowMs = LOCAL_MAX_WINDOW_MS) {
  const n = O.length;
  const localWin = Math.max(1, Math.round((localWindowMs / 1000) * rate));
  const minGapFrames = (minGapMs / 1000) * rate;
  const onsets = [];
  let lastFrame = -Infinity;
  for (let i = 0; i < n; i++) {
    if (O[i] <= theta[i]) continue;
    let isLocalMax = true;
    for (let k = Math.max(0, i - localWin); k <= Math.min(n - 1, i + localWin); k++) {
      if (O[k] > O[i]) { isLocalMax = false; break; }
    }
    if (!isLocalMax) continue;
    if (i - lastFrame < minGapFrames) continue;
    onsets.push(i);
    lastFrame = i;
  }
  return onsets;
}

/**
 * RHYTHM onsets classified into KICK/SNARE/HAT by band-energy dominance
 * (spec §1.2.4). Onset flux/threshold run on the AGC-normalized bands (loud
 * and quiet mixes drive the same detector identically), but "dominance"
 * must be judged on raw energy — per-band AGC deliberately erases each
 * band's absolute loudness, so a share computed from normalized values no
 * longer reflects true energy distribution (a mostly-silent band's noise
 * floor gets amplified to look as "loud" as a genuinely dominant one).
 */
export function detectRhythmOnsets(normBands, rawBands, rate, onsetThreshold = 1) {
  const O = weightedFluxSum(normBands, ONSET_WEIGHTS);
  const theta = medianAdaptiveThreshold(O, MEDIAN_HALF_WINDOW, onsetThreshold);
  const frames = pickPeaks(O, theta, rate);

  const values = frames.map((i) => O[i]).sort((a, b) => a - b);
  const p95 = values.length ? Math.max(1e-6, values[Math.min(values.length - 1, Math.floor(0.95 * values.length))]) : 1;

  const onsets = frames.map((i) => {
    let sum = 0;
    const e = new Array(rawBands.length);
    for (let b = 0; b < rawBands.length; b++) { e[b] = rawBands[b][i]; sum += e[b]; }
    const lowShare = sum > 0 ? (e[0] + e[1]) / sum : 0;
    const highShare = sum > 0 ? (e[5] + e[6]) / sum : 0;
    let type, pitch, kick = false;
    if (lowShare > 0.45) { type = 'KICK'; pitch = 36; kick = true; }
    else if (highShare > 0.40) { type = 'HAT'; pitch = 42; }
    else { type = 'SNARE'; pitch = 38; }
    return { frame: i, tMs: (i / rate) * 1000, type, pitch, kick, vel: clamp(O[i] / p95, 0, 1) };
  });

  return { O, onsets };
}

/** r-hat(tau) for an arbitrary lag, used both inside the search window and for harmonic disambiguation. */
function correlationAt(Obar, r0, tau) {
  const n = Obar.length;
  if (tau < 1 || tau >= n) return -1;
  let r = 0;
  for (let i = 0; i + tau < n; i++) r += Obar[i] * Obar[i + tau];
  return r / r0;
}

/** BPM autocorrelation + harmonic disambiguation + phase/downbeat alignment (spec §1.2.5). */
export function estimateTempo(O, rate, kickFrames) {
  const n = O.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += O[i];
  mean /= n;
  const Obar = new Float32Array(n);
  for (let i = 0; i < n; i++) Obar[i] = O[i] - mean;

  let r0 = 0;
  for (let i = 0; i < n; i++) r0 += Obar[i] * Obar[i];
  r0 = Math.max(r0, 1e-9);

  const tauMin = Math.max(1, Math.round(rate * 60 / 200));
  const tauMax = Math.max(tauMin + 1, Math.round(rate * 60 / 60));

  let bestTau = tauMin, bestScore = -Infinity;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    const rHat = correlationAt(Obar, r0, tau);
    const bpm = (60 * rate) / tau;
    const logRatio = Math.log2(bpm / 120);
    const prior = Math.exp(-(logRatio * logRatio) / (2 * 0.7 * 0.7));
    const score = rHat * prior;
    if (score > bestScore) { bestScore = score; bestTau = tau; }
  }

  // Harmonic disambiguation: trust the kicks over tau*/2 (double-time ghost) or 2*tau*.
  const candidates = [bestTau, Math.round(bestTau / 2), bestTau * 2].filter((t) => t >= 1 && t < n);
  let tauFinal = bestTau, bestExplain = -1;
  for (const tau of candidates) {
    const explain = kickGridExplainScore(kickFrames, tau, rate);
    if (explain > bestExplain) { bestExplain = explain; tauFinal = tau; }
  }

  const rHatFinal = correlationAt(Obar, r0, tauFinal);
  const beatPeriodMs = (tauFinal / rate) * 1000;
  const bpm = 60000 / beatPeriodMs;

  // Phase alignment: comb-filter search with KICK frames weighted x2.
  const weighted = Float32Array.from(O);
  for (const kf of kickFrames) if (kf < weighted.length) weighted[kf] *= 2;
  let phiStar = 0, phiScore = -Infinity;
  for (let phi = 0; phi < tauFinal; phi++) {
    let s = 0;
    for (let k = phi; k < n; k += tauFinal) s += weighted[k];
    if (s > phiScore) { phiScore = s; phiStar = phi; }
  }

  // Downbeat: assume 4 beats/bar, pick which of the 4 beat-phases holds the most kick energy.
  const kickOnly = new Float32Array(n);
  for (const kf of kickFrames) if (kf < n) kickOnly[kf] = O[kf];
  let mStar = 0, mScore = -Infinity;
  for (let m = 0; m < 4; m++) {
    let s = 0;
    for (let j = 0; phiStar + (m + 4 * j) * tauFinal < n; j++) s += kickOnly[phiStar + (m + 4 * j) * tauFinal];
    if (s > mScore) { mScore = s; mStar = m; }
  }

  // phiStar in [0,tauFinal) and mStar in {0,1,2,3} => downbeatFrame in [0, 4*tauFinal),
  // i.e. exactly the first downbeat at or after t=0.
  const downbeatFrame = phiStar + mStar * tauFinal;

  return {
    bpm,
    beatPeriodMs,
    confidence: clamp(rHatFinal, 0, 1),
    freeTime: rHatFinal < 0.25,
    barPeriodMs: beatPeriodMs * 4,
    firstBarMs: (downbeatFrame / rate) * 1000,
  };
}

function kickGridExplainScore(kickFrames, tau, rate) {
  if (kickFrames.length === 0 || tau < 1) return 0;
  const toleranceMs = 45;
  const toleranceFrames = (toleranceMs / 1000) * rate;
  const binWidth = Math.max(1, Math.round(tau / 20));
  const hist = new Map();
  for (const kf of kickFrames) {
    const bin = Math.round((kf % tau) / binWidth) * binWidth;
    hist.set(bin, (hist.get(bin) || 0) + 1);
  }
  let bestBin = 0, bestCount = 0;
  for (const [bin, count] of hist) if (count > bestCount) { bestCount = count; bestBin = bin; }
  let explained = 0;
  for (const kf of kickFrames) {
    const residual = Math.min(((kf - bestBin) % tau + tau) % tau, ((bestBin - kf) % tau + tau) % tau);
    if (residual <= toleranceFrames) explained++;
  }
  return explained / kickFrames.length;
}

/** The mean of a subset of band envelopes -- shared by extractPseudoLane's
 *  onset picking and the adapter's sustain estimation, so both walk the
 *  exact same curve. */
export function mixBandEnvelopes(normBands, bandIndices) {
  const mix = new Float32Array(normBands[0].length);
  for (const b of bandIndices) for (let i = 0; i < mix.length; i++) mix[i] += normBands[b][i] / bandIndices.length;
  return mix;
}

/**
 * MIDI-like note duration from an envelope: walk forward from the onset
 * frame while the energy stays above a fraction of its local peak. Gives
 * audio notes real sustain lengths (feeding the composer strip's icon
 * spans and Midasus's phrasing) instead of one fixed durMs for every note.
 */
export function estimateSustainMs(env, rate, frame, { floorRatio = 0.35, minMs = 120, maxMs = 1600 } = {}) {
  const peakHold = Math.min(env.length - 1, frame + Math.round(rate * 0.08));
  let peak = 0;
  for (let i = frame; i <= peakHold; i++) if (env[i] > peak) peak = env[i];
  if (peak < 1e-6) return minMs;
  const floor = peak * floorRatio;
  let end = frame;
  const maxFrames = Math.round((maxMs / 1000) * rate);
  while (end < env.length - 1 && end - frame < maxFrames && env[end] > floor) end++;
  return clamp(((end - frame) / rate) * 1000, minMs, maxMs);
}

/** Pseudo-melody/bass lanes from sustained band energy (spec §1.2.4 final
 *  paragraph). Each event carries its analysis `frame` so the adapter can
 *  refine pitch/duration against the true spectrum (see PitchTracker) --
 *  the band-centroid pitch here is only the fallback for moments the
 *  spectral tracker finds no tonal content in. */
export function extractPseudoLane(normBands, rate, { bandIndices, pitchLo, pitchHi, role, onsetThreshold = 1 }) {
  const mix = mixBandEnvelopes(normBands, bandIndices);

  const flux = positiveFlux(mix);
  const theta = medianAdaptiveThreshold(flux, MEDIAN_HALF_WINDOW, onsetThreshold);
  const frames = pickPeaks(flux, theta, rate, 120, 40);

  const values = frames.map((i) => flux[i]).sort((a, b) => a - b);
  const p95 = values.length ? Math.max(1e-6, values[Math.min(values.length - 1, Math.floor(0.95 * values.length))]) : 1;

  return frames.map((i) => {
    let num = 0, den = 0;
    for (let k = 0; k < bandIndices.length; k++) {
      const e = normBands[bandIndices[k]][i];
      num += k * e;
      den += e;
    }
    const centroid = den > 0 ? num / den / Math.max(1, bandIndices.length - 1) : 0.5;
    const pitch = Math.round(pitchLo + (pitchHi - pitchLo) * clamp(centroid, 0, 1));
    return { tMs: (i / rate) * 1000, pitch, vel: clamp(flux[i] / p95, 0, 1), role, frame: i };
  });
}
