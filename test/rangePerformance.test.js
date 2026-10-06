import test from 'node:test';
import assert from 'node:assert/strict';
import { RidgeMotionHistory, createRidgeMusicSampler } from '../src/world/RidgeMotionHistory.js';
let api = {};
try { api = await import('../src/world/alpine/RangePerformance.js'); }
catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }

const note = (role, options = {}) => ({ tMs: 1000, durMs: 1500, vel: .9,
  pitch: 72, src: 'midi', role, ...options });
const make = timeline => new RidgeMotionHistory({ timeline, durationMs: 6000 });
function frame(history = make([]), timeMs = 1100, options = {}) {
  assert.equal(typeof api.sampleRangePerformance, 'function', 'passive sampler is available');
  return api.sampleRangePerformance({ timeMs, music: history.sample(timeMs), width: 1280, height: 720, ...options });
}
const actor = (f, id) => f.actors.find(a => a.id === id);
function recordingContext() {
  const commands = [], paint = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {},
    moveTo(...v) { commands.push(v); }, lineTo(...v) { commands.push(v); },
    rect(...v) { commands.push(v); }, ellipse(...v) { commands.push(v); },
    arc(...v) { commands.push(v); }, fill() { paint.push({ kind: 'fill', color: this.fillStyle, alpha: this.globalAlpha }); },
    stroke() { paint.push({ kind: 'stroke', color: this.strokeStyle, alpha: this.globalAlpha }); },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    drawImage() { assert.fail('passive stage must not allocate or sample capture canvases'); },
    fillRect() { assert.fail('passive stage must not cover the geographic lake with a rectangular overlay'); },
    globalAlpha: 1, globalCompositeOperation: 'source-over' };
  return { ctx, commands, paint };
}

test('passive stage answers isolated rhythm, bass and melody with distinguishable poses', () => {
  const quiet = frame(), rhythm = frame(make([note('RHYTHM', { kick: true })]));
  const bass = frame(make([note('BASS', { pitch: 36 })]));
  const melody = frame(make([note('MELODY')]));
  assert.ok(actor(rhythm, 'midio').hopPx > actor(quiet, 'midio').hopPx + 10);
  assert.ok(actor(bass, 'broshi').activity > .8);
  assert.equal(actor(bass, 'midio').activity, 0);
  assert.equal(actor(bass, 'midasus').activity, 0);
  assert.notDeepEqual(actor(bass, 'broshi').transform, actor(quiet, 'broshi').transform);
  assert.equal(actor(melody, 'broshi').activity, 0);
  assert.notDeepEqual(actor(melody, 'midio').transform, actor(quiet, 'midio').transform);
  assert.notDeepEqual(actor(melody, 'midasus').transform, actor(quiet, 'midasus').transform);
  assert.equal(actor(melody, 'midio').source, actor(melody, 'midasus').source);
  assert.equal(actor(melody, 'midio').sharedSource, true);
});

test('untrusted synthetic pitch retains note glow but cannot choose melodic height', () => {
  const low = frame(make([note('MELODY', { pitch: 36, pitchProvenance: 'synthetic' })]));
  const high = frame(make([note('MELODY', { pitch: 96, pitchProvenance: 'synthetic' })]));
  assert.ok(actor(low, 'midasus').glow > actor(frame(), 'midasus').glow);
  assert.equal(actor(low, 'midasus').pitchActivity, 0);
  assert.deepEqual(low.actors, high.actors, 'synthetic placeholder pitch cannot change any gesture');
  const trustedLow = frame(make([note('MELODY', { pitch: 36 })]));
  const trustedHigh = frame(make([note('MELODY', { pitch: 96 })]));
  assert.ok(actor(trustedHigh, 'midasus').transform.ty < actor(trustedLow, 'midasus').transform.ty);
});

test('future notes do not move the trio and all figures settle after silence', () => {
  const h = make([note('MELODY'), note('BASS'), note('RHYTHM', { kick: true })]);
  assert.deepEqual(frame(h, 999).actors, frame(make([]), 999).actors);
  const early = frame(h, 1100);
  frame(h, 5000); frame(h, 0);
  assert.deepEqual(frame(h, 1100), early);
  const rest = frame(make([]), 5000), settled = frame(h, 6000);
  assert.deepEqual(settled.actors.map(a => a.transform), rest.actors.map(a => a.transform));
});

test('canonical analysis handoff reconstructs the same immutable passive stage', () => {
  const previous = make([note('MELODY', { durMs: 4000 })]);
  const primary = make([note('MELODY', { lane: 'MIDASUS', pitch: 84, durMs: 4000 }), note('BASS')]);
  const history = createRidgeMusicSampler({ previous, primary, handoffStartMs: 1100 });
  const f = frame(history, 1350);
  frame(history, 5000); frame(history, 500);
  assert.deepEqual(frame(history, 1350), f);
  assert.ok(Object.isFrozen(f) && Object.isFrozen(f.actors) && Object.isFrozen(f.actors[0].transform));
  assert.equal(actor(f, 'midasus').source, null);
  assert.equal(actor(f, 'midasus').contributors.length, 2);
});

test('reduced motion freezes hops, body transforms and star orbits while retaining figures', () => {
  const h = make([note('MELODY'), note('BASS'), note('RHYTHM', { kick: true })]);
  const first = frame(h, 1080, { reducedMotion: true }), later = frame(h, 1200, { reducedMotion: true });
  assert.equal(first.actors.length, 3);
  for (const a of first.actors) { assert.equal(a.hopPx, 0); assert.equal(a.transform.rot, 0); }
  assert.deepEqual(first.actors.map(a => a.transform), later.actors.map(a => a.transform));
  assert.deepEqual(actor(first, 'midasus').babies, actor(later, 'midasus').babies);
});

test('reduced flash softens transient glow without suppressing musical motion', () => {
  const h = make([note('MELODY'), note('BASS'), note('RHYTHM', { kick: true })]);
  const ordinary = frame(h), reduced = frame(h, 1100, { reducedFlash: true });
  assert.deepEqual(ordinary.actors.map(a => a.transform), reduced.actors.map(a => a.transform));
  for (const a of ordinary.actors) assert.ok(actor(reduced, a.id).glow < a.glow);
});

test('the small platform and complete trio remain bounded at portrait and wide output sizes', () => {
  const h = make([note('MELODY', { pitch: 96 }), note('BASS'), note('RHYTHM', { kick: true })]);
  for (const [width, height] of [[1280, 720], [360, 640], [640, 360], [2560, 720], [320, 240]]) {
    for (const timeMs of [0, 1080, 1273, 2400, 5000]) {
      const f = frame(h, timeMs, { width, height });
      assert.ok(Math.abs(f.platform.x / width - .3) < .02);
      assert.ok(f.platform.width < width * .36, 'platform is a shared small dock, not a foreground wall');
      assert.ok(f.platform.y > height * .76 && f.platform.y < height * .86);
      assert.ok(f.bounds.x >= 0 && f.bounds.y >= 0);
      assert.ok(f.bounds.x + f.bounds.width <= width && f.bounds.y + f.bounds.height <= height,
        `complete drawn stage fits ${width}x${height} at ${timeMs}: ${JSON.stringify(f.bounds)}`);
    }
  }
});

test('pure painter draws three identifiable glyphs, local reflections and a small physical dock', () => {
  const f = frame(make([note('MELODY'), note('BASS'), note('RHYTHM', { kick: true })]));
  assert.equal(typeof api.drawRangePerformance, 'function');
  const { ctx, commands, paint } = recordingContext();
  const before = JSON.stringify(f);
  const diagnostic = api.drawRangePerformance(ctx, f, { light: { x: 900, y: 100, intensity: .5, colorHex: '#dde5ff' } });
  assert.equal(diagnostic.actorCount, 3);
  assert.equal(diagnostic.reflectionCount, 3);
  assert.deepEqual(Object.keys(diagnostic.actorBounds), ['midio', 'broshi', 'midasus']);
  assert.deepEqual(diagnostic.bounds, f.bounds);
  assert.ok(paint.filter(p => p.kind === 'stroke').length > 65, 'mesh edges and physical dock edges reach the real painter');
  for (const hue of [178, 16, 276]) assert.ok(paint.some(p => typeof p.color === 'string' && p.color.includes(`(${hue},`)), `identity hue ${hue} is painted`);
  assert.ok(commands.flat().every(Number.isFinite), 'no non-finite geometry reaches Canvas');
  assert.equal(JSON.stringify(f), before, 'drawing does not mutate immutable performance state');
});
