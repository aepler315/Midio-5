// LiveEnergyCurves has to be indistinguishable from EnergyCurves to every
// consumer in the engine while being filled in from a microphone as the song
// happens. These pin the two places that is not free: writing forward across
// gaps, and computing percentiles over an unfinished song.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveEnergyCurves, CALIBRATION_WARMUP_MS } from '../src/audio/LiveEnergyCurves.js';
import { EnergyCurves } from '../src/audio/EnergyCurves.js';
import { BANDS, FLAT_WEIGHTS } from '../src/audio/bands.js';

const flat = (v) => new Array(BANDS.length).fill(v);

test('it is an EnergyCurves, so every existing consumer keeps working', () => {
  const c = new LiveEnergyCurves(60000);
  assert.ok(c instanceof EnergyCurves);
  for (const m of ['sample', 'sampleAll', 'globalEnergy', 'globalEnergyNorm', 'calibration']) {
    assert.equal(typeof c[m], 'function', `${m} must still be callable`);
  }
});

test('a written frame reads back at the time it was written', () => {
  const c = new LiveEnergyCurves(60000);
  c.writeAt(1000, flat(0.5));
  assert.ok(Math.abs(c.sample(0, 1000) - 0.5) < 1e-6);
});

test('nothing has been heard before the first write', () => {
  const c = new LiveEnergyCurves(60000);
  assert.equal(c.hasSignal, false);
  c.writeAt(0, flat(0.2));
  assert.equal(c.hasSignal, true);
});

test('a gap is filled by holding the new value backward, not by a ramp', () => {
  // A dropped frame or a 250ms hitch must not leave a trench of zeros in the
  // curve -- downstream that reads as a sudden silence that never happened.
  const c = new LiveEnergyCurves(60000);
  c.writeAt(0, flat(0.4));
  c.writeAt(500, flat(0.8)); // ~25 frames skipped at 50Hz
  for (let t = 20; t <= 500; t += 20) {
    assert.ok(c.sample(0, t) > 0.3, `t=${t} must not read as silence`);
  }
  // Held, not interpolated: the middle of the gap is the NEW value, because
  // nothing was actually heard rising through it.
  assert.ok(Math.abs(c.sample(0, 250) - 0.8) < 1e-6);
});

test('a write far ahead of the buffer clamps instead of throwing', () => {
  const c = new LiveEnergyCurves(10000);
  c.writeAt(999999, flat(0.7));
  assert.ok(Number.isFinite(c.sample(0, 9000)));
});

test('calibration is cold until enough has been heard', () => {
  const c = new LiveEnergyCurves(60000);
  for (let t = 0; t < CALIBRATION_WARMUP_MS - 500; t += 20) c.writeAt(t, flat(t / 100000));
  const cal = c.calibration(FLAT_WEIGHTS);
  assert.equal(cal.spread, 0, 'no dynamic range may be claimed before there is one');
});

test('a zero spread makes globalEnergyNorm fall through to the raw value', () => {
  // This is the contract that makes the cold start safe: the base class
  // already treats spread<=0 as "return the absolute reading".
  const c = new LiveEnergyCurves(60000);
  c.writeAt(0, flat(0.5));
  const norm = c.globalEnergyNorm(0, FLAT_WEIGHTS);
  assert.ok(norm > 0.4 && norm < 0.6, `expected the raw value, got ${norm}`);
});

test('after warmup, percentiles come from what was actually heard', () => {
  const c = new LiveEnergyCurves(120000);
  // A quiet half then a loud half: p10 should sit in the quiet, p90 in the loud.
  for (let t = 0; t < 10000; t += 20) c.writeAt(t, flat(0.1));
  for (let t = 10000; t < 20000; t += 20) c.writeAt(t, flat(0.9));
  const cal = c.calibration(FLAT_WEIGHTS);
  assert.ok(cal.lo < 0.3, `p10 should be quiet, got ${cal.lo}`);
  assert.ok(cal.hi > 0.7, `p90 should be loud, got ${cal.hi}`);
  assert.ok(cal.spread > 0.5);
});

test('calibration only looks at written frames, not the empty tail', () => {
  // The buffer is sized for a nominal song length; treating its unwritten
  // remainder as heard silence would drag p10 to zero forever and stretch
  // every quiet moment into a false drop.
  const c = new LiveEnergyCurves(600000); // ten minutes of buffer
  for (let t = 0; t < 20000; t += 20) c.writeAt(t, flat(0.5 + 0.3 * Math.sin(t / 700)));
  const cal = c.calibration(FLAT_WEIGHTS);
  assert.ok(cal.lo > 0.1, `p10 must not be dragged to zero by unheard frames, got ${cal.lo}`);
});

test('calibration is not recomputed on every frame', () => {
  // The base class clears its cache on every write; doing the full sort per
  // rendered frame is the one thing that would make listening cost more than
  // the show it drives.
  const c = new LiveEnergyCurves(120000);
  for (let t = 0; t < 20000; t += 20) c.writeAt(t, flat(0.5));
  let sorts = 0;
  const cal1 = c.calibration(FLAT_WEIGHTS);
  const origSort = Float64Array.prototype.sort;
  Float64Array.prototype.sort = function patched(...args) { sorts++; return origSort.apply(this, args); };
  try {
    for (let i = 0; i < 30; i++) { c.writeAt(20000 + i * 20, flat(0.5)); c.calibration(FLAT_WEIGHTS); }
  } finally {
    Float64Array.prototype.sort = origSort;
  }
  assert.equal(sorts, 0, 'a 600ms burst of frames must not trigger a recompute');
  assert.deepEqual(c.calibration(FLAT_WEIGHTS), cal1);
});

test('sampling a time that has not been heard yet returns silence, not garbage', () => {
  const c = new LiveEnergyCurves(60000);
  c.writeAt(1000, flat(0.8));
  assert.equal(c.sample(0, 30000), 0);
});

test('a query just past the last write holds rather than reading as silence', () => {
  // The fixed-step integrator can be a step or two ahead of the last pump.
  // A hard zero there is indistinguishable downstream from the song stopping.
  const c = new LiveEnergyCurves(60000);
  c.writeAt(1000, flat(0.8));
  assert.ok(c.sample(0, 1060) > 0.7, 'the value should still be held 60ms on');
  assert.equal(c.writtenTo, 50, 'but only what was heard counts as written');
});

test('the forward hold is not counted as heard by the calibration', () => {
  const c = new LiveEnergyCurves(120000);
  // The last write is at t=19980, which is frame 999 at 50Hz. The hold
  // reaches frames 1000-1007; none of them may move the frontier.
  for (let t = 0; t < 20000; t += 20) c.writeAt(t, flat(0.5));
  assert.equal(c.writtenTo, 999);
});
