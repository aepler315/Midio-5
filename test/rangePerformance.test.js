import test from 'node:test';
import assert from 'node:assert/strict';
import { RidgeMotionHistory, createRidgeMusicSampler } from '../src/world/RidgeMotionHistory.js';
import { EnergyCurves } from '../src/audio/EnergyCurves.js';
import { sampleRangePerformance } from '../src/world/alpine/RangePerformance.js';

const layout = { anchors: { midio: [-700, 825, -6220], broshi: [-520, 825.1, -6080], midasus: [-380, 890.15, -5940] },
  heights: { midio: 28, broshi: 35, midasus: 22 }, right: [-1, 0, 0], forward: [0, 0, 1] };
const note = (role, options = {}) => ({ tMs: 1000, durMs: 1500, vel: .9,
  pitch: 72, src: 'midi', role, ...options });
const make = (timeline, options = {}) => new RidgeMotionHistory({ timeline, durationMs: 6000, ...options });
const frame = (history = make([]), timeMs = 1100, options = {}) =>
  sampleRangePerformance({ timeMs, music: history.sample(timeMs), layout, ...options });
const actor = (snapshot, id) => snapshot.actors.find(value => value.id === id);
const poses = snapshot => snapshot.actors.map(({ id, positionM, heightM, leanRad, turnRad, tailAngle, jawOpen, headAngle, babies }) =>
  ({ id, positionM, heightM, leanRad, turnRad, tailAngle, jawOpen, headAngle, babies }));

test('habitat requires authored world anchors and returns immutable world poses', () => {
  assert.deepEqual(sampleRangePerformance().actors, []);
  assert.equal(sampleRangePerformance({ layout: { ...layout, anchors: {} } }).active, false);
  const snapshot = frame();
  assert.equal(snapshot.active, true);
  assert.deepEqual(actor(snapshot, 'broshi').positionM, layout.anchors.broshi);
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.actors[0].positionM));
  assert.equal(Object.isFrozen(layout.anchors.midio), false, 'sampling must not freeze caller-owned layout');
  assert.ok(!('platform' in snapshot) && !('transform' in snapshot.actors[0]) && !('reflection' in snapshot.actors[0]));
});

test('isolated rhythm, bass and melody reach distinct water responses without lifting grounded roots', () => {
  const quiet = frame(), rhythm = frame(make([note('RHYTHM', { kick: true })]));
  const bass = frame(make([note('BASS', { pitch: 36 })])), melody = frame(make([note('MELODY')]));
  assert.ok(rhythm.waterResponse.rhythm > .2 && rhythm.waterResponse.wake > .1);
  assert.equal(rhythm.waterResponse.bass, 0);
  assert.equal(bass.waterResponse.bass, .9);
  assert.equal(bass.waterResponse.melody, 0);
  assert.equal(melody.waterResponse.melody, .9);
  assert.equal(melody.waterResponse.bass, 0);
  for (const id of ['midio', 'broshi']) {
    assert.deepEqual(actor(rhythm, id).positionM, actor(quiet, id).positionM);
    assert.deepEqual(actor(bass, id).positionM, actor(quiet, id).positionM);
  }
  assert.equal(actor(bass, 'broshi').activity, .9);
  assert.equal(actor(bass, 'midio').activity, 0);
  assert.equal(actor(melody, 'broshi').activity, 0);
  assert.equal(actor(melody, 'midio').source, actor(melody, 'midasus').source);
  assert.equal(actor(melody, 'midio').sharedSource, true);
});

test('dedicated lanes keep their canonical identity and only illuminate their resident', () => {
  const snapshot = frame(make([note('PAD', { lane: 'MIDASUS' })]));
  assert.equal(actor(snapshot, 'midasus').source, 'lane:MIDASUS');
  assert.equal(actor(snapshot, 'midasus').sharedSource, false);
  assert.ok(actor(snapshot, 'midasus').glow > .14);
  assert.equal(actor(snapshot, 'midio').activity, 0);
  assert.equal(actor(snapshot, 'broshi').glow, .14);
});

test('untrusted synthetic pitch preserves musical light without steering a body or firefly', () => {
  const low = frame(make([note('MELODY', { pitch: 36, pitchProvenance: 'synthetic' })]));
  const high = frame(make([note('MELODY', { pitch: 96, pitchProvenance: 'synthetic' })]));
  assert.ok(actor(low, 'midasus').glow > actor(frame(), 'midasus').glow);
  assert.equal(actor(low, 'midasus').pitchActivity, 0);
  assert.deepEqual(low.actors, high.actors);
  const trustedLow = frame(make([note('MELODY', { pitch: 36 })]));
  const trustedHigh = frame(make([note('MELODY', { pitch: 96 })]));
  assert.ok(actor(trustedHigh, 'midasus').positionM[1] > actor(trustedLow, 'midasus').positionM[1]);
});

test('physical silence overrides detected notes and residual motion or bass envelopes', () => {
  const curves = new EnergyCurves(6000, 50);
  curves.bands.forEach(band => band.fill(.9));
  curves.rmsBands = curves.bands.map(band => new Float32Array(band.length).fill(1e-6));
  const history = make([note('MELODY', { src: 'audio' }), note('BASS', { src: 'audio' })], { energyCurves: curves });
  const first = frame(history), later = frame(history, 2200);
  assert.notDeepEqual(poses(first), poses(later));
  assert.deepEqual(poses(first), poses(frame(make([]), 1100)));
  assert.deepEqual(first.waterResponse, { bass: 0, rhythm: 0, melody: 0, wake: 0 });
  const stale = sampleRangePerformance({ layout, timeMs: 2000,
    music: { ...make([note('MELODY'), note('BASS')]).sample(1100), activity01: 0, motionPresence01: 1, bassPressure01: 1 } });
  assert.deepEqual(poses(stale), poses(frame(make([]), 2000)));
  assert.ok(stale.actors.every(value => value.glow === .14 && value.activity === 0));
});

test('future notes do not change idle gestures', () => {
  const history = make([note('MELODY'), note('BASS'), note('RHYTHM', { kick: true })]);
  assert.deepEqual(poses(frame(history, 999)), poses(frame(make([]), 999)));
  assert.deepEqual(poses(frame(history, 6000)), poses(frame(make([]), 6000)));
});

test('forward, backward, held and analysis-handoff sampling reconstruct exactly the same world poses', () => {
  const previous = make([note('MELODY', { durMs: 4000 })]);
  const primary = make([note('MELODY', { lane: 'MIDASUS', pitch: 84, durMs: 4000 }), note('BASS')]);
  const history = createRidgeMusicSampler({ previous, primary, handoffStartMs: 1100 });
  const snapshot = frame(history, 1350);
  frame(history, 5000); frame(history, 500);
  assert.deepEqual(frame(history, 1350), snapshot);
  assert.deepEqual(frame(history, 1350), snapshot);
  assert.equal(actor(snapshot, 'midasus').source, null);
  assert.equal(actor(snapshot, 'midasus').contributors.length, 2);
  assert.ok(Object.isFrozen(actor(snapshot, 'midasus').contributors[0]));
});

test('reduced motion freezes every root, articulation and firefly while retaining musical light', () => {
  const history = make([note('MELODY'), note('BASS'), note('RHYTHM', { kick: true })]);
  const first = frame(history, 1080, { reducedMotion: true });
  const later = frame(history, 2200, { reducedMotion: true });
  assert.deepEqual(poses(first), poses(later));
  assert.deepEqual(poses(first), poses(frame(make([]), 1100, { reducedMotion: true })));
  assert.deepEqual(first.waterResponse, { bass: 0, rhythm: 0, melody: 0, wake: 0 });
  assert.ok(first.actors.every(value => value.glow > .14));
});

test('reduced flash attenuates light modulation without changing any pose', () => {
  const history = make([note('MELODY'), note('BASS'), note('RHYTHM', { kick: true })]);
  const ordinary = frame(history), reduced = frame(history, 1100, { reducedFlash: true });
  assert.deepEqual(poses(ordinary), poses(reduced));
  for (const value of ordinary.actors) {
    assert.ok(actor(reduced, value.id).glow - .14 < (value.glow - .14) * .25);
  }
});

test('sustained music keeps fixed sizes, grounded contact, small drift and slow articulation', () => {
  const music = { activity01: 1, motionPresence01: 1, kick01: 1, bassPressure01: 1,
    trioSources: Object.fromEntries(['midio', 'broshi', 'midasus'].map(id => [id,
      { source: `lane:${id.toUpperCase()}`, activity: 1, pitchActivity: 1, pitch01: 1 }])) };
  let previous;
  for (let timeMs = 0; timeMs <= 60000; timeMs += 100) {
    const snapshot = sampleRangePerformance({ layout, music, timeMs });
    for (const value of snapshot.actors) {
      assert.equal(value.heightM, layout.heights[value.id]);
      if (value.id === 'broshi') assert.deepEqual(value.positionM, layout.anchors.broshi);
      else assert.ok(Math.hypot(...value.positionM.map((v, axis) => v - layout.anchors[value.id][axis])) < (value.id === 'midio' ? 8 : 30));
      if (previous) {
        const old = actor(previous, value.id);
        for (const angle of ['leanRad', 'turnRad', 'tailAngle']) assert.ok(Math.abs(value[angle] - old[angle]) / .1 < .3);
      }
    }
    previous = snapshot;
  }
});
