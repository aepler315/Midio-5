import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terrainFacing } from '../src/world/TerrainRelief.js';

function bar(x, y, width = 40) {
  return { x, width, y };
}

test('terrainFacing(bars, null) returns all zeros — the no-light path is today', () => {
  const bars = [bar(0, 400), bar(40, 390), bar(80, 410)];
  assert.deepEqual(terrainFacing(bars, null), [0, 0, 0]);
  assert.deepEqual(terrainFacing(bars, undefined), [0, 0, 0]);
  assert.deepEqual(terrainFacing(bars, {}), [0, 0, 0]);
  assert.deepEqual(terrainFacing([], { x: 10, y: 10, intensity: 1 }), []);
  assert.deepEqual(terrainFacing(null, { x: 10, y: 10, intensity: 1 }), []);
});

test('facing flips sign when the light crosses a slope\'s vertical', () => {
  // Rising slope in canvas space: y falls as x grows (the ground climbs).
  // Its air-facing normal leans left, so a light on that open side reads
  // positive and the mirror reads negative.
  const bars = [bar(0, 420), bar(40, 400), bar(80, 380)];
  const mid = bars[1];
  const cx = mid.x + mid.width / 2;
  const left = terrainFacing(bars, { x: cx - 200, y: 200, intensity: 1 });
  const right = terrainFacing(bars, { x: cx + 200, y: 200, intensity: 1 });
  assert.ok(left[1] > 0, `light on the open side of a rising slope should read +, got ${left[1]}`);
  assert.ok(right[1] < 0, `mirrored light should flip the sign, got ${right[1]}`);
  assert.ok(Math.abs(left[1] + right[1]) < 1e-9, 'the flip is a true mirror');
});

test('facing is exactly 0 on flat terrain with the light directly overhead', () => {
  const bars = [bar(0, 400), bar(40, 400), bar(80, 400), bar(120, 400)];
  const facing = terrainFacing(bars, { x: 80, y: 0, intensity: 1 });
  for (const f of facing) assert.equal(f, 0, `flat + overhead must be edge-on, got ${f}`);
});

test('facing is bounded to [-1, 1] for every input, including the end-clamp path', () => {
  const samples = [
    [bar(0, 400)],
    [bar(0, 500), bar(40, 300)],
    [bar(0, 400), bar(40, 350), bar(80, 450), bar(120, 200)],
  ];
  for (const bars of samples) {
    for (const light of [
      { x: -1000, y: -1000, intensity: 1 },
      { x: 1000, y: 1000, intensity: 4 },
      { x: 20, y: 400, intensity: 1 },
      { x: 20, y: 0, intensity: 0.3 },
    ]) {
      for (const f of terrainFacing(bars, light)) {
        assert.ok(f >= -1 && f <= 1, `out of range ${f} for ${bars.length} bars`);
        assert.ok(Number.isFinite(f));
      }
    }
  }
});

test('facing scales to 0 as light.intensity does', () => {
  const bars = [bar(0, 420), bar(40, 400), bar(80, 380)];
  const light = { x: 0, y: 200 };
  const full = terrainFacing(bars, { ...light, intensity: 1 });
  const half = terrainFacing(bars, { ...light, intensity: 0.5 });
  const gone = terrainFacing(bars, { ...light, intensity: 0 });
  assert.deepEqual(gone, [0, 0, 0]);
  for (let i = 0; i < bars.length; i++) {
    assert.ok(Math.abs(half[i] - 0.5 * full[i]) < 1e-9, `intensity must scale facing linearly at bar ${i}`);
  }
});
