import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropImpactStrength, speedLineSegments } from '../src/render/Renderer.js';

test('dropImpactStrength is 0 with no drop yet (dropAtMs = -Infinity, HypeDirector\'s initial state)', () => {
  assert.equal(dropImpactStrength(0, -Infinity), 0);
  assert.equal(dropImpactStrength(100000, -Infinity), 0);
});

test('dropImpactStrength peaks at 1 right at the drop and eases to 0 by the end of its life', () => {
  assert.equal(dropImpactStrength(1000, 1000), 1);
  assert.ok(dropImpactStrength(1319, 1000) > 0, 'should still be positive just before the life ends');
  assert.equal(dropImpactStrength(1320, 1000), 0, 'exactly at DROP_IMPACT_LIFE_MS should be 0');
  assert.equal(dropImpactStrength(2000, 1000), 0);
});

test('dropImpactStrength is 0 before the drop (negative age) and decreases monotonically after it', () => {
  assert.equal(dropImpactStrength(999, 1000), 0);
  let prev = dropImpactStrength(1000, 1000);
  for (let age = 10; age <= 320; age += 10) {
    const v = dropImpactStrength(1000 + age, 1000);
    assert.ok(v <= prev + 1e-9, `must ease down monotonically, age=${age}`);
    prev = v;
  }
});

test('speedLineSegments returns exactly `count` segments', () => {
  const segs = speedLineSegments(100, 100, 24, 1, 3, 500);
  assert.equal(segs.length, 24);
});

test('speedLineSegments: every segment stays within [0.55, 0.75+0.25*s] of maxR from center', () => {
  const cx = 200, cy = 150, maxR = 400;
  for (const s of [0, 0.5, 1]) {
    const segs = speedLineSegments(cx, cy, 24, s, 7, maxR);
    for (const seg of segs) {
      const rInner = Math.hypot(seg.x0 - cx, seg.y0 - cy);
      const rOuter = Math.hypot(seg.x1 - cx, seg.y1 - cy);
      assert.ok(Math.abs(rInner - 0.55 * maxR) < 1e-6, `inner radius drifted at s=${s}`);
      const expectedOuter = (0.75 + 0.25 * s) * maxR;
      assert.ok(Math.abs(rOuter - expectedOuter) < 1e-6, `outer radius drifted at s=${s}`);
    }
  }
});

test('speedLineSegments is deterministic per seed and varies between different seeds', () => {
  const a = speedLineSegments(0, 0, 12, 1, 5, 300);
  const b = speedLineSegments(0, 0, 12, 1, 5, 300);
  assert.deepEqual(a, b, 'same seed must reproduce the same fan of lines');

  const c = speedLineSegments(0, 0, 12, 1, 6, 300);
  const anyDifferent = a.some((seg, i) => Math.abs(seg.x1 - c[i].x1) > 1e-6 || Math.abs(seg.y1 - c[i].y1) > 1e-6);
  assert.ok(anyDifferent, 'a different seed should rotate the fan');
});
