// Section detection (BiomeManager._buildSchedule): the "3 sections on a
// real 5-minute song" bug traced to the analysis-resolution fallback used
// when there's no real bar grid (free-time/tempo-less audio) -- it
// collapsed to a fixed 9 points regardless of song length, with novelty
// forced to 0 for the first 4 and a minimum peak spacing measured in THOSE
// 9 indices, so at most one cut could ever be placed. _buildSchedule and
// _evenSplit are pure/DOM-free (no canvas), so they can be exercised
// directly on a bare prototype instance without constructing a full
// BiomeManager (which needs a real canvas and isn't available in Node).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BiomeManager } from '../src/world/BiomeManager.js';

const PARTS = 10;

function fakeEnergyCurves(durationMs) {
  // Distinct song parts with a different dominant band each, so a working
  // novelty scan has real structure to find.
  const partMs = durationMs / PARTS;
  const shapes = Array.from({ length: PARTS }, (_, p) => {
    const band = p % 7;
    return new Array(7).fill(0.2).map((v, k) => (k === band ? 0.9 : v));
  });
  return {
    sampleAll(ms) {
      const p = Math.min(PARTS - 1, Math.floor(ms / partMs));
      return shapes[p];
    },
  };
}

function buildSchedule(barGrid, energyCurves, durationMs, songSeed) {
  const fake = Object.create(BiomeManager.prototype);
  fake._buildSchedule(barGrid, energyCurves, durationMs, songSeed, null);
  return fake.sections;
}

test('an empty bar grid (free-time audio) on a 5-minute song with real structure yields close to one section per part, not a flat 3', () => {
  const durationMs = 5 * 60 * 1000;
  const sections = buildSchedule([], fakeEnergyCurves(durationMs), durationMs, 42);
  assert.ok(sections.length >= 9, `expected >=9 sections, got ${sections.length}`);
});

test('detected section boundaries land close to where the synthetic song actually changes', () => {
  const durationMs = 5 * 60 * 1000;
  const partMs = durationMs / PARTS;
  const sections = buildSchedule([], fakeEnergyCurves(durationMs), durationMs, 7);
  const boundaries = sections.slice(1).map((s) => s.startMs);
  for (let p = 1; p < PARTS; p++) {
    const target = p * partMs;
    let nearest = boundaries[0];
    for (const b of boundaries) if (Math.abs(b - target) < Math.abs(nearest - target)) nearest = b;
    assert.ok(Math.abs(nearest - target) < 8000, `no detected boundary near real change at ${target}ms (nearest was ${nearest}ms)`);
  }
});

test('a short/static song still yields at least the minimum section count without erroring', () => {
  const sections = buildSchedule([], null, 8000, 1);
  assert.ok(sections.length >= 1);
  assert.equal(sections[0].startMs, 0);
});

test('a real bar grid is untouched by the fallback-resolution change (still used verbatim)', () => {
  const durationMs = 60000;
  const barGrid = Array.from({ length: 40 }, (_, i) => ({ ms: (i / 40) * durationMs }));
  const sections = buildSchedule(barGrid, fakeEnergyCurves(durationMs), durationMs, 3);
  assert.ok(sections.length >= 1);
  assert.equal(sections[0].startMs, 0);
  assert.equal(sections[sections.length - 1].endMs, durationMs);
});
