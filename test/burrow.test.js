import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Burrow, BurrowPhase } from '../src/sim/Burrow.js';

const STEP_MS = 1000 / 120;

function advance(burrow, t, seconds, worldX = 500, groundField = null) {
  const steps = Math.round((seconds * 1000) / STEP_MS);
  for (let i = 0; i < steps; i++) {
    t += STEP_MS;
    burrow.update(t, STEP_MS / 1000, worldX, groundField);
  }
  return t;
}

function makeMockGroundField() {
  return { calls: [], pulseAt(nowMs, worldX, sagPx, recoverAtMs) { this.calls.push({ nowMs, worldX, sagPx, recoverAtMs }); } };
}

test('a fresh burrow is idle and inactive', () => {
  const b = new Burrow(1);
  assert.equal(b.phase, BurrowPhase.IDLE);
  assert.equal(b.active, false);
  assert.equal(b.depth, 0);
});

test('trigger enters DIG_IN, generates cave geometry, and becomes active', () => {
  const b = new Burrow(1);
  const ok = b.trigger(0, { x: 300, y: 480 }, 500, 480);
  assert.equal(ok, true);
  assert.equal(b.phase, BurrowPhase.DIG_IN);
  assert.equal(b.active, true);
  assert.ok(b.contours.length > 0, 'cave should generate at least one contour');
  for (const c of b.contours) {
    assert.ok(c.points.length >= 3);
    assert.equal(c.insets.length, 2);
  }
});

test('trigger is a no-op while already active', () => {
  const b = new Burrow(1);
  b.trigger(0, { x: 300, y: 480 }, 500, 480);
  const contoursBefore = b.contours;
  const ok = b.trigger(0, { x: 999, y: 999 }, 9999, 480);
  assert.equal(ok, false);
  assert.equal(b.contours, contoursBefore, 'a second trigger must not regenerate the cave');
});

test('the entry point is always in open space, not inside rock', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const b = new Burrow(seed);
    b.trigger(0, { x: 300, y: 480 }, 500, 480);
    const noiseAtEntry = b._noiseAt(b._gx, b._gy);
    assert.ok(noiseAtEntry <= 0.5, `seed ${seed}: entry point should be open, noise=${noiseAtEntry.toFixed(3)}`);
  }
});

test('cave generation is deterministic for a given seed and worldX', () => {
  const a = new Burrow(7);
  const b = new Burrow(7);
  a.trigger(0, { x: 300, y: 480 }, 500, 480);
  b.trigger(0, { x: 300, y: 480 }, 500, 480);
  assert.equal(a.contours.length, b.contours.length);
  assert.deepEqual(a.stalactites, b.stalactites);
  assert.deepEqual(a.stalagmites, b.stalagmites);
  assert.deepEqual(a.crystals, b.crystals);
});

test('phases progress DIG_IN -> TUNNELING -> ERUPT -> IDLE in order', () => {
  const b = new Burrow(2);
  let t = 0;
  b.trigger(t, { x: 300, y: 480 }, 500, 480);
  let elapsed = 0;
  const goTo = (target) => { t = advance(b, t, target - elapsed); elapsed = target; };

  goTo(0.5);
  assert.equal(b.phase, BurrowPhase.DIG_IN);
  goTo(0.9); // past DIG_IN_SEC (0.7)
  assert.equal(b.phase, BurrowPhase.TUNNELING);
  goTo(8.9); // past TUNNEL_SEC (8.0) since entering TUNNELING at 0.7
  assert.equal(b.phase, BurrowPhase.ERUPT);
  goTo(9.5); // past ERUPT_SEC (0.5) since entering ERUPT at ~8.7
  assert.equal(b.phase, BurrowPhase.IDLE);
  assert.equal(b.active, false);
  assert.equal(b.contours.length, 0, 'cave geometry is cleared once he surfaces');
});

test('depth ramps 0->1 during DIG_IN, holds at 1 through TUNNELING, ramps back down in ERUPT', () => {
  const b = new Burrow(3);
  let t = 0;
  b.trigger(t, { x: 300, y: 480 }, 500, 480);
  let elapsed = 0;
  const goTo = (target) => { t = advance(b, t, target - elapsed); elapsed = target; };

  goTo(0.1);
  assert.ok(b.depth > 0 && b.depth < 1, `expected mid-dig depth, got ${b.depth}`);
  goTo(0.8);
  assert.equal(b.phase, BurrowPhase.TUNNELING);
  assert.equal(b.depth, 1);
  goTo(8.8);
  assert.equal(b.phase, BurrowPhase.ERUPT);
  assert.ok(b.depth > 0 && b.depth <= 1, `expected high-but-draining depth early in eruption, got ${b.depth}`);
});

test('forceEnd immediately begins eruption from any active phase', () => {
  const b = new Burrow(4);
  let t = 0;
  b.trigger(t, { x: 300, y: 480 }, 500, 480);
  t = advance(b, t, 2); // now well into TUNNELING
  assert.equal(b.phase, BurrowPhase.TUNNELING);
  b.forceEnd(t);
  assert.equal(b.phase, BurrowPhase.ERUPT);
});

test('forceEnd is a no-op when already idle', () => {
  const b = new Burrow(5);
  b.forceEnd(1000);
  assert.equal(b.phase, BurrowPhase.IDLE);
});

test('steering never advances into rock -- a hard invariant, checked every frame of tunneling', () => {
  for (const seed of [10, 11, 12]) {
    const b = new Burrow(seed);
    let t = 0;
    b.trigger(t, { x: 300, y: 480 }, 500, 480);
    t = advance(b, t, 0.8); // clear DIG_IN
    assert.equal(b.phase, BurrowPhase.TUNNELING);
    for (let i = 0; i < 6 * 120; i++) {
      t += STEP_MS;
      b.update(t, STEP_MS / 1000, 500);
      if (b.phase !== BurrowPhase.TUNNELING) break;
      const noiseHere = b._noiseAt(b._gx, b._gy);
      assert.ok(noiseHere <= 0.5 + 1e-9, `seed ${seed}: swam into rock, noise=${noiseHere.toFixed(3)} at t=${t}`);
    }
  }
});

test('the mole-ridge surface tell pulses the ground field periodically during tunneling', () => {
  const b = new Burrow(6);
  const gf = makeMockGroundField();
  let t = 0;
  b.trigger(t, { x: 300, y: 480 }, 500, 480);
  t = advance(b, t, 0.8, 500, gf); // clear DIG_IN (fires one dig-in pulse)
  const afterDigIn = gf.calls.length;
  assert.ok(afterDigIn >= 1, 'DIG_IN should fire one ground pulse');
  advance(b, t, 4, 500, gf); // several ridge periods (1.0s each)
  assert.ok(gf.calls.length > afterDigIn + 1, 'tunneling should fire multiple mole-ridge pulses over 4s');
});

test('eruption fires a ground pulse at the surface point', () => {
  const b = new Burrow(8);
  const gf = makeMockGroundField();
  let t = 0;
  b.trigger(t, { x: 300, y: 480 }, 500, 480);
  t = advance(b, t, 8.8, 500, gf); // clear DIG_IN + TUNNELING
  assert.equal(b.phase, BurrowPhase.ERUPT);
  const eruptCall = gf.calls[gf.calls.length - 1];
  assert.ok(eruptCall.sagPx > 30, 'eruption pulse should be a pronounced sag, not a small ridge tick');
});

test('a full burrow cycle never produces NaN/Infinity', () => {
  const b = new Burrow(9);
  let t = 0;
  b.trigger(t, { x: 300, y: 480 }, 500, 480);
  for (let i = 0; i < 10 * 120; i++) {
    t += STEP_MS;
    b.update(t, STEP_MS / 1000, 500);
    assert.ok(Number.isFinite(b.p.x) && Number.isFinite(b.p.y), `position finite at t=${t}`);
    assert.ok(Number.isFinite(b.depth), `depth finite at t=${t}`);
  }
});

test('stalactites and stalagmites stay within the reasonable spike cap', () => {
  for (const seed of [20, 21, 22]) {
    const b = new Burrow(seed);
    b.trigger(0, { x: 300, y: 480 }, 500, 480);
    assert.ok(b.stalactites.length + b.stalagmites.length <= 14);
    assert.ok(b.crystals.length <= 5);
  }
});
