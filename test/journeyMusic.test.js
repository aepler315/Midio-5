import test from 'node:test';
import assert from 'node:assert/strict';
import { EnergyCurves } from '../src/audio/EnergyCurves.js';
import { RidgeMotionHistory, createRidgeMusicSampler } from '../src/world/RidgeMotionHistory.js';

const durationMs = 8000;
const note = (options = {}) => ({ tMs: 100, durMs: 6000, vel: .9, pitch: 90,
  role: 'MELODY', src: 'midi', ...options });
function curves({ level = .8, rms = .01, rateHz = 50, silenceMs = Infinity } = {}) {
  const result = new EnergyCurves(durationMs, rateHz);
  result.bands.forEach(band => band.fill(level));
  result.rmsBands = result.bands.map(band => new Float32Array(band.length).fill(rms));
  if (Number.isFinite(silenceMs)) {
    const edge = Math.round(silenceMs * rateHz / 1000);
    result.bands.forEach(band => band.fill(0, edge));
    result.rmsBands.forEach(band => band.fill(0, edge));
  }
  return result;
}
const history = options => new RidgeMotionHistory({ durationMs, ...options });
function journeyAt(input, timeMs) {
  const result = input.sample(timeMs).journey;
  assert.ok(result, 'the canonical history supplies an additive journey snapshot');
  return result;
}
function assertBounded(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `${value} must be finite and bounded`);
  else Object.values(value).forEach(assertBounded);
}

test('journey snapshots expose frozen, bounded music without changing legacy source gating', () => {
  const h = history({ energyCurves: curves({ silenceMs: 1000 }), timeline: [note({ src: 'audio', pitchConfidence: 1, pitchProvenance: 'tracked' })] });
  const snapshot = h.sample(1020), journey = journeyAt(h, 1020);
  assert.deepEqual(Object.keys(journey).sort(), ['bands', 'bass01', 'energy01', 'melody01', 'presence01', 'pulse01', 'sources']);
  assert.deepEqual(Object.keys(journey.sources).sort(), ['broshi', 'midasus', 'midio']);
  assert.equal(journey.bands.length, 7);
  for (const source of Object.values(journey.sources)) {
    assert.deepEqual(Object.keys(source).sort(), ['activity', 'pitch01', 'pitchActivity']);
    assert.ok(Object.isFrozen(source));
  }
  assert.ok(Object.isFrozen(journey) && Object.isFrozen(journey.bands) && Object.isFrozen(journey.sources));
  assertBounded(journey);
  assert.equal(snapshot.activity01, 0);
  assert.equal(snapshot.trioSources.midio.activity, 0);
  assert.equal(snapshot.trioSources.midio.pitch01, .5);
  assert.ok(journey.sources.midio.activity > .7, 'the musical body has its own bounded release');
});

test('an actual silence edge releases spatial authority smoothly at 60 Hz and retains pitch', () => {
  const h = history({ energyCurves: curves({ rateHz: 100, silenceMs: 1030 }), timeline: [note({ src: 'audio', pitchConfidence: 1, pitchProvenance: 'tracked' })] });
  const before = journeyAt(h, 1029.999), after = journeyAt(h, 1030.001);
  assert.ok(before.sources.midio.activity > .89);
  assert.ok(Math.abs(before.sources.midio.activity - after.sources.midio.activity) < .00002);
  assert.ok(Math.abs(before.presence01 - after.presence01) < .00002);
  let previous = journeyAt(h, 1010);
  for (let at = 1010 + 1000 / 60; at <= 1800; at += 1000 / 60) {
    const current = journeyAt(h, at);
    for (const key of ['energy01', 'bass01', 'melody01', 'presence01']) {
      assert.ok(Math.abs(current[key] - previous[key]) < .065, `${key} snapped at ${at}ms`);
    }
    const source = current.sources.midio;
    assert.ok(Math.abs(source.pitch01 - .9) < 1e-12, 'the retained note cannot bend toward neutral during release');
    assert.ok(Math.abs(source.pitchActivity * source.pitch01 - previous.sources.midio.pitchActivity * previous.sources.midio.pitch01) < .065);
    previous = current;
  }
  const settled = journeyAt(h, 8000);
  assert.equal(settled.sources.midio.activity, 0);
  assert.equal(settled.sources.midio.pitchActivity, 0);
  assert.equal(settled.sources.midio.pitch01, .5);
  assert.equal(settled.presence01, 0);
  assert.ok(settled.energy01 < 1e-6 && settled.bass01 < .00002 && settled.melody01 === 0);
});

test('a softened kick is causal at an off-grid onset, visible within 160 ms and releases', () => {
  const onset = 137.5;
  const h = history({ timeline: [note({ tMs: onset, durMs: 90, vel: 1, role: 'RHYTHM', kick: true })] });
  assert.equal(journeyAt(h, onset - .001).pulse01, 0);
  assert.equal(journeyAt(h, onset).pulse01, 0);
  assert.ok(journeyAt(h, onset + 1).pulse01 > 0, 'the filter starts on the real event edge');
  assert.ok(journeyAt(h, onset + 120).pulse01 > .65, 'the pulse still reads as the heard kick');
  assert.ok(journeyAt(h, onset + 160).pulse01 > .6);
  assert.ok(journeyAt(h, onset + 700).pulse01 < .25);
  assert.ok(journeyAt(h, onset + 3000).pulse01 < .001);
  let previous = 0;
  for (let at = onset; at < onset + 1000; at += 1000 / 60) {
    const current = journeyAt(h, at).pulse01;
    assert.ok(Math.abs(current - previous) < .22, 'a kick changes continuously at playback cadence');
    previous = current;
  }
  const overlap = history({ timeline: [note({ tMs: onset, role: 'RHYTHM', kick: true }), note({ tMs: onset + 150, vel: .1, role: 'RHYTHM', kick: true })] });
  assert.ok(Math.abs(journeyAt(overlap, onset + 149.999).pulse01 - journeyAt(overlap, onset + 150.001).pulse01) < .00002);
});

test('dedicated lanes retain canonical ownership and only trusted pitch supplies direction', () => {
  const dedicated = history({ timeline: [note({ role: 'PAD', lane: 'MIDASUS', pitch: 84 })] });
  const sample = journeyAt(dedicated, 1000);
  assert.equal(sample.sources.midio.activity, 0);
  assert.equal(sample.sources.broshi.activity, 0);
  assert.ok(sample.sources.midasus.activity > .89);
  assert.ok(Math.abs(sample.sources.midasus.pitch01 - .8) < 1e-12);
  assert.equal(dedicated.sample(1000).trioSources.midasus.source, 'lane:MIDASUS');
  const fallback = journeyAt(history({ timeline: [note({ role: 'BASS', pitch: 36 }), note()] }), 1000);
  assert.ok(fallback.sources.broshi.activity > .89 && fallback.bass01 > .89);
  assert.equal(fallback.sources.broshi.pitch01, 0);
  assert.deepEqual(fallback.sources.midio, fallback.sources.midasus, 'a shared melodic fallback stays the same source');
  for (const confidence of [0, .25, 1]) {
    const h = history({ energyCurves: curves(), timeline: [note({ src: 'audio', pitch: 96, pitchConfidence: confidence, pitchProvenance: 'tracked' })] });
    const source = journeyAt(h, 1000).sources.midio;
    assert.ok(Math.abs(source.pitchActivity - source.activity * confidence) < 1e-12);
    assert.equal(source.pitch01, confidence > 0 ? 1 : .5);
  }
  const syntheticLow = history({ timeline: [note({ pitch: 36, pitchProvenance: 'synthetic' })] });
  const syntheticHigh = history({ timeline: [note({ pitch: 96, pitchProvenance: 'synthetic' })] });
  assert.deepEqual(journeyAt(syntheticLow, 1000), journeyAt(syntheticHigh, 1000));
  assert.equal(journeyAt(syntheticLow, 1000).sources.midio.pitchActivity, 0);
});

test('pitch retains its weighted note when confidence ends before audible source activity', () => {
  const h = history({ timeline: [note({ durMs: 400 }), note({ tMs: 500, pitch: 36, pitchProvenance: 'synthetic' })] });
  for (const at of [620, 700, 900, 1200]) {
    const source = journeyAt(h, at).sources.midio;
    assert.ok(source.activity > .8 && source.pitchActivity > .01);
    assert.ok(Math.abs(source.pitch01 - .9) < 1e-12);
  }
  assert.equal(journeyAt(h, 5000).sources.midio.pitchActivity, 0);
  assert.equal(journeyAt(h, 5000).sources.midio.pitch01, .5);
});

test('curve and note edges contribute only after they arrive, including partial canonical ticks', () => {
  const c = curves({ level: 0, rms: 0, rateHz: 100 });
  c.bands.forEach(band => { band[3] = .9; });
  c.rmsBands.forEach(band => { band[3] = .01; });
  const input = { energyCurves: c, timeline: [note({ tMs: 0, src: 'audio', pitchProvenance: 'tracked', pitchConfidence: 1 })] };
  const h = history(input), cold = history(input);
  assert.equal(journeyAt(h, 29).sources.midio.activity, 0);
  assert.equal(journeyAt(h, 30).sources.midio.activity, 0);
  assert.ok(journeyAt(h, 31).sources.midio.activity > 0);
  const arrived = journeyAt(h, 40).sources.midio.activity;
  assert.ok(arrived > journeyAt(h, 30).sources.midio.activity);
  assert.ok(journeyAt(h, 40.1).sources.midio.activity < arrived, 'release starts on the actual source-frame edge');
  journeyAt(h, 3000);
  assert.deepEqual(journeyAt(h, 29), journeyAt(cold, 29));
  const onset = 137.5, midi = history({ timeline: [note({ tMs: onset })] });
  assert.equal(journeyAt(midi, onset).sources.midio.activity, 0);
  assert.ok(journeyAt(midi, onset + 1).sources.midio.activity > 0);
});

test('same-time, cold seek, reverse seek and playback partitions reconstruct identical journey music', () => {
  const input = { energyCurves: curves({ rateHz: 86.1328, silenceMs: 3900 }), timeline: [
    note({ tMs: 137.5, durMs: 900 }), note({ tMs: 2035, role: 'BASS', pitch: 44 }),
    note({ tMs: 2222.25, role: 'RHYTHM', kick: true }), note({ tMs: 2731, lane: 'MIDASUS', pitch: 84 }),
  ] };
  const played = history(input), sparse = history(input), cold = history(input);
  for (let at = 0; at <= 2800; at += 1000 / 60) played.sample(at);
  for (const at of [17, 379, 1477, 2001, 2673]) sparse.sample(at);
  for (const at of [4317.125, 7000, 1999.9, 2000, 2000.001, 2731.25, 137.499, 4317.125]) {
    const expected = journeyAt(cold, at);
    assert.deepEqual(journeyAt(played, at), expected);
    assert.deepEqual(journeyAt(sparse, at), expected);
    assert.equal(played.sample(at), played.sample(at), 'held time reuses the immutable sample');
  }
  assert.ok(played.checkpointCount <= 5, 'journey state shares the compact song checkpoints');
});

test('noise cannot create journey authority, and missing arrays remain finite through release', () => {
  const timeline = [note({ src: 'audio', pitchConfidence: 1, pitchProvenance: 'tracked' }), note({ src: 'audio', role: 'RHYTHM', kick: true })];
  const noise = history({ energyCurves: curves({ rms: 1e-6 }), timeline });
  const quiet = history({ energyCurves: curves({ level: .2, rms: .0001 }), timeline });
  assert.deepEqual(journeyAt(noise, 1000), journeyAt(history(), 1000));
  assert.ok(journeyAt(quiet, 1000).presence01 > .99);
  const c = curves({ silenceMs: 1000 });
  c.bands[6] = new Float32Array(); c.rmsBands[6] = new Float32Array();
  const h = history({ energyCurves: c, timeline });
  for (const at of [NaN, -1, 0, 999, 1000, 1100, 3000, 8000, Infinity]) assertBounded(journeyAt(h, at));
  assert.equal(journeyAt(h, 1000).bands[6], 0);
  assert.ok(journeyAt(h, 1100).sources.midio.activity > .1);
  assert.ok(journeyAt(h, 1100).sources.midio.activity < journeyAt(h, 1000).sources.midio.activity);
});

test('analysis handoff blends every journey channel and weighted pitch without a neutral reset', () => {
  const previous = history({ generation: 'opening', energyCurves: curves({ level: .8 }), timeline: [note({ src: 'audio', pitchProvenance: 'tracked', pitchConfidence: 1 })] });
  const primary = history({ generation: 'final', energyCurves: curves({ level: .2 }), timeline: [note({ pitch: 36, src: 'audio', pitchProvenance: 'tracked', pitchConfidence: .25 })] });
  const blend = createRidgeMusicSampler({ primary, previous, handoffStartMs: 2000 });
  assert.equal(blend.sample(2000), previous.sample(2000));
  assert.equal(blend.sample(2500), primary.sample(2500));
  const a = journeyAt(previous, 2250), b = journeyAt(primary, 2250), middle = journeyAt(blend, 2250);
  for (const key of ['energy01', 'bass01', 'melody01', 'pulse01', 'presence01']) assert.equal(middle[key], (a[key] + b[key]) / 2);
  middle.bands.forEach((value, index) => assert.equal(value, (a.bands[index] + b.bands[index]) / 2));
  const x = a.sources.midio, y = b.sources.midio, source = middle.sources.midio;
  assert.equal(source.activity, (x.activity + y.activity) / 2);
  assert.equal(source.pitchActivity, (x.pitchActivity + y.pitchActivity) / 2);
  assert.ok(Math.abs(source.pitch01 - (x.pitchActivity * x.pitch01 + y.pitchActivity * y.pitch01) / (x.pitchActivity + y.pitchActivity)) < 1e-12);
  assert.ok(source.pitch01 > .7, 'a weak new pitch cannot bend the old note as if equally trusted');
  assert.ok(Object.isFrozen(middle) && Object.isFrozen(middle.bands) && Object.isFrozen(source));
  blend.sample(7000); blend.sample(0);
  assert.deepEqual(journeyAt(blend, 2250), middle);
  const toSilence = createRidgeMusicSampler({ previous, primary: history(), handoffStartMs: 2000 });
  for (const at of [2000.001, 2250, 2499]) {
    const retained = journeyAt(toSilence, at).sources.midio;
    assert.ok(retained.pitchActivity > 0);
    assert.ok(Math.abs(retained.pitch01 - .9) < 1e-9);
  }
  for (const edge of [2000, 2500]) {
    const left = journeyAt(blend, edge - .001), right = journeyAt(blend, edge + .001);
    assert.ok(Math.abs(left.sources.midio.pitch01 - right.sources.midio.pitch01) < .00001);
    assert.ok(Math.abs(left.energy01 - right.energy01) < .00001);
  }
});
