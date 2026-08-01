import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLight, celestialScreenPos, lightDirTo } from '../src/render/LightField.js';

test('light position tracks celestialYFrac and matches the celestial\'s own screen anchor', () => {
  const params = { canvasWidth: 1280, canvasHeight: 720, celestialYFrac: 0.22, budget: 1 };
  const light = computeLight(params);
  const pos = celestialScreenPos(1280, 720, 0.22);
  assert.equal(light.x, pos.x);
  assert.equal(light.y, pos.y);

  const higher = computeLight({ ...params, celestialYFrac: 0.6 });
  assert.ok(higher.y > light.y, 'a larger yFrac should move the light further down the canvas');
});

test('intensity is 0 once unravel reaches 1, regardless of budget', () => {
  const light = computeLight({ canvasWidth: 1280, canvasHeight: 720, budget: 1, unravel: 1 });
  assert.equal(light.intensity, 0);
});

test('intensity scales with budget and softens during dawn/dusk washes', () => {
  const full = computeLight({ canvasWidth: 1280, canvasHeight: 720, budget: 1, unravel: 0, dayArcAlpha: 0 });
  const dim = computeLight({ canvasWidth: 1280, canvasHeight: 720, budget: 1, unravel: 0, dayArcAlpha: 0.3 });
  const half = computeLight({ canvasWidth: 1280, canvasHeight: 720, budget: 0.5, unravel: 0, dayArcAlpha: 0 });
  assert.ok(dim.intensity < full.intensity);
  assert.ok(Math.abs(half.intensity - full.intensity * 0.5) < 1e-9);
});

test('color equals the crossfaded halo color passed in verbatim', () => {
  const light = computeLight({ canvasWidth: 1280, canvasHeight: 720, budget: 1, haloColorHex: '#abcdef' });
  assert.equal(light.colorHex, '#abcdef');
});

test('reducedFlash compresses intensity variance rather than capping a peak', () => {
  const dim = computeLight({ canvasWidth: 1280, canvasHeight: 720, budget: 0, reducedFlash: false });
  const bright = computeLight({ canvasWidth: 1280, canvasHeight: 720, budget: 1, reducedFlash: false });
  const dimReduced = computeLight({ canvasWidth: 1280, canvasHeight: 720, budget: 0, reducedFlash: true });
  const brightReduced = computeLight({ canvasWidth: 1280, canvasHeight: 720, budget: 1, reducedFlash: true });

  const spread = bright.intensity - dim.intensity;
  const spreadReduced = brightReduced.intensity - dimReduced.intensity;
  assert.ok(spreadReduced < spread, `expected a compressed spread, got ${spreadReduced} vs ${spread}`);
  assert.ok(spreadReduced > 0, 'reducedFlash should compress, not eliminate, the swing');
});

test('lightDirTo returns a unit vector pointing from the light toward the target', () => {
  const light = { x: 0, y: 0 };
  const dir = lightDirTo(light, 3, 4);
  assert.ok(Math.abs(dir.x - 0.6) < 1e-9);
  assert.ok(Math.abs(dir.y - 0.8) < 1e-9);
  assert.ok(Math.abs(Math.hypot(dir.x, dir.y) - 1) < 1e-9);
});
