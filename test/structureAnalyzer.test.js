import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeStructure, selfSimilarity, footeNovelty, labelByRepetition, chromaBetween,
  NO_STRUCTURE_CONFIDENCE,
} from '../src/audio/StructureAnalyzer.js';
import { SEMITONE_LO } from '../src/audio/PitchTracker.js';

const SEMI_COUNT = 60; // SEMITONE_LO(36)..SEMITONE_HI(95)

/**
 * Fake pitchFeatures: a frame rate plus per-frame semitone-energy arrays,
 * matching computePitchFeatures' real output shape ({rate, frames}).
 * `chordAt(sectionIndex)` returns the pitch classes sounding in that section.
 */
function fakeFeatures(sectionPitchClasses, secPerSection, rate = 20) {
  const frames = [];
  for (const pcs of sectionPitchClasses) {
    for (let f = 0; f < secPerSection * rate; f++) {
      const semis = new Float32Array(SEMI_COUNT);
      for (const pc of pcs) {
        // Voice each class in a couple of octaves, as real music does.
        for (const midi of [48 + pc, 60 + pc, 72 + pc]) {
          const idx = midi - SEMITONE_LO;
          if (idx >= 0 && idx < SEMI_COUNT) semis[idx] = 1;
        }
      }
      frames.push(semis);
    }
  }
  return { rate, frames };
}

/** Bar grid covering `count` points at `stepMs`. */
const grid = (count, stepMs) => Array.from({ length: count }, (_, i) => i * stepMs);

test('chromaBetween folds semitones to pitch classes across octaves', () => {
  const feats = fakeFeatures([[0, 4, 7]], 2);
  const c = chromaBetween(feats, 0, 2000);
  assert.ok(c[0] > 0 && c[4] > 0 && c[7] > 0, 'the sounding classes are present');
  assert.ok(c[1] === 0 && c[6] === 0, 'silent classes stay zero');
  // L2-normalized.
  const norm = Math.sqrt(c.reduce((s, v) => s + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-6, `expected unit vector, got ${norm}`);
});

test('a self-similarity matrix is symmetric with a unit diagonal', () => {
  const feats = [
    Float64Array.from([1, 0, 0]), Float64Array.from([0, 1, 0]), Float64Array.from([1, 0, 0]),
  ];
  const S = selfSimilarity(feats);
  assert.equal(S[0][0], 1);
  assert.equal(S[0][2], 1, 'identical material scores 1');
  assert.equal(S[0][1], 0, 'orthogonal material scores 0');
  assert.equal(S[1][2], S[2][1], 'symmetric');
});

test('Foote novelty peaks at the seam between two blocks of unlike material', () => {
  const n = 20;
  const S = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) S[i][j] = (i < 10) === (j < 10) ? 1 : 0;
  }
  const nov = footeNovelty(S);
  let peak = 0, peakAt = -1;
  for (let i = 0; i < n; i++) if (nov[i] > peak) { peak = nov[i]; peakAt = i; }
  assert.ok(Math.abs(peakAt - 10) <= 1, `peak at ${peakAt}, expected the seam at 10`);
  // The kernel can't see the edges, so they're zeroed rather than spiking.
  assert.equal(nov[0], 0);
  assert.equal(nov[n - 1], 0);
});

test('labelByRepetition gives recurring material the same label', () => {
  // Three segments: A, B, A.
  const feats = [];
  const A = Float64Array.from([1, 0]), B = Float64Array.from([0, 1]);
  for (let i = 0; i < 4; i++) feats.push(A);
  for (let i = 0; i < 4; i++) feats.push(B);
  for (let i = 0; i < 4; i++) feats.push(A);
  const S = selfSimilarity(feats);
  const labels = labelByRepetition(S, [0, 4, 8, 12]);
  assert.equal(labels[0], labels[2], 'the returning A is recognized as the same material');
  assert.notEqual(labels[0], labels[1], 'B is its own label');
});

test('an ABAB song yields boundaries at the seams and repeats its labels', () => {
  // Four 16s sections alternating between two chord sets, on a 2s grid.
  const sectionSec = 16, stepMs = 2000;
  const feats = fakeFeatures([[0, 4, 7], [2, 5, 9], [0, 4, 7], [2, 5, 9]], sectionSec);
  const pointsMs = grid((sectionSec * 4 * 1000) / stepMs, stepMs);
  const res = analyzeStructure({
    pointsMs, pitchFeatures: feats, energyCurves: null,
    durationMs: sectionSec * 4 * 1000, minGapMs: 8000, maxCuts: 8,
  });

  assert.ok(res, 'should produce a read');
  // Boundaries near 16s / 32s / 48s (within one grid step).
  for (const want of [16000, 32000, 48000]) {
    const hit = res.boundariesMs.some((b) => Math.abs(b - want) <= stepMs);
    assert.ok(hit, `expected a boundary near ${want}ms, got ${res.boundariesMs}`);
  }
  // A returns, B returns.
  assert.ok(new Set(res.labels).size < res.labels.length, `labels should repeat: ${res.labels}`);
  assert.ok(res.confidence > 0.45, `confidence ${res.confidence} should clear BiomeManager's floor`);
});

test('featureless input returns null rather than manufacturing sections', () => {
  const rate = 20;
  const frames = Array.from({ length: 400 }, () => new Float32Array(SEMI_COUNT));
  const res = analyzeStructure({
    pointsMs: grid(20, 1000), pitchFeatures: { rate, frames },
    energyCurves: null, durationMs: 20000,
  });
  assert.equal(res, null, 'silence has no structure to find');
});

test('too few analysis points returns null so the caller falls back', () => {
  const feats = fakeFeatures([[0, 4, 7]], 4);
  assert.equal(analyzeStructure({
    pointsMs: grid(6, 1000), pitchFeatures: feats, energyCurves: null, durationMs: 6000,
  }), null);
  assert.equal(analyzeStructure({ pointsMs: null, pitchFeatures: feats, durationMs: 1000 }), null);
  assert.equal(analyzeStructure({ pointsMs: grid(30, 1000), pitchFeatures: null, durationMs: 30000 }), null);
});

test('boundaries honor the minimum gap', () => {
  const sectionSec = 8, stepMs = 1000;
  const feats = fakeFeatures([[0, 4, 7], [2, 5, 9], [1, 6, 8], [3, 7, 10]], sectionSec);
  const pointsMs = grid((sectionSec * 4 * 1000) / stepMs, stepMs);
  const res = analyzeStructure({
    pointsMs, pitchFeatures: feats, energyCurves: null,
    durationMs: sectionSec * 4 * 1000, minGapMs: 11000, maxCuts: 12,
  });
  assert.ok(res);
  for (let i = 1; i < res.boundariesMs.length; i++) {
    assert.ok(res.boundariesMs[i] - res.boundariesMs[i - 1] >= 11000 - stepMs,
      `boundaries ${res.boundariesMs[i - 1]} and ${res.boundariesMs[i]} are too close`);
  }
});

test('a read that found no boundaries reports low confidence, not medium', () => {
  // With one section there is nothing for the repeat bonus to reward (a lone
  // label cannot recur), so novelty contrast alone used to carry a
  // structureless read to ~0.6 -- over BiomeManager's acceptance floor, where
  // it would flatten a good energy-novelty schedule to a single biome.
  // A detector that found nothing has to say so.
  const feats = fakeFeatures([[0, 4, 7]], 30); // one unchanging block
  const res = analyzeStructure({
    pointsMs: grid(40, 1000), pitchFeatures: feats, energyCurves: null, durationMs: 40000,
  });
  if (res === null) return; // bailing out entirely is also an acceptable answer
  if (res.labels.length < 2) {
    assert.ok(res.confidence <= NO_STRUCTURE_CONFIDENCE,
      `single-section read should stay quiet, got ${res.confidence}`);
  }
});
