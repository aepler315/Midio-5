import test from 'node:test';
import assert from 'node:assert/strict';
import { REAL_BIOMES } from '../src/world/RealBiomes.js';
import { landscapePolicy, landscapeBudget, landscapeLayerColor, landscapePasses, landscapeSnowAllowed } from '../src/world/alpine/LandscapePolicy.js';

test('all real biomes have distinct, immutable landscape cover policies', () => {
  for (const { name } of REAL_BIOMES) {
    const p = landscapePolicy(name);
    assert.equal(p.key, name);
    assert.ok(Object.isFrozen(p));
    assert.ok(p.moisture >= 0 && p.moisture <= 1);
  }
  assert.equal(landscapePolicy('DESERT').moisture, 0);
  assert.ok(landscapePolicy('RAINFOREST').canopy > landscapePolicy('DESERT').canopy);
  assert.equal(landscapePolicy('CUSTOM').moisture, 0);
});

test('alpine depth is painted into each layer while other worlds keep their passes', () => {
  const base = '#314c40', sky = '#91abb2';
  const colors = ['L2', 'L3', 'L4', 'L5'].map(key => landscapeLayerColor(base, sky, key, 'RAINFOREST'));
  assert.equal(new Set(colors).size, 4);
  assert.equal(landscapePasses('alpine').scenicWire, false);
  assert.equal(landscapePasses('city').scenicWire, true);
  assert.equal(landscapePasses('alpine').connector, false);
  assert.equal(landscapePasses('alpine').shimmerSlices, false);
  assert.equal(landscapePasses('city').shimmerSlices, true);
  assert.ok(landscapeBudget(6).facetsPerLayer > 0);
});

test('dry cover excludes snow while high wet mountain cover permits it', () => {
  assert.equal(landscapeSnowAllowed('DESERT', .99), false);
  assert.equal(landscapeSnowAllowed('ICEFIELD', .7), true);
  assert.equal(landscapeSnowAllowed('RAINFOREST', .8), false);
  assert.equal(landscapeSnowAllowed('RAINFOREST', .94), true);
});
