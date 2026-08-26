// Song DNA — a continuous feature vector fingerprinting a song, extracted
// from real signal (MIDI note timeline + the energy-curve features already
// used for world scoring). No enums: every field is a number in [0,1] (or
// a pitch class 0..11), and the whole vector hashes into a seed that makes
// downstream generation deterministic for the same song.
import { clamp01, hashSeed } from '../../utils/math.js';
import { extractWatchFeatures } from '../WorldScore.js';
import { Role } from '../../core/NoteEvent.js';

// Krumhansl-Schmuckler key profiles — duration-weighted pitch-class
// correlation, the standard tonal-hierarchy model for key finding.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Circle-of-fifths order starting at C — the synaesthetic hue convention:
// keys a fifth apart (which sound related) land 30° apart on the wheel.
export const FIFTHS_ORDER = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

function correlate(hist, profile) {
  const n = 12;
  const meanH = hist.reduce((a, b) => a + b, 0) / n;
  const meanP = profile.reduce((a, b) => a + b, 0) / n;
  let num = 0, dh = 0, dp = 0;
  for (let i = 0; i < n; i++) {
    const h = hist[i] - meanH, p = profile[i] - meanP;
    num += h * p; dh += h * h; dp += p * p;
  }
  const denom = Math.sqrt(dh * dp);
  return denom > 1e-9 ? num / denom : 0;
}

/** Krumhansl-Schmuckler key estimate from a duration+velocity weighted
 *  pitch-class histogram. Returns { tonicPc, isMajor, confidence 0..1 }. */
export function estimateKey(histogram) {
  let bestMajor = { pc: 0, corr: -Infinity };
  let bestMinor = { pc: 0, corr: -Infinity };
  for (let pc = 0; pc < 12; pc++) {
    const rot = (profile) => {
      const r = new Array(12);
      for (let i = 0; i < 12; i++) r[i] = profile[(i - pc + 12) % 12];
      return r;
    };
    const cMaj = correlate(histogram, rot(MAJOR_PROFILE));
    const cMin = correlate(histogram, rot(MINOR_PROFILE));
    if (cMaj > bestMajor.corr) bestMajor = { pc, corr: cMaj };
    if (cMin > bestMinor.corr) bestMinor = { pc, corr: cMin };
  }
  const isMajor = bestMajor.corr >= bestMinor.corr;
  const winner = isMajor ? bestMajor : bestMinor;
  const gap = Math.abs(bestMajor.corr - bestMinor.corr);
  // Correlation coefficients rarely exceed ~0.85 for real music; squash to 0..1.
  const confidence = clamp01(0.5 * clamp01(winner.corr / 0.85) + 0.5 * clamp01(gap / 0.3));
  return { tonicPc: winner.pc, isMajor, confidence };
}

// Coarse GM program-number -> shape-grammar family. Independent of
// MidiParser's role-classification table; this one only needs to answer
// "what does this instrument push the silhouette toward."
const FAMILY_RANGES = [
  [0, 7, 'organic'], [8, 15, 'geometric'], [16, 23, 'organic'],
  [24, 26, 'organic'], [27, 31, 'distorted'], [32, 39, 'organic'],
  [40, 47, 'organic'], [48, 55, 'organic'], [56, 63, 'geometric'],
  [64, 79, 'organic'], [80, 87, 'geometric'], [88, 103, 'geometric'],
  [104, 111, 'organic'], [112, 119, 'distorted'], [120, 127, 'geometric'],
];
function familyOf(program) {
  if (!Number.isFinite(program) || program < 0) return null;
  for (const [lo, hi, fam] of FAMILY_RANGES) if (program >= lo && program <= hi) return fam;
  return null;
}

function bucketByBar(timeline, barGrid, durationMs) {
  if (Array.isArray(barGrid) && barGrid.length > 1) {
    const bounds = barGrid.map((b) => b.ms).sort((a, b) => a - b);
    bounds.push(durationMs);
    const buckets = new Array(bounds.length - 1).fill(null).map(() => new Set());
    for (const e of timeline) {
      let i = 0;
      while (i < bounds.length - 2 && e.tMs >= bounds[i + 1]) i++;
      buckets[i].add(((e.pitch ?? 60) % 12 + 12) % 12);
    }
    return buckets;
  }
  const step = 2000;
  const nBuckets = Math.max(1, Math.ceil(durationMs / step));
  const buckets = new Array(nBuckets).fill(null).map(() => new Set());
  for (const e of timeline) {
    const i = Math.min(nBuckets - 1, Math.floor(e.tMs / step));
    buckets[i].add(((e.pitch ?? 60) % 12 + 12) % 12);
  }
  return buckets;
}

/**
 * Build the continuous song-DNA vector. `data` is whatever's already
 * threaded through offerWorldsThenStart: energyCurves/durationMs/bpm/
 * analysis/structure, PLUS (new) timeline/barGrid from midiToTimeline
 * when the source was MIDI. Audio-only songs (no timeline) still get a
 * full DNA — tonal fields fall back to neutral/energy-derived proxies.
 */
export function buildSongDNA(data = {}) {
  const { energyCurves = null, durationMs = 0, bpm = 0, analysis = null, structure = null } = data;
  const timeline = Array.isArray(data.timeline) ? data.timeline : [];
  const barGrid = data.barGrid;
  const dur = Math.max(1, durationMs || 1);

  const watch = extractWatchFeatures({ energyCurves, durationMs, bpm, analysis, structure });

  let tonicPc = 0, isMajor = true, keyConfidence = 0.3;
  let meanPitch01 = 0.5, registerSpread = 0.3, noteDensity = 0.3, velocityRange = 0.3;
  let harmonicComplexity = 0.3, percussionDensity = 0.2;
  let familyShare = { organic: 0.34, geometric: 0.33, distorted: 0.33 };

  if (timeline.length >= 4) {
    const hist = new Array(12).fill(0);
    let pitchSum = 0, pitchSqSum = 0, velMin = 1, velMax = 0, percCount = 0;
    const fam = { organic: 0, geometric: 0, distorted: 0, total: 0 };
    for (const e of timeline) {
      const pc = ((e.pitch ?? 60) % 12 + 12) % 12;
      const weight = Math.max(0.05, (e.durMs ?? 90)) * Math.max(0.05, e.vel ?? 0.5);
      hist[pc] += weight;
      pitchSum += e.pitch ?? 60;
      pitchSqSum += (e.pitch ?? 60) ** 2;
      const v = e.vel ?? 0.5;
      if (v < velMin) velMin = v;
      if (v > velMax) velMax = v;
      if (e.channel === 9 || e.role === Role.RHYTHM) percCount++;
      const f = familyOf(e.program);
      if (f) { fam[f]++; fam.total++; }
    }
    const n = timeline.length;
    const key = estimateKey(hist);
    tonicPc = key.tonicPc; isMajor = key.isMajor; keyConfidence = key.confidence;

    const meanPitch = pitchSum / n;
    const variance = Math.max(0, pitchSqSum / n - meanPitch * meanPitch);
    meanPitch01 = clamp01((meanPitch - 30) / 66);
    registerSpread = clamp01(Math.sqrt(variance) / 24);
    noteDensity = clamp01((n / (dur / 1000)) / 8);
    velocityRange = clamp01(velMax - velMin);
    percussionDensity = clamp01(percCount / n);

    if (fam.total > 0) {
      familyShare = {
        organic: fam.organic / fam.total,
        geometric: fam.geometric / fam.total,
        distorted: fam.distorted / fam.total,
      };
    }

    const buckets = bucketByBar(timeline, barGrid, dur);
    const nonEmpty = buckets.filter((b) => b.size > 0);
    if (nonEmpty.length) {
      const avgDistinct = nonEmpty.reduce((s, b) => s + b.size, 0) / nonEmpty.length;
      harmonicComplexity = clamp01(avgDistinct / 7);
    }
  } else {
    // No MIDI timeline (audio-only upload): derive tonal-ish proxies from
    // spectral features rather than pretending we detected a key.
    tonicPc = Math.round(watch.centroid * 11) % 12;
    isMajor = watch.warmth < 0.5;
    keyConfidence = 0.15;
    meanPitch01 = watch.centroid;
    registerSpread = watch.spread;
    noteDensity = watch.onset;
    velocityRange = watch.dyn;
    harmonicComplexity = clamp01(watch.contrast);
    percussionDensity = clamp01(watch.onset * 0.6);
  }

  const dna = {
    tonicPc, isMajor, keyConfidence,
    meanPitch01, registerSpread, noteDensity, velocityRange,
    harmonicComplexity, percussionDensity, familyShare,
    tempo: bpm || watch.bpm || 100,
    tempoHeat: watch.tempoHeat,
    dyn: watch.dyn, centroid: watch.centroid, spread: watch.spread,
    phrase: watch.phrase, contrast: watch.contrast, groove: watch.groove,
    warmth: watch.warmth, texture: watch.texture, air: watch.air, bass: watch.bass,
    energyMean: watch.energyMean, arc: watch.arc, onset: watch.onset,
    sectionLabels: structure?.labels || null,
    hasTimeline: timeline.length >= 4,
  };

  const seedKey = [
    tonicPc, isMajor ? 1 : 0, Math.round(keyConfidence * 100),
    Math.round(meanPitch01 * 100), Math.round(registerSpread * 100),
    Math.round(noteDensity * 100), Math.round(velocityRange * 100),
    Math.round(harmonicComplexity * 100), Math.round(percussionDensity * 100),
    Math.round(dna.tempo), Math.round(dna.dyn * 100), Math.round(dna.centroid * 100),
    Math.round(dur),
  ].join(':');
  dna.seed = hashSeed(seedKey);

  return dna;
}
