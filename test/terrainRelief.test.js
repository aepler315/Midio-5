import test from 'node:test';
import assert from 'node:assert/strict';
import { terrainFacing } from '../src/world/TerrainRelief.js';

function flatBars(n = 5, y = 500, width = 90) {
  return Array.from({ length: n }, (_, i) => ({ x: i * width, width, y }));
}

test('terrainFacing returns all zeros with no light', () => {
  const bars = flatBars();
  assert.deepEqual(terrainFacing(bars, null), bars.map(() => 0));
});

test('terrainFacing returns all zeros with degenerate light', () => {
  const bars = flatBars();
  assert.deepEqual(terrainFacing(bars, { x: NaN, y: 0, intensity: 1 }), bars.map(() => 0));
  assert.deepEqual(terrainFacing(bars, { x: 10, y: 10, intensity: 0 }), bars.map(() => 0));
});

test('terrainFacing is bounded to [-1, 1] for every input, including single/two-bar arrays', () => {
  for (const n of [1, 2, 5, 25]) {
    const bars = flatBars(n);
    const out = terrainFacing(bars, { x: 400, y: -200, intensity: 1 });
    assert.equal(out.length, n);
    for (const v of out) assert.ok(v >= -1 && v <= 1);
  }
});

test('terrainFacing is exactly 0 on flat terrain with the light directly overhead', () => {
  const bars = flatBars(7, 500, 100);
  const midX = bars[3].x + bars[3].width / 2;
  const out = terrainFacing(bars, { x: midX, y: -1000, intensity: 1 });
  for (const v of out) assert.ok(Math.abs(v) < 1e-9);
});

test('facing flips sign when the light crosses a slope\'s vertical', () => {
  // A rising slope: bar y decreases left to right (a hill rising to the right).
  // Its outward normal leans toward the downhill side (left) -- like a ramp
  // rising to the right, whose visible face looks left, not right -- so a
  // light to the left of the slope is the one that lights it.
  const bars = [
    { x: 0, width: 100, y: 600 },
    { x: 100, width: 100, y: 550 },
    { x: 200, width: 100, y: 500 },
    { x: 300, width: 100, y: 450 },
    { x: 400, width: 100, y: 400 },
  ];
  const midBar = bars[2];
  const midX = midBar.x + midBar.width / 2;

  const lightOnDownhillSide = { x: midX - 500, y: 0, intensity: 1 }; // left -- lights this slope's face
  const lightMirrored = { x: midX + 500, y: 0, intensity: 1 };       // right -- behind the face

  const facingLit = terrainFacing(bars, lightOnDownhillSide)[2];
  const facingMirrored = terrainFacing(bars, lightMirrored)[2];
  assert.ok(facingLit > 0);
  assert.ok(facingMirrored < 0);
});

test('facing scales to 0 as light.intensity does', () => {
  const bars = [
    { x: 0, width: 100, y: 600 },
    { x: 100, width: 100, y: 550 },
    { x: 200, width: 100, y: 500 },
  ];
  const full = terrainFacing(bars, { x: 1000, y: 0, intensity: 1 })[1];
  const half = terrainFacing(bars, { x: 1000, y: 0, intensity: 0.5 })[1];
  assert.ok(full !== 0);
  assert.ok(Math.abs(half - full * 0.5) < 1e-9);
});
