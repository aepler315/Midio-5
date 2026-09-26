import test from 'node:test';
import assert from 'node:assert/strict';
import { SpaceRidge } from '../src/world/SpaceRidge.js';
import { createRangeSkyComposition, rangeMoonRadius } from '../src/world/alpine/RangeSkyComposition.js';
import { BiomeManager } from '../src/world/BiomeManager.js';

test('Range stars are deterministic, sparse, and excluded from the live cosmic ridge', () => {
  const canvas = { width: 1280, height: 720 };
  const ridge = new SpaceRidge(315);
  const plan = createRangeSkyComposition(ridge, canvas);
  const corridor = ridge.corridor(canvas)(640);
  const centerY = (corridor.top + corridor.bottom) / 2;
  assert.equal(plan.allowStar(0, 640, centerY), false);
  assert.equal(plan.allowPoint(640, centerY), false);
  assert.equal(plan.allowStar(1, 640, 20), false);
  assert.equal(plan.allowStar(5, 640, 20), true);
  assert.deepEqual(createRangeSkyComposition(ridge, canvas).allowStar(5, 640, 20), true);
  assert.equal(plan.weaverOptions.maxFigures, 1);
  assert.equal(plan.weaverOptions.maxRetained, 0);
});

test('authored voyage has priority over the incidental Range constellation', () => {
  const canvas = { width: 1280, height: 720 };
  const ridge = new SpaceRidge(315);
  assert.equal(createRangeSkyComposition(ridge, canvas).showWeaver, true);
  assert.equal(createRangeSkyComposition(ridge, canvas, { voyageActive: true }).showWeaver, false);
});

test('Range excludes permanent celestial shaft fans and biome ray fans', () => {
  const plan = createRangeSkyComposition(new SpaceRidge(315), { width: 1280, height: 720 });
  assert.equal(plan.celestialShafts, false);
  assert.equal(plan.biomeRays, false);
});

test('Range moon stays present without dominating the entire upper sky late in a song', () => {
  assert.equal(rangeMoonRadius(720, 1), 720 * 0.0361);
  assert.ok(rangeMoonRadius(720, 3.4) <= 52);
  assert.ok(rangeMoonRadius(720, 3.4) >= 45);
});

test('the actual shared star painter admits only the Range plan stars', () => {
  const canvas = { width: 1280, height: 720 };
  const ridge = new SpaceRidge(315);
  const plan = createRangeSkyComposition(ridge, canvas);
  const topYFrac = 20 / (720 * 0.3781);
  const stars = Array.from({ length: 6 }, (_, i) => ({
    xFrac: 0.5, yFrac: i === 0 ? 0.85 : topYFrac,
    size: 1, layer: 2, bright: 1, phase: 0, ext: 1, hue: 0, varAmp: 0,
  }));
  const draws = [];
  const ctx = {
    globalAlpha: 1, save() {}, restore() {}, beginPath() {}, fill() {}, stroke() {},
    translate() {}, rotate() {}, scale() {}, arc() {}, rect() {},
    createLinearGradient() { return { addColorStop() {} }; },
    fillRect(x, y, w, h) { if (w <= 1 && h <= 1) draws.push([x, y]); },
  };
  const manager = {
    world: { kind: 'alpine' }, tSec: 0, calmLevel: 0, openingGain: 1,
    stars, planets: [], dustLanes: [], deepSky: [], _starBuckets: new Map(),
    _rangeSky: plan,
  };
  BiomeManager.prototype._drawStarfield.call(manager, ctx, canvas, { fx: '' }, { fx: '' }, 0, 1);
  assert.equal(draws.length, 1, 'only one of six seed stars should survive count and corridor rules');
  draws.length = 0;
  manager._rangeSky = null;
  BiomeManager.prototype._drawStarfield.call(manager, ctx, canvas, { fx: '' }, { fx: '' }, 0, 1);
  assert.equal(draws.length, 6, 'shared painter retains all six without a Range plan');
});
