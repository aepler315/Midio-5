// Range v2 Task 10: forests describe the slopes and never regenerate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { bakeTerrain } from '../tools/lib/terrain-bake.mjs';
import { decodeTerrain, terrainHeightAt } from '../src/world/alpine/TerrainMesh.js';
import { placeForest, keptInstances, forestKeepFraction, LATTICE_M } from '../src/world/alpine/ForestCover.js';
import { sceneDeformation, rangeMusicState } from '../src/world/alpine/RangeFrame.js';

const W = 257, cell = 10;
// A valley with a lake floor (flat, low), gentle forest slopes, a cliff
// band and a summit above the treeline.
const hAt = (x, z) => {
  const r = Math.abs(x);
  if (r < 150) return 500; // lake: hydro-flattened
  if (x > 700 && x < 760) return 500 + 0.35 * 550 + (x - 700) * 3; // cliff
  return 500 + 0.35 * (r - 150) + (x > 760 ? 180 : 0) + Math.max(0, 900 - Math.hypot(x - 1000, z)) * 1.2;
};
const heightsM = new Float32Array(W * W), valid = new Uint8Array(W * W).fill(1);
for (let r = 0; r < W; r++) for (let c = 0; c < W; c++) heightsM[r * W + c] = hAt(-1280 + c * cell, -1280 + r * cell);
const grid = { width: W, height: W, cellSizeM: cell, originM: [-1280, -1280], heightsM, valid,
  horizontalCrs: 'synthetic', verticalReference: 'synthetic', sourceResolutionM: cell, outputSpacingM: cell };
const view = { id: 'forest-test', camera: { eyeStartM: [-200, 1400, 2600], eyeEndM: [200, 1400, 2600],
  targetStartM: [-200, 600, 0], targetEndM: [200, 600, 0], fovYDeg: 40 } };
const baked = await bakeTerrain(grid, view);
const data = decodeTerrain(baked.manifest, new Uint8Array(zlib.gunzipSync(baked.payload)));
const rules = { treelineM: 1200, forestMaxSlopeDeg: 40, forestDensity: 0.9 };
const all = (p) => { const out = []; for (const arr of [p.mesh, p.billboard]) for (let i = 0; i < arr.length; i += p.stride) out.push(arr.subarray(i, i + p.stride)); return out; };

test('placement is deterministic and seeded', () => {
  const a = placeForest(data, view, rules, { seed: 5 });
  const b = placeForest(data, view, rules, { seed: 5 });
  assert.deepEqual(a.billboard, b.billboard);
  assert.deepEqual(a.mesh, b.mesh);
  assert.ok(a.count > 500, `trees placed: ${a.count}`);
  const c = placeForest(data, view, rules, { seed: 6 });
  assert.notDeepEqual(c.billboard, a.billboard);
});

test('no trees on water, cliffs or above the treeline; roots sit on the drawn surface', () => {
  const p = placeForest(data, view, rules, { seed: 5 });
  for (const t of all(p)) {
    const [x, y, z] = t;
    // Shoreline trees are real; the flattened lake ends a cell before the slope.
    assert.ok(Math.abs(x) >= 150 - cell, `tree in the lake at ${x}`);
    // No tree on ground the drawn surface makes too steep (the same surface
    // the terrain shader's rock mask reads).
    const d = cell;
    const gx = (terrainHeightAt(data, x + d, z) - terrainHeightAt(data, x - d, z)) / (2 * d);
    const gz = (terrainHeightAt(data, x, z + d) - terrainHeightAt(data, x, z - d)) / (2 * d);
    assert.ok(Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI <= rules.forestMaxSlopeDeg + 3.01, `tree on a cliff at ${x}`);
    assert.ok(y <= rules.treelineM + 110 + 1e-6, `tree above treeline ${y}`);
    // Instances are Float32: x/z/y round to ~1e-4 m, so allow a centimetre.
    assert.ok(Math.abs(terrainHeightAt(data, x, z) - y) < 1e-2, `root off the surface by ${terrainHeightAt(data, x, z) - y}`);
  }
});

test('a forest floor keeps low ground open and treeScale shrinks every tree', () => {
  const base = placeForest(data, view, rules, { seed: 5 });
  const floored = placeForest(data, view, { ...rules, forestFloorM: 800 }, { seed: 5 });
  assert.ok(floored.count > 0 && floored.count < base.count);
  // The floor edge is broken up by up to 100 m either way.
  for (const t of all(floored)) assert.ok(t[1] >= 800 - 100, `tree at ${t[1].toFixed(0)} m under the floor`);
  const small = placeForest(data, view, { ...rules, treeScale: 0.3 }, { seed: 5 });
  assert.equal(small.count, base.count, 'same stands, smaller trees');
  const a = all(base), b = all(small);
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual([...b[i].subarray(0, 3)], [...a[i].subarray(0, 3)]);
    assert.ok(Math.abs(b[i][3] - 0.3 * a[i][3]) < 1e-3);
  }
  // Absent rules are the defaults: nothing moves.
  assert.deepEqual(placeForest(data, view, { ...rules, forestFloorM: undefined, treeScale: undefined }, { seed: 5 }).mesh, base.mesh);
});

test('quality keeps a stable subset and never moves a tree', () => {
  const p = placeForest(data, view, rules, { seed: 5 });
  const full = new Set(keptInstances(p.billboard, p.stride, 0));
  const low = keptInstances(p.billboard, p.stride, 6);
  assert.ok(low.length < full.size * 0.5);
  for (const i of low) assert.ok(full.has(i));
  assert.equal(forestKeepFraction(0), 1);
  assert.ok(forestKeepFraction(6) < forestKeepFraction(3));
  // Placement itself does not depend on quality.
  assert.deepEqual(placeForest(data, view, rules, { seed: 5 }).billboard, p.billboard);
});

test('trees sit on a fixed metric lattice: one per cell at most', () => {
  const p = placeForest(data, view, rules, { seed: 5 });
  const cells = new Set();
  for (const [x, , z] of all(p)) {
    const key = `${Math.floor(x / LATTICE_M)},${Math.floor(z / LATTICE_M)}`;
    assert.ok(!cells.has(key), `two trees in cell ${key}`);
    cells.add(key);
  }
});

test('roots follow the shared deformation at the same heard time after a seek', () => {
  const p = placeForest(data, view, rules, { seed: 5 });
  const [x, y, z] = all(p)[0];
  const at = (t) => sceneDeformation(rangeMusicState({ env: { groove: 0.8, sustain: 0.6, scaleMul: 1.1, kickMul: 0.5 }, tSec: t }), x, z, y, [500, 1600]);
  const first = at(42);
  at(100); at(3);
  assert.equal(at(42), first);
});

test('the async placement yields during the work and gives the same forest', async () => {
  const { placeForestAsync } = await import('../src/world/alpine/ForestCover.js');
  let yields = 0;
  const a = await placeForestAsync(data, view, rules, { seed: 5, sliceMs: 0, yieldTo: async () => { yields++; } });
  const b = placeForest(data, view, rules, { seed: 5 });
  assert.ok(yields > 3, `yielded ${yields} times`);
  assert.deepEqual(a.billboard, b.billboard);
  assert.deepEqual(a.mesh, b.mesh);
});

test('forest rings include stands beside the curved camera path', () => {
  // Endpoints are far outside this patch; the midpoint arcs directly over it.
  const bent = { ...view, camera: { ...view.camera,
    eyeStartM: [-200, 1400, 10000], eyeEndM: [200, 1400, 10000],
    targetStartM: [-200, 600, 0], targetEndM: [200, 600, 0],
    eyeArcM: [0, 0, -9000], targetArcM: [0, 0, -500] } };
  const trees = placeForest(data, bent, rules, { seed: 5, rings: { billboardM: 2500, meshM: 2000 } });
  assert.ok(trees.count > 500, `stands along the curved rail: ${trees.count}`);
});
