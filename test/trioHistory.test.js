import test from 'node:test';
import assert from 'node:assert/strict';
import { RidgeMotionHistory, createRidgeMusicSampler } from '../src/world/RidgeMotionHistory.js';
import * as narrative from '../src/world/alpine/RangeNarrative.js';
import { EnergyCurves } from '../src/audio/EnergyCurves.js';

const note = (role, options = {}) => ({ tMs: 100, durMs: 900, vel: .8,
  pitch: 72, src: 'midi', role, ...options });
const history = (timeline, options = {}) => new RidgeMotionHistory({ timeline, durationMs: 4000, ...options });

test('dedicated trio compiler selects musical roles without changing ridge casting', () => {
  assert.equal(typeof narrative.compileTrioSources, 'function');
  const input = { durationMs: 4000, timeline: [note('MELODY'), note('BASS', { pitch: 36, vel: .6 })] };
  const trio = narrative.compileTrioSources(input).sample(200);
  assert.equal(trio.midio.source, 'role:MELODY');
  assert.equal(trio.midasus.source, trio.midio.source, 'shared melodic fallback is identified explicitly');
  assert.equal(trio.broshi.source, 'role:BASS');
  assert.equal(trio.broshi.activity, .6);
  assert.equal(narrative.compileLandscapeSources(input).sample(200).sources.broshi.source, 'role:MELODY');
});

test('canonical MIDI trio sources answer isolated bass and melody without audio bands', () => {
  const bass = history([note('BASS', { pitch: 36 })]).sample(200);
  assert.equal(bass.trioSources?.broshi.activity, .8);
  assert.equal(bass.trioSources.midio.activity, 0);
  assert.equal(bass.trioSources.midasus.activity, 0);
  const melody = history([note('MELODY')]).sample(200);
  assert.equal(melody.trioSources.broshi.activity, 0);
  assert.equal(melody.trioSources.midio.activity, .8);
  assert.equal(melody.trioSources.midasus.activity, .8);
});

test('explicit trio lanes retain ownership across nonstandard role labels', () => {
  const h = history([
    note('PAD', { lane: 'MIDIO', vel: .3 }),
    note('MELODY', { lane: 'BROSHI', vel: .5 }),
    note('PAD', { lane: 'MIDASUS', vel: .7 }),
  ]);
  const s = h.sample(200).trioSources;
  assert.equal(s?.midio.source, 'lane:MIDIO');
  assert.equal(s.broshi.source, 'lane:BROSHI');
  assert.equal(s.midasus.source, 'lane:MIDASUS');
  assert.deepEqual(Object.values(s).map(v => v.activity), [.3, .5, .7]);
});

test('trio history excludes future notes and preserves snapshots after backward seek', () => {
  const h = history([note('BASS', { tMs: 1000 }), note('MELODY', { tMs: 2000 })]);
  const before = h.sample(999);
  assert.equal(before.trioSources?.broshi.activity, 0);
  assert.equal(before.trioSources.midio.activity, 0);
  const early = h.sample(1100);
  h.sample(3000); h.sample(0);
  assert.deepEqual(h.sample(1100), early);
  assert.ok(Object.isFrozen(early.trioSources) && Object.isFrozen(early.trioSources.broshi));
});

test('synthetic pitch cannot steer trio gestures while tracked confidence retains its weight', () => {
  const c = new EnergyCurves(4000, 50);
  c.bands.forEach(b => b.fill(.4));
  c.rmsBands = c.bands.map(b => new Float32Array(b.length).fill(.01));
  const s = history([
    note('MELODY', { lane: 'MIDIO', src: 'audio', pitchProvenance: 'synthetic', pitchConfidence: 1 }),
    note('MELODY', { lane: 'MIDASUS', src: 'audio', pitchProvenance: 'tracked', pitchConfidence: .25 }),
  ], { energyCurves: c }).sample(200).trioSources;
  assert.equal(s?.midio.activity, .8);
  assert.equal(s.midio.pitchActivity, 0);
  assert.equal(s.midio.pitch01, .5);
  assert.equal(s.midasus.pitchActivity, .2);
});

test('physical silence gates recording trio notes and silence retains static source identity', () => {
  const c = new EnergyCurves(4000, 50);
  c.bands.forEach(b => b.fill(.9));
  c.rmsBands = c.bands.map(b => new Float32Array(b.length).fill(1e-6));
  const s = history([note('MELODY', { src: 'audio' }), note('BASS', { src: 'audio' })], { energyCurves: c }).sample(200);
  assert.equal(s.trioSources?.midio.activity, 0);
  assert.equal(s.trioSources.broshi.pitchActivity, 0);
  assert.equal(s.trioSources.broshi.source, 'role:BASS');
});

test('canonical handoff blends trio ownership and deduplicates shared melodic fallback', () => {
  const previous = history([note('MELODY', { durMs: 3000 })], { generation: 'opening' });
  const primary = history([note('PAD', { lane: 'MIDASUS', pitch: 84, durMs: 3000 })], { generation: 'final' });
  const make = () => createRidgeMusicSampler({ previous, primary, handoffStartMs: 1000 });
  const sampler = make();
  assert.equal(sampler.sample(1000), previous.sample(1000));
  const middle = sampler.sample(1250);
  assert.equal(middle.trioSources?.midasus.source, null);
  assert.deepEqual(middle.trioSources.midasus.contributors.map(c => [c.source, c.activity]), [['role:MELODY', .4], ['lane:MIDASUS', .4]]);
  assert.equal(middle.trioSources.midio.activity, .4);
  assert.equal(middle.trioSources.broshi.activity, 0);
  assert.deepEqual(Object.values(middle.trioSourceContributions).filter(c => c.activity > 0).map(c => [c.source, c.activity]), [['role:MELODY', .4], ['lane:MIDASUS', .4]]);
  assert.deepEqual(make().sample(1250), middle);
  assert.equal(sampler.sample(1500), primary.sample(1500));
});

test('handoff pitch retains evidence-weighted height when one source has no measured pitch', () => {
  const previous = history([note('MELODY', { pitch: 84, durMs: 3000 })]);
  const primary = history([note('MELODY', { pitch: 36, pitchProvenance: 'synthetic', durMs: 3000 })]);
  const sampler = createRidgeMusicSampler({ previous, primary, handoffStartMs: 1000 });
  const mid = sampler.sample(1250).trioSources;
  assert.equal(mid?.midasus.pitchActivity, .4);
  assert.ok(Math.abs(mid.midasus.pitch01 - .8) < 1e-12, 'untrusted replacement pitch cannot bend the trusted gesture');
});
