// The real-range basket: scoring a skyline, matching a song to a range, the
// build-time quality gate, and the generated index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  AXES, MAX_FLOOR_SHARE, countPeaks, rangeCharacter, skylineFeatures, skylineQuality,
} from '../src/world/terrain/RangeCharacter.js';
import { NEAR_TIE, matchRange, songTerrainTarget } from '../src/world/terrain/RangeMatcher.js';
import { RANGES, LOADERS } from '../src/world/terrain/ranges/index.js';
import { profilesFromJSON } from '../src/world/terrain/TerrainProfile.js';
import {
  decodePng, lonLatToPixel, rangeAxisDeg, rangeElongation, rotateGrid, terrariumElevation, valleyCameraElevM,
} from '../tools/lib/terrarium.mjs';

const profileOf = (skylineElevM, angles = skylineElevM.map((v) => v / 1e5)) => ({
  layers: { L2: { spacingM: 400, skylineElevM, angles } },
});

test('a gentle ridge and a jagged one score where they should', () => {
  const gentle = Array.from({ length: 120 }, (_, i) => 900 + 120 * Math.sin(i / 14));
  const jagged = Array.from({ length: 120 }, (_, i) => 3000 + 700 * Math.sin(i / 9) + (i % 3 === 0 ? 260 : -120));
  const a = rangeCharacter(profileOf(gentle));
  const b = rangeCharacter(profileOf(jagged));
  for (const axis of ['energy', 'rawness', 'grandeur']) {
    assert.ok(b.scores[axis] > a.scores[axis], `${axis}: jagged ${b.scores[axis]} > gentle ${a.scores[axis]}`);
  }
  assert.equal(a.archetype, 'serene');
  for (const axis of AXES) assert.ok(a.scores[axis] >= 0 && a.scores[axis] <= 1);
});

test('a lone cone reads as dominant; an even wall does not', () => {
  const cone = Array.from({ length: 101 }, (_, i) => 1200 + 2600 * Math.max(0, 1 - Math.abs(i - 50) / 30));
  const wall = Array.from({ length: 101 }, (_, i) => 2500 + (i % 2 ? 40 : 0));
  assert.ok(rangeCharacter(profileOf(cone)).scores.dominance > 0.6);
  // Its raw top-over-median share is high, but a 40m wiggle is no summit.
  assert.ok(skylineFeatures(wall, 400).dominance > 0.6, 'the raw share alone would call it dominant');
  assert.ok(rangeCharacter(profileOf(wall)).scores.dominance < 0.2);
});

test('countPeaks counts summits by prominence, not by wiggles', () => {
  assert.equal(countPeaks([0, 100, 0, 100, 0]), 2);
  assert.equal(countPeaks([0, 30, 0, 30, 0]), 0, 'under the prominence threshold');
});

test('scores are absolute: a range scores the same whatever else is in the basket', () => {
  const sky = Array.from({ length: 80 }, (_, i) => 2000 + 400 * Math.sin(i / 6));
  const alone = rangeCharacter(profileOf(sky));
  const again = rangeCharacter(profileOf(sky));
  assert.deepEqual(alone.scores, again.scores);
});

test('the quality gate rejects a skyline lying on its own floor', () => {
  const good = Array.from({ length: 100 }, (_, i) => 1 + Math.sin(i / 8));
  const flatWithSpikes = Array.from({ length: 100 }, (_, i) => (i % 20 === 0 ? 5 : 0));
  assert.equal(skylineQuality(profileOf(good, good)).usable, true);
  const bad = skylineQuality(profileOf(flatWithSpikes, flatWithSpikes));
  assert.ok(bad.floorShare > MAX_FLOOR_SHARE);
  assert.equal(bad.usable, false);
});

const range = (id, scores, archetype = 'majestic') => ({ id, archetype, scores });

test('one range in the basket: that one, whatever the song', () => {
  const only = [range('solo', { energy: 0.9, rawness: 0.9, grandeur: 0.9, dominance: 0.9 })];
  assert.equal(matchRange(only, { watch: { drive: 0.1 } }, 3).range.id, 'solo');
});

test('a song goes to the range nearest it on the shared axes', () => {
  const ranges = [
    range('calm', { energy: 0.2, rawness: 0.2, grandeur: 0.1, dominance: 0.3 }, 'serene'),
    range('fierce', { energy: 0.8, rawness: 0.85, grandeur: 0.7, dominance: 0.4 }, 'wild'),
  ];
  const quiet = { watch: { drive: 0.15, onset: 0.1, texture: 0.2, arc: 0.15, contrast: 0.3 } };
  const loud = { watch: { drive: 0.85, onset: 0.9, texture: 0.7, arc: 0.7, contrast: 0.4 } };
  assert.equal(matchRange(ranges, quiet, 1).range.id, 'calm');
  assert.equal(matchRange(ranges, loud, 1).range.id, 'fierce');
});

test('a confident minor key leans toward the heavier archetypes', () => {
  const s = { energy: 0.4, rawness: 0.4, grandeur: 0.4, dominance: 0.5 };
  const ranges = [range('bright', s, 'majestic'), range('dark', { ...s, energy: 0.42 }, 'brooding')];
  const song = (mode) => ({ watch: { drive: 0.4, onset: 0.4, texture: 0.4, arc: 0.4, contrast: 0.5 }, tonal: { mode, confidence: 0.8 } });
  assert.equal(matchRange(ranges, song('minor'), 0).ranked[0].range.id, 'dark');
  assert.equal(matchRange(ranges, song('major'), 0).ranked[0].range.id, 'bright');
});

test('near-ties are shared out by seed, and each song is stable', () => {
  const s = { energy: 0.5, rawness: 0.5, grandeur: 0.5, dominance: 0.5 };
  const ranges = ['a', 'b', 'c'].map((id, i) => range(id, { ...s, energy: 0.5 + i * (NEAR_TIE / 4) }));
  const song = { watch: { drive: 0.5, onset: 0.5, texture: 0.5, arc: 0.5, contrast: 0.5 } };
  const picks = new Set([0, 1, 2, 3, 4, 5].map((seed) => matchRange(ranges, song, seed).range.id));
  assert.ok(picks.size > 1, 'different songs spread across equally good ranges');
  assert.equal(matchRange(ranges, song, 4).range.id, matchRange(ranges, song, 4).range.id);
});

test('growing the basket far from a song does not change its range', () => {
  const near = range('near', { energy: 0.3, rawness: 0.3, grandeur: 0.3, dominance: 0.5 });
  const song = { watch: { drive: 0.3, onset: 0.3, texture: 0.3, arc: 0.3, contrast: 0.5 } };
  const before = matchRange([near], song, 9).range.id;
  const far = range('far', { energy: 0.95, rawness: 0.95, grandeur: 0.95, dominance: 0.1 }, 'wild');
  assert.equal(matchRange([near, far], song, 9).range.id, before);
});

test('songTerrainTarget tolerates a missing profile', () => {
  const t = songTerrainTarget(null);
  for (const axis of AXES) assert.ok(t[axis] >= 0 && t[axis] <= 1);
});

test('every range in the generated index has scores, a loader and a loadable profile', async () => {
  assert.ok(RANGES.length >= 3, 'the basket holds more than the Tetons');
  const ids = new Set();
  for (const r of RANGES) {
    assert.ok(!ids.has(r.id), `${r.id} appears once`); ids.add(r.id);
    for (const axis of AXES) assert.ok(r.scores[axis] >= 0 && r.scores[axis] <= 1, `${r.id}.${axis}`);
    assert.equal(typeof LOADERS[r.id], 'function', `${r.id} has a loader`);
    const mod = await LOADERS[r.id]();
    assert.ok(skylineQuality(mod.default).usable, `${r.id} passed the quality gate`);
    assert.ok(Object.keys(profilesFromJSON(mod.default)).length > 0, `${r.id} yields terrain profiles`);
  }
});

// A tiny RGB PNG, one row per filter type, to exercise every unfilter path.
function makePng(width, rows) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(rows.length, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(rows.map(({ filter, bytes }) => Buffer.from([filter, ...bytes])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('decodePng undoes every PNG row filter', () => {
  const png = makePng(2, [
    { filter: 0, bytes: [10, 20, 30, 40, 50, 60] },
    { filter: 2, bytes: [1, 1, 1, 1, 1, 1] },       // up: +previous row
    { filter: 1, bytes: [5, 5, 5, 1, 1, 1] },       // sub: +pixel to the left
    { filter: 3, bytes: [2, 2, 2, 2, 2, 2] },       // average of left and up
    { filter: 4, bytes: [1, 1, 1, 1, 1, 1] },       // Paeth predictor
  ]);
  const { width, height, channels, data } = decodePng(png);
  assert.deepEqual([width, height, channels], [2, 5, 3]);
  // avg: (0 + 5) >> 1 = 2 -> 4; then (4 + 6) >> 1 = 5 -> 7.
  assert.deepEqual(Array.from(data.subarray(18, 24)), [4, 4, 4, 7, 7, 7]);
  // Paeth: first pixel predicts up (4) -> 5; second, of left 5 / up 7 /
  // up-left 4, predicts up (7) -> 8.
  assert.deepEqual(Array.from(data.subarray(24, 30)), [5, 5, 5, 8, 8, 8]);
  assert.deepEqual(Array.from(data.subarray(6, 12)), [11, 21, 31, 41, 51, 61]);
  assert.deepEqual(Array.from(data.subarray(12, 18)), [5, 5, 5, 6, 6, 6]);
});

test('terrarium elevation and tile projection', () => {
  assert.equal(terrariumElevation(128, 0, 0), 0);
  assert.equal(terrariumElevation(128, 100, 128), 100.5);
  const p = lonLatToPixel(0, 0, 1);
  assert.deepEqual([p.x, p.y], [256, 256], 'lon/lat 0,0 sits at the centre of the world');
});

test('a range is rotated onto its own axis, and a cone is left alone', () => {
  const ridge = (bearing) => {
    const W = 100, H = 100, elev = new Float32Array(W * H), r = (bearing * Math.PI) / 180;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      elev[y * W + x] = 3000 - Math.abs((x - 50) * Math.cos(r) + (y - 50) * Math.sin(r)) * 40;
    }
    return { width: W, height: H, elev };
  };
  const g = ridge(30);
  const axis = rangeAxisDeg(g);
  assert.ok(Math.abs(axis - 30) < 1, `measured ${axis}`);
  assert.ok(Math.abs(rangeAxisDeg(rotateGrid(g, axis))) < 1, 'rotated to vertical');
  assert.ok(rangeElongation(g) > 1.8, 'a ridge is elongated');
  const W = 80, cone = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) cone[y * W + x] = 3000 - Math.hypot(x - 40, y - 40) * 30;
  assert.ok(rangeElongation({ width: W, height: W, elev: cone }) < 1.2, 'a cone has no axis to align');
});

test('the camera stands above its own valley floor', () => {
  const elev = new Float32Array(100).map((_, i) => 3000 + i * 20);
  const cam = valleyCameraElevM({ elev });
  assert.ok(cam > 3000 && cam < 3900, `camera at ${cam}m in a valley floored at 3000m`);
});
