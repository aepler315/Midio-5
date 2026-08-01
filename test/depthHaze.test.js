import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hazeAlpha, hazeWarmMix, HAZE_WARM_MIX } from '../src/world/DepthHaze.js';

test('haze accumulates more atmosphere on farther layers', () => {
  const l2 = hazeAlpha('L2', 1, 0), l3 = hazeAlpha('L3', 1, 0), l4 = hazeAlpha('L4', 1, 0), l5 = hazeAlpha('L5', 1, 0);
  assert.ok(l2 > l3 && l3 > l4, `expected L2 > L3 > L4, got ${l2}, ${l3}, ${l4}`);
  assert.equal(l5, 0, 'nearest range must never wash -- it stays the crisp foreground anchor');
});

test('hazeAlpha stays within a sane bound across the personality dial range', () => {
  for (const layer of ['L2', 'L3', 'L4', 'L5']) {
    for (const mul of [0, 0.3, 1, 1.6, 2.5]) {
      for (const calm of [0, 0.5, 1]) {
        const a = hazeAlpha(layer, mul, calm);
        assert.ok(a >= 0 && a <= 1, `hazeAlpha(${layer},${mul},${calm}) out of range: ${a}`);
      }
    }
  }
});

test('a higher haze dial thickens every hazed layer without inverting far>near order', () => {
  for (const layer of ['L2', 'L3', 'L4']) {
    const crisp = hazeAlpha(layer, 0.3, 0); // CYBER-like
    const baked = hazeAlpha(layer, 1.6, 0); // SOLAR-like
    assert.ok(baked > crisp, `${layer}: baked (${baked}) should exceed crisp (${crisp})`);
  }
});

test('calm sections thicken haze slightly but modestly', () => {
  const base = hazeAlpha('L2', 1, 0);
  const calm = hazeAlpha('L2', 1, 1);
  assert.ok(calm > base, 'calm should thicken haze');
  assert.ok(calm < base * 1.5, `calm boost too strong: ${calm} vs base ${base}`);
});

test('an unknown/future layer key silently no-ops rather than throwing', () => {
  assert.equal(hazeAlpha('L9', 1, 1), 0);
});

test('hazeWarmMix is 0 at hazeWarm=0, rises monotonically, and never exceeds HAZE_WARM_MIX', () => {
  assert.equal(hazeWarmMix(0), 0);
  assert.ok(hazeWarmMix(1) > hazeWarmMix(0.3));
  assert.ok(hazeWarmMix(1) <= HAZE_WARM_MIX + 1e-9);
});
