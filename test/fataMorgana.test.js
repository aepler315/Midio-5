import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mirageRecipe, mirageHeight01, mirageShimmerPx, miragePresence01,
} from '../src/world/FataMorgana.js';

test('mirageRecipe is deterministic for a given seed', () => {
  const a = mirageRecipe(42);
  const b = mirageRecipe(42);
  assert.deepEqual(a, b);
});

test('mirageHeight01 wraps seamlessly at the tile edge (u=0 and u=1 agree)', () => {
  const recipe = mirageRecipe(7);
  for (let i = 0; i < 20; i++) {
    const u = i / 20;
    assert.ok(Math.abs(mirageHeight01(recipe, u) - mirageHeight01(recipe, u + 1)) < 1e-9);
  }
});

test('mirageHeight01 stays non-negative and finite across the whole tile', () => {
  const recipe = mirageRecipe(3);
  for (let i = 0; i < 500; i++) {
    const h = mirageHeight01(recipe, i / 500);
    assert.ok(Number.isFinite(h));
    assert.ok(h >= 0);
  }
});

test('mirageHeight01 is jagged: many narrow local peaks, unlike a smooth lobe field', () => {
  // Sharpness is the whole point of the mirage silhouette (vs. FarShore's
  // broad, smooth lobes) -- sample densely and count sign changes in the
  // slope as a proxy for "how many separate summits read as distinct."
  const recipe = mirageRecipe(11);
  const N = 2000;
  let signChanges = 0;
  let prevSlope = 0;
  let prevH = mirageHeight01(recipe, 0);
  for (let i = 1; i <= N; i++) {
    const h = mirageHeight01(recipe, i / N);
    const slope = h - prevH;
    if (prevSlope > 0 && slope < 0) signChanges++;
    prevSlope = slope || prevSlope;
    prevH = h;
  }
  // At least a handful of distinct local maxima across the tile.
  assert.ok(signChanges >= 5, `expected several distinct summits, got ${signChanges} sign changes`);
});

test('mirageShimmerPx stays within the requested amplitude and is continuous-ish over time', () => {
  const recipe = mirageRecipe(5);
  const amp = 4;
  for (let i = 0; i < 100; i++) {
    const u = i / 100;
    for (let t = 0; t < 10; t += 1) {
      const s = mirageShimmerPx(recipe, u, t, amp);
      assert.ok(Number.isFinite(s));
      assert.ok(Math.abs(s) <= amp + 1e-9, `shimmer ${s} exceeded amplitude ${amp}`);
    }
  }
});

test('miragePresence01 stays in [0,1] and cycles', () => {
  let sawLow = false, sawHigh = false;
  for (let t = 0; t < 200; t += 0.5) {
    const p = miragePresence01(t, 37);
    assert.ok(p >= 0 && p <= 1);
    if (p < 0.05) sawLow = true;
    if (p > 0.95) sawHigh = true;
  }
  assert.ok(sawLow && sawHigh, 'presence should swing across its full range over a few periods');
});
