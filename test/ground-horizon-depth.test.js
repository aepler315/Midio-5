// ground-horizon-depth — the per-layer DEPTH table is pure logic (canvas-free),
// so it runs in `npm test`. Anchors the draw contract: alpha monotone up
// L2→L5 (near = opaque), yOffsetPct monotone up with L5 pinned to 1 (closes the
// silhouette/ground seam), and unknown layers fall back to fully opaque.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPTH, layerDepth } from '../src/world/BiomeManager.js';

test('DEPTH alpha is monotone increasing L2→L5 (near = opaque)', () => {
  const a = ['L2', 'L3', 'L4', 'L5'].map(layerDepth).map((d) => d.alpha);
  assert.ok(a[0] < a[1] && a[1] < a[2] && a[2] < a[3], `alpha not monotone: ${a}`);
});

test('DEPTH yOffsetPct is monotone increasing L2→L5 and L5 pins to 1', () => {
  const y = ['L2', 'L3', 'L4', 'L5'].map(layerDepth).map((d) => d.yOffsetPct);
  assert.ok(y[0] <= y[1] && y[1] <= y[2] && y[2] <= y[3], `yOffsetPct not monotone: ${y}`);
  assert.equal(layerDepth('L5').yOffsetPct, 1);
  assert.equal(layerDepth('L2').yOffsetPct, 0);
});

test('layerDepth falls back to fully opaque for unknown layers', () => {
  assert.equal(layerDepth('L9').alpha, 1);
  assert.equal(layerDepth('L9').yOffsetPct, 0);
});

test('DEPTH is frozen (draw contract cannot be mutated at runtime)', () => {
  assert.ok(Object.isFrozen(DEPTH), 'DEPTH must be frozen');
});