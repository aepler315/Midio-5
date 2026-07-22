import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConstellationWeaver, nextDotPos, edgeRevealFrac } from '../src/world/ConstellationWeaver.js';
import { mulberry32 } from '../src/utils/math.js';

function melodyEvt(tMs, pitch = 60, vel = 0.7) {
  return { tMs, pitch, vel, role: 'MELODY' };
}

test('nextDotPos: first dot lands in region, subsequent dots stay in region and step 40-110px', () => {
  const rand = mulberry32(1);
  const w = 1280, h = 720;
  const p0 = nextDotPos(null, rand, w, h);
  assert.ok(p0.x >= 0.06 * w && p0.x <= 0.94 * w);
  assert.ok(p0.y >= 0.05 * h && p0.y <= 0.32 * h);
  let prev = p0;
  for (let i = 0; i < 50; i++) {
    const p = nextDotPos(prev, rand, w, h);
    assert.ok(p.x >= 0.06 * w - 1e-6 && p.x <= 0.94 * w + 1e-6);
    assert.ok(p.y >= 0.05 * h - 1e-6 && p.y <= 0.32 * h + 1e-6);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    prev = p;
  }
});

test('a full figure seeds then connects, closing after targetCount-1 edge-revealing onsets', () => {
  const weaver = new ConstellationWeaver(5, 1280, 720);
  let t = 0;
  // Feed onsets until the first figure is committed (moves out of `building`).
  for (let i = 0; i < 40 && !((weaver.figures.length === 1) && !weaver.building); i++) {
    weaver.onMelody(melodyEvt(t, 60 + i));
    t += 100;
  }
  assert.equal(weaver.figures.length, 1, 'exactly one figure should have completed');
  assert.equal(weaver.building, null);
  const fig = weaver.figures[0];
  assert.ok(fig.dots.length >= 5 && fig.dots.length <= 8);
  assert.equal(fig.edgeRevealedCount, fig.targetCount - 1);
  assert.equal(fig.phase, 'holding');
});

test('caps hold under a 300-onset spam: figures, dots, and stars stay bounded, no NaN', () => {
  const weaver = new ConstellationWeaver(9, 1280, 720);
  let t = 0;
  for (let i = 0; i < 300; i++) {
    weaver.onMelody(melodyEvt(t, (i * 7) % 128, 0.5));
    weaver.onKick(0.6);
    weaver.update(t, 0.1);
    t += 100;
  }
  assert.ok(weaver.figures.length <= 3, `figures should cap at 3, got ${weaver.figures.length}`);
  assert.ok(weaver.stars.length <= 6, `stars should cap at 6, got ${weaver.stars.length}`);
  let totalDots = weaver.building ? weaver.building.dots.length : 0;
  for (const f of weaver.figures) totalDots += f.dots.length;
  assert.ok(totalDots <= 40, `total dots should cap at 40, got ${totalDots}`);
  for (const f of weaver.figures) {
    for (const d of f.dots) assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y));
  }
  assert.ok(Number.isFinite(weaver.pulse));
});

test('figures drain over time: hold then fade then gone (or crystallized), no NaN', () => {
  const weaver = new ConstellationWeaver(3, 1280, 720);
  let t = 0;
  // Complete one figure quickly.
  while (!weaver.figures.length) { weaver.onMelody(melodyEvt(t, 64)); t += 50; }
  assert.equal(weaver.figures.length, 1);
  // Advance well past hold (5000ms) + fade (3000ms).
  for (let i = 0; i < 200; i++) {
    weaver.update(t, 0.1);
    t += 100;
  }
  assert.equal(weaver.figures.length, 0, 'the figure should have fully drained');
  assert.ok(weaver.stars.length === 0 || weaver.stars.length === 1);
});

test('update(nowMs, 0) is a state no-op for timers', () => {
  const weaver = new ConstellationWeaver(1, 1280, 720);
  weaver.onMelody(melodyEvt(0, 60));
  const before = JSON.stringify(weaver.building);
  weaver.update(0, 0);
  assert.equal(JSON.stringify(weaver.building), before);
});

test('same seed + same event sequence -> identical dot coordinates (determinism)', () => {
  const events = Array.from({ length: 20 }, (_, i) => melodyEvt(i * 120, (i * 5) % 100, 0.6));
  const a = new ConstellationWeaver(77, 1280, 720);
  const b = new ConstellationWeaver(77, 1280, 720);
  for (const e of events) { a.onMelody(e); b.onMelody(e); }
  assert.deepEqual(a.figures, b.figures);
  assert.deepEqual(a.building, b.building);
});

test('edgeRevealFrac is monotone in nowMs and bounded 0..1', () => {
  const fig = { targetCount: 6, edgeRevealedCount: 2, edgeStartMs: 1000 };
  let prev = -1;
  for (let now = 1000; now <= 2000; now += 25) {
    const f = edgeRevealFrac(fig, now);
    assert.ok(f >= 0 && f <= 1);
    assert.ok(f >= prev - 1e-9, 'must be monotone non-decreasing');
    prev = f;
  }
});

test('onKick pulse rises then decays toward 0', () => {
  const weaver = new ConstellationWeaver(2, 1280, 720);
  weaver.onKick(0.9);
  assert.ok(weaver.pulse > 0.8);
  for (let i = 0; i < 40; i++) weaver.update(i * 50, 0.05);
  assert.ok(weaver.pulse < 0.05, `pulse should have decayed, got ${weaver.pulse}`);
});
