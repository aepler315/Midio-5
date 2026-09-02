// The southern-Utah shape language.
//
// An alpine flank is one continuous curve from summit to foot. That is the
// right primitive for rock built by uplift and carved by ice, and the wrong
// one for the Colorado Plateau, where flat-lying layers of alternating
// hardness erode LAYER BY LAYER. These pin the features that make the
// difference readable -- and the correctness property the first version got
// wrong twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  plateauProfile, pickFormation, isolationFor,
  PLATEAU_FORMS, PLATEAU_FORM_NAMES,
} from '../src/world/ColoradoPlateau.js';

const sample = (form, n = 400) =>
  Array.from({ length: n }, (_, i) => plateauProfile(i / (n - 1), form));

test('every formation is monotonic -- a rise anywhere is a notch, not a mesa', () => {
  // The correctness property. The first version broke it twice: a dome fell
  // to 0.4 across its cap and then restarted the cliff stack at 1.0, and the
  // reef's monoclinal tilt pushed a bench below the segment after it. Both
  // read as a bite taken out of the rock.
  for (const name of PLATEAU_FORM_NAMES) {
    const h = sample(PLATEAU_FORMS[name], 2000);
    for (let i = 1; i < h.length; i++) {
      assert.ok(h[i] <= h[i - 1] + 1e-9,
        `${name} rises at ${i}: ${h[i - 1]} -> ${h[i]}`);
    }
  }
});

test('a butte is FLAT ON TOP -- the one thing an alpine flank cannot do', () => {
  // No summit, no horn, no apex. A table.
  for (const name of ['MONUMENT', 'MESA', 'STAIRCASE', 'SPIRE']) {
    const f = PLATEAU_FORMS[name];
    const atCentre = plateauProfile(0, f);
    const atCapEdge = plateauProfile(f.cap * 0.95, f);
    assert.equal(atCentre, 1, `${name} should start at full height`);
    assert.equal(atCapEdge, 1, `${name}'s caprock must be flat, got ${atCapEdge}`);
  }
});

test('the cliff is a WALL, not a steep slope', () => {
  // A Monument Valley face is within a few degrees of plumb. In profile that
  // means most of the formation's height is given up over a tiny fraction of
  // its width -- and that ratio is what makes it read as rock rather than as
  // a hill.
  const f = PLATEAU_FORMS.MONUMENT;
  const h = sample(f, 4000);
  let steepest = 0;
  for (let i = 1; i < h.length; i++) steepest = Math.max(steepest, (h[i - 1] - h[i]) * h.length);
  assert.ok(steepest > 6, `the cliff should be near-vertical, steepest slope was ${steepest}`);
});

test('a talus apron sits at the foot, shallower than the cliff above it', () => {
  const f = PLATEAU_FORMS.MONUMENT;
  const cliffSlope = (plateauProfile(f.cap + 0.01, f) - plateauProfile(f.cap + f.cliff, f)) / f.cliff;
  const talusStart = 1 - f.talus;
  const talusSlope = (plateauProfile(talusStart + 0.02, f) - plateauProfile(0.99, f)) / (0.97 - f.talus);
  assert.ok(cliffSlope > talusSlope * 2,
    `the break from wall to debris fan should be abrupt: ${cliffSlope} vs ${talusSlope}`);
  assert.equal(plateauProfile(1, f), 0, 'and it reaches the floor');
});

test('a staircase has more storeys than a monument', () => {
  // Cliff-bench-cliff-bench is the Grand Staircase in cross-section, and it
  // is why these read as architecture rather than as a hillside. Count the
  // near-flat runs.
  const shelves = (form) => {
    const h = sample(form, 3000);
    let count = 0, run = 0;
    for (let i = 1; i < h.length; i++) {
      const drop = h[i - 1] - h[i];
      if (drop < 0.0004) run++;
      else { if (run > 25) count++; run = 0; }
    }
    if (run > 25) count++;
    return count;
  };
  assert.ok(shelves(PLATEAU_FORMS.STAIRCASE) > shelves(PLATEAU_FORMS.MONUMENT),
    'the staircase should show more shelves');
});

test('a dome is rounded where the others are flat -- Capitol Dome', () => {
  const d = PLATEAU_FORMS.DOME;
  const crown = plateauProfile(0, d);
  const rim = plateauProfile(d.cap * 0.95, d);
  assert.equal(crown, 1);
  assert.ok(rim < 0.98, `a dome must curve across its cap, got ${rim}`);
  // ...but still stands on a cliff band rather than replacing one.
  assert.ok(plateauProfile(d.cap + d.cliff, d) < rim - 0.05, 'the cliff below it survives');
});

test('the reef leans -- the Waterpocket Fold is a monocline', () => {
  // Its storeys are not evenly stacked: later ones give up more height.
  const f = PLATEAU_FORMS.REEF;
  const flat = { ...f, tilt: 0 };
  const h1 = sample(f, 1500), h0 = sample(flat, 1500);
  let differs = 0;
  for (let i = 0; i < h1.length; i++) if (Math.abs(h1[i] - h0[i]) > 0.005) differs++;
  assert.ok(differs > 60, `tilt should visibly reshape the stack, ${differs} samples differed`);
  assert.ok(f.tilt > 0, 'and the reef is the form that carries it');
});

test('Monument Valley stands apart -- the empty floor is the read', () => {
  // Buttes that touch are a mountain range. The isolation IS the landscape.
  assert.ok(isolationFor(PLATEAU_FORMS.MONUMENT) > isolationFor(PLATEAU_FORMS.MESA));
  assert.ok(isolationFor(PLATEAU_FORMS.MONUMENT) > 2, 'monuments want real space around them');
  assert.ok(isolationFor(PLATEAU_FORMS.REEF) < 1.5, 'a reef is continuous by definition');
});

test('formation choice is song-driven and deterministic', () => {
  const fixed = () => 0.5;
  assert.equal(pickFormation(fixed, { crest: 0.9 }), pickFormation(fixed, { crest: 0.9 }),
    'same inputs must build the same country');
  // A bright, high-crest section erodes down to towers.
  assert.ok([PLATEAU_FORMS.MONUMENT, PLATEAU_FORMS.SPIRE].includes(pickFormation(fixed, { crest: 0.9 })));
  // A bass-heavy one leaves broad layered tables.
  assert.ok([PLATEAU_FORMS.MESA, PLATEAU_FORMS.STAIRCASE].includes(
    pickFormation(fixed, { crest: 0.2, foot: 0.8, spiky: 0.2 })));
  // A leaning section reefs.
  assert.equal(pickFormation(() => 0.1, { tilt: 0.8 }), PLATEAU_FORMS.REEF);
});

test('spikiness chooses towers over tables -- the shape grammar still reaches the rock', () => {
  // Under the alpine model this bent a superellipse exponent. There is no
  // exponent here, so it has to choose the FORMATION instead -- and if it
  // does not, spireMixAdd stops reaching the height field entirely.
  const towerish = (f) => f === PLATEAU_FORMS.MONUMENT || f === PLATEAU_FORMS.SPIRE;
  let spikyTowers = 0, organicTowers = 0;
  for (let i = 0; i < 40; i++) {
    const r = () => (i + 0.5) / 40;
    if (towerish(pickFormation(r, { spiky: 1 }))) spikyTowers++;
    if (towerish(pickFormation(r, { spiky: 0 }))) organicTowers++;
  }
  assert.ok(spikyTowers > organicTowers,
    `a spiky song should erode to towers: ${spikyTowers} vs ${organicTowers}`);
});

test('degenerate input never throws or escapes 0..1', () => {
  for (const name of PLATEAU_FORM_NAMES) {
    for (const d of [-1, 0, 0.5, 1, 2, NaN]) {
      const h = plateauProfile(d, PLATEAU_FORMS[name]);
      assert.ok(Number.isFinite(h) && h >= 0 && h <= 1, `${name} at d=${d}: ${h}`);
    }
  }
  assert.ok(Number.isFinite(plateauProfile(0.5, null)), 'a missing form falls back');
});
