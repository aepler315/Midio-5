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

// --- The SSM read being discarded without saying so ----------------------
//
// _buildSchedule set structureSource from `ssmUsable` BEFORE running
// _ensureMinimumSections, which is allowed to throw the chosen cuts away
// entirely -- re-picking from the energy novelty with the noise floor
// dropped, or splitting the clock evenly. A schedule with no SSM content in
// it at all still reported itself as 'ssm', which is what kept the whole
// class of "we ignored the analyzer" bug out of the debug overlay.
//
// Separately, the SSM's repetition LABELS -- the half of the read that knows
// a returning chorus is literally the same music -- were only used when
// `labels.length === sections.length`. The section list is not a copy of the
// analyzer's segment list (boundaries get dropped on the tail or collapsed
// onto one grid point, empty spans are skipped), so a single dropped
// boundary threw away every label.

test('a schedule the minimum-sections floor rebuilt does not claim to be the SSM read', () => {
  const durationMs = 4 * 60 * 1000;
  // Confident, but only two sections -- below the floor for a song this long,
  // so _ensureMinimumSections re-picks from the energy novelty and the SSM's
  // cuts do not survive into the schedule at all.
  const fake = buildWithStructure([], fakeEnergyCurves(durationMs), durationMs, {
    boundariesMs: [0, 100000], labels: [0, 1], cutIndices: [0, 50, 120], confidence: 0.9,
  });
  assert.ok(fake.sections.length > 2, 'the floor should have rebuilt the schedule');
  assert.equal(fake.structureSource, 'energy-novelty',
    'the schedule is made of energy peaks, so that is what it must report');
});

test('an even-split schedule says so, rather than borrowing the credit of a detector', () => {
  // Nothing in the signal to pick peaks from: the floor falls all the way
  // through to even time-splits. That is a real degradation and the overlay
  // should be able to show it.
  const durationMs = 4 * 60 * 1000;
  const sections = buildSchedule([], flatEnergyCurves(), durationMs, 1);
  const fake = Object.create(BiomeManager.prototype);
  fake._buildSchedule([], flatEnergyCurves(), durationMs, 1, null);
  assert.ok(sections.length >= 3);
  assert.equal(fake.structureSource, 'even-split');
});

/** Three spans with mutually orthogonal one-hot spectra, so the band-shape
 *  fallback (SongForm, cosine >= 0.9) is guaranteed to call all three
 *  different music -- even though the outer two are the same section
 *  returning. Chroma hears the recurrence; band shape alone cannot. */
function orthogonalSpanCurves() {
  const oneHot = (b) => new Array(7).fill(0).map((_, k) => (k === b ? 0.9 : 0.05));
  return {
    sampleAll(ms) {
      if (ms < 60000) return oneHot(0);
      return ms < 150000 ? oneHot(3) : oneHot(6);
    },
  };
}

test('the SSM keeps its repetition labels when a boundary is dropped and the counts stop matching', () => {
  const durationMs = 4 * 60 * 1000;
  // Two boundaries 500ms apart collapse onto the same point of this
  // schedule's ~2s grid, so _cutsFromTimes drops the second: 4 labels, 3
  // sections. The song is chorus/verse/chorus -- material that RECURS, which
  // is exactly what the band-shape fallback cannot see here (the three spans
  // are spectrally orthogonal by construction, so it labels them 0,1,2).
  const fake = buildWithStructure([], orthogonalSpanCurves(), durationMs, {
    boundariesMs: [0, 60000, 60500, 150000],
    labels: [0, 1, 2, 0],
    cutIndices: [0, 30, 30, 75, 120],
    confidence: 0.8,
  });
  assert.equal(fake.structureSource, 'ssm');
  assert.equal(fake.sections.length, 3, 'the near-duplicate boundary should have been dropped');
  const labels = fake.sections.map((s) => s.label);
  assert.equal(labels[0], labels[2], `the returning chorus must share a label, got [${labels}]`);
  assert.notEqual(labels[0], labels[1], 'and the verse between them must not');
  // Same label means the same cast biome, which is the point: the returning
  // chorus wears the face it wore the first time.
  assert.equal(fake.sections[0].profile, fake.sections[2].profile);
});
