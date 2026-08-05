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

// --- Single-section collapse: "Crank That has only one biome" ------------
//
// MIN_SECTION_CUTS was never a floor -- it only ever bounded the cut BUDGET.
// Nothing counted the result, so several distinct paths could hand a whole
// song back as one unchanging world. One regression per path.

/** Energy curves with no structure at all: every sample identical. */
function flatEnergyCurves() {
  const shape = new Array(7).fill(0.4);
  return { sampleAll: () => shape };
}

/** Nearly flat, with one late surge -- a fade-out/outro shape. The strongest
 *  novelty peak lands on the FINAL analysis index. */
function outroEnergyCurves(durationMs) {
  return {
    sampleAll(ms) {
      const late = ms > durationMs * 0.94 ? 0.9 : 0.4;
      return [late, 0.4, 0.4, 0.4, 0.4, 0.4, late];
    },
  };
}

function buildWithStructure(barGrid, energyCurves, durationMs, structure) {
  const fake = Object.create(BiomeManager.prototype);
  fake._buildSchedule(barGrid, energyCurves, durationMs, 7, null, structure);
  return fake;
}

test('a long song is never a single section, even with no structure to find', () => {
  const durationMs = 4 * 60 * 1000;
  const sections = buildSchedule([], flatEnergyCurves(), durationMs, 1);
  assert.ok(sections.length >= 3, `four minutes must not be one biome, got ${sections.length}`);
  assert.equal(sections[0].startMs, 0);
  assert.equal(sections[sections.length - 1].endMs, durationMs);
  // And they must be real spans, not runts stacked at the start.
  for (const s of sections) assert.ok(s.endMs > s.startMs, 'every section spans real time');
});

test('a peak on the final index no longer collapses the schedule', () => {
  // cuts [0, last, last] used to drop its first pair as empty and leave one
  // section -- a big outro made that very reachable on real songs.
  const durationMs = 3 * 60 * 1000;
  const sections = buildSchedule([], outroEnergyCurves(durationMs), durationMs, 3);
  assert.ok(sections.length >= 2, `expected real sections, got ${sections.length}`);
  assert.equal(sections[sections.length - 1].endMs, durationMs);
});

test('a short song is still allowed to be one section', () => {
  // The floor is "long enough to deserve them", not "always three".
  const sections = buildSchedule([], flatEnergyCurves(), 20000, 5);
  assert.ok(sections.length >= 1);
  assert.equal(sections[0].startMs, 0);
  assert.equal(sections[sections.length - 1].endMs, 20000);
});

test('a one-section SSM read cannot override an energy read that found structure', () => {
  // analyzeStructure returns [0, last] when it rejects every candidate. That
  // used to arrive with confidence up to 0.6 -- clearing the acceptance floor
  // -- and flatten a good energy schedule to a single biome.
  const durationMs = 5 * 60 * 1000;
  const curves = fakeEnergyCurves(durationMs);
  const flatSsm = { boundariesMs: [0], labels: [0], cutIndices: [0, 40], confidence: 0.6 };
  const fake = buildWithStructure([], curves, durationMs, flatSsm);
  assert.equal(fake.structureSource, 'energy-novelty', 'a structureless SSM read must not win');
  assert.ok(fake.sections.length >= 3, `expected the energy schedule, got ${fake.sections.length}`);
});

test('SSM boundaries land at the right TIMES even when its grid differs from ours', () => {
  // The analyzer runs on AudioAdapter's grid; _buildSchedule builds its own,
  // which for a free-time song is much finer. Passing raw indices across put
  // every cut at the wrong moment, bunched toward the song's start. Times are
  // grid-independent, so the same boundaries must land where they belong.
  const durationMs = 4 * 60 * 1000;
  const wantMs = [0, 60000, 150000, 210000];
  const fake = buildWithStructure([], fakeEnergyCurves(durationMs), durationMs, {
    boundariesMs: wantMs,
    labels: [0, 1, 0, 2],
    cutIndices: [0, 30, 75, 105, 120], // deliberately from a coarser grid
    confidence: 0.8,
  });
  assert.equal(fake.structureSource, 'ssm');
  assert.equal(fake.sections.length, wantMs.length, 'one section per boundary');
  for (let i = 0; i < wantMs.length; i++) {
    assert.ok(Math.abs(fake.sections[i].startMs - wantMs[i]) < 4000,
      `section ${i} should start near ${wantMs[i]}ms, got ${fake.sections[i].startMs}`);
  }
});
