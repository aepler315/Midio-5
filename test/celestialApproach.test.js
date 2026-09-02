// The sun and moon are coming, not just crossing.
//
// The effect rests entirely on a RATIO: position drifts at a constant, small
// rate while apparent size grows as 1/distance and therefore accelerates.
// Something that has barely moved cannot be close, so the eye files it as far
// away and stops tracking it -- and then it is much too big for the size it
// was, and the only reconciliation is that it is enormous and always was.
// These tests pin that ratio, because either half alone is just a tween.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approachDistance, approachScale, approachedPos, convergencePoint,
  celestialApproach, D_FAR, D_NEAR, MAX_SCALE, CONVERGE_DX, CONVERGE_DY,
} from '../src/world/CelestialApproach.js';

test('it starts at its established size and only ever grows', () => {
  assert.equal(approachScale(0), 1, 'no surprise at the top of the song');
  let prev = 0;
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const s = approachScale(t);
    assert.ok(s >= prev - 1e-9, `shrank at t=${t}`);
    assert.ok(s <= MAX_SCALE + 1e-9, `blew past the cap at t=${t}: ${s}`);
    prev = s;
  }
});

test('the growth is CONVEX -- almost nothing, then a lot', () => {
  // This is what makes it creep up. A linear ramp would be visible the whole
  // way and would never produce the double-take.
  const first = approachScale(0.5) - approachScale(0);
  const second = approachScale(1) - approachScale(0.5);
  assert.ok(second > first * 1.5,
    `the back half must grow far more than the front: ${first} vs ${second}`);
  // And the first quarter should be nearly imperceptible.
  assert.ok(approachScale(0.25) < 1.3, `too much too early: ${approachScale(0.25)}`);
});

test('...while the position drifts at a CONSTANT rate', () => {
  // The other half of the ratio. If the drift accelerated too, the eye would
  // track it as approaching and there would be nothing to misjudge.
  const step = (t) => {
    const a = approachedPos(1000, 100, 0, 0, t);
    const b = approachedPos(1000, 100, 0, 0, t + 0.05);
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  const early = step(0.05), mid = step(0.45), late = step(0.9);
  assert.ok(Math.abs(early - mid) < 1e-6 && Math.abs(mid - late) < 1e-6,
    `drift must be linear: ${early} / ${mid} / ${late}`);
});

test('size outruns motion by a wide margin -- the whole illusion', () => {
  // Over the same span, apparent size more than triples while the body has
  // covered less than three quarters of its (already modest) path.
  const posFrac = (t) => {
    const p = approachedPos(0, 0, 100, 0, t);
    return p.x / 100;
  };
  const sizeGrowth = approachScale(1) / approachScale(0);
  assert.ok(sizeGrowth > 3, `size must change dramatically, got ${sizeGrowth}x`);
  assert.ok(posFrac(1) < 0.8, 'position must not complete its journey');
  // The ratio itself: apparent size changes several times more than the
  // fraction of its path the body has covered.
  assert.ok(sizeGrowth > posFrac(1) * 4,
    `size (${sizeGrowth}x) must outrun travel (${posFrac(1)} of the path)`);
});

test('it converges up and to the left of Midio, and never onto him', () => {
  const c = convergencePoint(640, 500);
  assert.equal(c.x, 640 + CONVERGE_DX);
  assert.equal(c.y, 500 + CONVERGE_DY);
  assert.ok(CONVERGE_DX < 0 && CONVERGE_DY < 0, 'up and to the left');
  // A body on a collision course reads as a threat; this one passes by.
  assert.ok(Math.hypot(CONVERGE_DX, CONVERGE_DY) > 400, 'must not aim at him');
});

test('the orbit is never replaced, only pulled -- it still rises and sets', () => {
  // Two different orbital positions must still map to two different drawn
  // positions at every point in the song, or the body has stopped orbiting
  // and reads as broken rather than as near.
  for (const t of [0, 0.3, 0.7, 1]) {
    const rising = approachedPos(100, 400, 0, 0, t);
    const overhead = approachedPos(900, 80, 0, 0, t);
    assert.ok(Math.abs(rising.x - overhead.x) > 1,
      `orbit collapsed at t=${t}: ${rising.x} vs ${overhead.x}`);
  }
});

test('at the start it sits exactly on its orbit, untouched', () => {
  const p = approachedPos(777, 123, 0, 0, 0);
  assert.equal(p.x, 777);
  assert.equal(p.y, 123);
});

test('distance closes but never reaches zero', () => {
  assert.equal(approachDistance(0), D_FAR);
  assert.equal(approachDistance(1), D_NEAR);
  assert.ok(D_NEAR > 0, 'a zero distance is an infinite size and a divide by zero');
  for (let t = -1; t <= 2; t += 0.1) {
    assert.ok(approachDistance(t) > 0, `non-positive distance at t=${t}`);
    assert.ok(Number.isFinite(approachScale(t)));
  }
});

test('progress outside 0..1 is clamped, not extrapolated', () => {
  assert.equal(approachScale(-5), approachScale(0));
  assert.equal(approachScale(99), approachScale(1));
});

test('the composite hands back everything a frame needs', () => {
  const a = celestialApproach({ orbitX: 900, orbitY: 120, midioX: 400, midioY: 520, progress01: 0.8 });
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
  assert.ok(a.scale > 1 && a.scale <= MAX_SCALE);
  assert.ok(a.distance > 0 && a.distance < D_FAR);
  // Late in the song it should have been dragged well toward the point.
  const target = convergencePoint(400, 520);
  const started = Math.hypot(900 - target.x, 120 - target.y);
  const now = Math.hypot(a.x - target.x, a.y - target.y);
  assert.ok(now < started, 'it should be closer to the convergence point than it started');
});
