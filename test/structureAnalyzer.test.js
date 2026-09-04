import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeStructure, selfSimilarity, footeNovelty, labelByRepetition, chromaBetween,
  NO_STRUCTURE_CONFIDENCE, repeatThresholdFor, REPEAT_THRESHOLD,
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

// --- the repeat cutoff is the SONG's, not an absolute -----------------------

test('a low-contrast arrangement still reads its form instead of collapsing', () => {
  // The defect this replaced: the cutoff was a flat 0.82 cosine, so how much
  // of the song counted as "the same material" depended on how much timbral
  // contrast the ARRANGEMENT had. A song built on one patch has every pair
  // squeezed above 0.82, and the whole track collapsed to a single label --
  // one biome start to finish, the form invisible.
  //
  // Same A-B-A-C form at several contrasts; the read must not change.
  const build = (contrast) => {
    const dirs = { A: [1, 0, 0], B: [0, 1, 0], C: [0, 0, 1] };
    const plan = ['A', 'A', 'A', 'B', 'B', 'B', 'A', 'A', 'A', 'C', 'C', 'C'];
    return plan.map((cls) => {
      const v = new Float64Array(19).fill(1);
      dirs[cls].forEach((d, k) => { v[k * 4] += d * contrast * 3; });
      return v;
    });
  };
  for (const contrast of [0.35, 0.5, 0.8, 1.2, 2.0]) {
    const labels = labelByRepetition(selfSimilarity(build(contrast)), [0, 3, 6, 9, 12]);
    assert.deepEqual(labels, [0, 1, 0, 2],
      `A-B-A-C must survive an arrangement contrast of ${contrast}`);
  }
});

test('the repeat cutoff sits inside the song\'s own similarity range', () => {
  const tight = repeatThresholdFor([0.90, 0.91, 0.92, 0.99]);
  assert.ok(tight > 0.90 && tight < 0.99,
    `a cutoff of ${tight} must fall between the song's least and most alike pairs`);
  const loose = repeatThresholdFor([0.30, 0.35, 0.40, 0.95]);
  assert.ok(loose < tight,
    'a song with more contrast between its sections gets a lower bar, not the same one');
});

test('a cutoff is never lowered enough to call unlike material a repeat', () => {
  // A through-composed piece has no repeats at all. Without a floor its
  // least-dissimilar pair would be promoted to one purely for being the best
  // of a bad lot.
  const t = repeatThresholdFor([0.05, 0.10, 0.12, 0.20]);
  assert.ok(t >= 0.5, `nothing at ${t} cosine should ever count as the same material`);
  const S = [
    [1, 0.1, 0.2], [0.1, 1, 0.15], [0.2, 0.15, 1],
  ].map((r) => Float64Array.from(r));
  assert.deepEqual(labelByRepetition(S, [0, 1, 2, 3]), [0, 1, 2],
    'three unlike segments stay three labels');
});

test('too few pairs, or a song of one texture, falls back to the absolute cutoff', () => {
  assert.equal(repeatThresholdFor([0.9]), REPEAT_THRESHOLD,
    'two segments give one similarity -- min and max are the same number, which '
    + 'would merge them unconditionally');
  assert.equal(repeatThresholdFor([]), REPEAT_THRESHOLD);
  assert.equal(repeatThresholdFor([0.951, 0.952, 0.9505, 0.9515]), REPEAT_THRESHOLD,
    'a range this narrow is one texture, and its peaks are noise rather than form');
});

test('a genuine drone stays one label rather than being split on noise', () => {
  // The counterpart risk to the collapse above: everything really IS the same
  // material here, and a purely proportional cutoff would manufacture
  // boundaries out of the last decimal place.
  const feats = Array.from({ length: 12 }, () => Float64Array.from(new Array(19).fill(1)));
  assert.deepEqual(labelByRepetition(selfSimilarity(feats), [0, 3, 6, 9, 12]), [0, 0, 0, 0]);
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
