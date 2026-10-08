import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bakeTerrain, STRIDES, validateTerrainManifest } from '../tools/lib/terrain-bake.mjs';
import { decodeTerrain, terrainHeightAt } from '../src/world/alpine/TerrainMesh.js';

function fixture() {
  const width = 129, height = 129, cellSizeM = 20, originM = [-1280, -1280];
  const heightsM = Float32Array.from({ length: width * height }, (_, i) =>
    1000 + .1 * (i % width) * 20 + .002 * (Math.floor(i / width) * 20 - 1280) ** 2);
  const grid = { width, height, cellSizeM, originM, heightsM,
    valid: new Uint8Array(width * height).fill(1), horizontalCrs: 'synthetic', verticalReference: 'synthetic',
    sourceResolutionM: 20, outputSpacingM: 20, provenance: { provider: 'test' } };
  const view = { id: 'tour-test', camera: { eyeStartM: [0, 5000, 0], eyeEndM: [0, 5000, 0],
    targetStartM: [-1280, 2000, 0], targetEndM: [-1280, 2000, 0], fovYDeg: 35 } };
  return { grid, view };
}

// Removing the opt-in path or shipping only rail-visible/coarse tiles breaks
// this test: a turning camera needs every source tile at its finest level.
test('allTiles keeps every tile at stride 1 with complete measured errors and no rail LOD', async () => {
  const { grid, view } = fixture();
  const baked = await bakeTerrain(grid, view, { allTiles: true });
  assert.equal(baked.manifest.tiles.length, 4);
  assert.equal(Object.hasOwn(baked.manifest, 'lod'), false);
  for (const tile of baked.manifest.tiles) {
    assert.equal(tile.stride, 1);
    assert.equal(tile.visible, true);
    assert.equal(Object.hasOwn(tile, 'lod'), false);
    assert.deepEqual(Object.keys(tile.errorsM).map(Number), STRIDES);
    assert.equal(tile.errorsM[1], 0);
  }
  assert.ok(validateTerrainManifest(baked.manifest, { decoded: baked.decoded.byteLength }).ok);
  const data = decodeTerrain(baked.manifest, baked.decoded);
  for (const [col, row] of [[10, 10], [100, 10], [10, 100], [100, 100]]) {
    assert.ok(Math.abs(terrainHeightAt(data, grid.originM[0] + col * 20, grid.originM[1] + row * 20)
      - grid.heightsM[row * grid.width + col]) <= baked.manifest.quantization.stepM / 2 + .001);
  }
});

test('a whole-range terrain bake needs no legacy camera rail', async () => {
  const { grid } = fixture();
  const baked = await bakeTerrain(grid, { id: 'tour-test' }, { allTiles: true });
  assert.equal(baked.manifest.tiles.length, 4);
});

test('an all-tiles bake rejects residual DEM holes instead of serializing invalid stride errors', async () => {
  const { grid, view } = fixture();
  const i = 33 * grid.width + 33;
  grid.valid[i] = 0;
  grid.heightsM[i] = NaN;
  await assert.rejects(bakeTerrain(grid, view, { allTiles: true }), /allTiles.*no-data/);
});

test('local raster content cannot populate or reuse the remote-source normalization cache', async t => {
  const { tourDemCacheKey } = await import('../tools/build-teton-tour.mjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tour-cache-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'dem.tif');
  const view = { dem: { source: '3dep13', centerLonLat: [-110.83, 43.75], extentM: [48000, 76000], cellM: 20 } };
  await fs.writeFile(input, 'first raster bytes');
  const remote = await tourDemCacheKey(view);
  const local = await tourDemCacheKey(view, [input]);
  assert.notEqual(local, remote);
  await fs.writeFile(input, 'replacement raster bytes');
  assert.notEqual(await tourDemCacheKey(view, [input]), local);
  assert.equal(await tourDemCacheKey(view), remote);
});

test('tour grid compatibility checks extent, spacing, origin, CRS, axes and summit identity', async () => {
  const { validateTourGrid } = await import('../tools/build-teton-tour.mjs');
  const { grid } = fixture();
  const view = { dem: { centerLonLat: [-110.83, 43.75], extentM: [2560, 2560], cellM: 20 } };
  Object.assign(grid, {
    centerLonLat: [-110.83, 43.75],
    horizontalCrs: '+proj=tmerc +lat_0=43.750000000 +lon_0=-110.830000000 +k=1 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs',
    sourceToLocal: [1, 0, 0, 0, -1, 0], localToSource: [1, 0, 0, 0, -1, 0],
    points: { 'Grand Teton': { localM: [0, 0], lonLat: [-110.80237, 43.74125] } },
  });
  const checks = [{ name: 'Grand Teton', lonLat: [-110.80237, 43.74125] }];
  assert.deepEqual(validateTourGrid(grid, view, checks), { ok: true, errors: [] });
  for (const mutate of [
    g => { g.width--; },
    g => { g.cellSizeM = 40; },
    g => { g.originM[0] += 20; },
    g => { g.centerLonLat[0] += 1; },
    g => { g.horizontalCrs = g.horizontalCrs.replace('NAD83', 'WGS84'); },
    g => { g.horizontalCrs = g.horizontalCrs.replace('lat_0=43.750000000', 'lat_0=42'); },
    g => { g.sourceToLocal[4] = 1; },
    g => { g.localToSource[4] = 1; },
    g => { g.points['Grand Teton'].lonLat[0] += .1; },
    g => { g.points['Grand Teton'].localM[0] = 10000; },
  ]) {
    const wrong = structuredClone(grid);
    mutate(wrong);
    assert.equal(validateTourGrid(wrong, view, checks).ok, false);
  }
});

test('the build rejects a grid for another region before summit checks or publishing', async t => {
  const { buildTourTerrain } = await import('../tools/build-teton-tour.mjs');
  const { grid } = fixture();
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tour-region-'));
  t.after(() => fs.rm(outDir, { recursive: true, force: true }));
  await assert.rejects(buildTourTerrain({ demGrid: grid, outDir, log: () => {} }), /Teton DEM frame mismatch/);
  assert.deepEqual(await fs.readdir(outDir), []);
});

test('a package with error tables validates without legacy lod', async () => {
  const { grid, view } = fixture();
  const { manifest, decoded } = await bakeTerrain(grid, view);
  for (const tile of manifest.tiles) delete tile.lod;
  delete manifest.lod;
  assert.deepEqual(validateTerrainManifest(manifest, { decoded: decoded.byteLength }), { ok: true, errors: [] });
});

test('error-table packages reject missing, non-finite, negative and unsupported stride errors', async () => {
  const { grid, view } = fixture();
  const { manifest, decoded } = await bakeTerrain(grid, view, { allTiles: true });
  for (const mutate of [
    tile => { delete tile.lod; delete tile.errorsM; },
    tile => { delete tile.lod; tile.errorsM = { ...tile.errorsM, 1: Infinity }; },
    tile => { delete tile.lod; tile.errorsM = { ...tile.errorsM, 1: -1 }; },
    tile => { delete tile.lod; tile.errorsM = { ...tile.errorsM, 3: 1 }; },
    tile => { delete tile.lod; delete tile.errorsM[64]; },
  ]) {
    const invalid = structuredClone(manifest);
    mutate(invalid.tiles[0]);
    assert.equal(validateTerrainManifest(invalid, { decoded: decoded.byteLength }).ok, false);
  }
});

test('the default rail bake retains its pre-tour manifest and payload bytes', async () => {
  const { grid, view } = fixture();
  const baked = await bakeTerrain(grid, view);
  assert.equal(baked.manifest.payload.sha256, '379c2a29503ca05803d8bb53dfbe60b0f0e26e64c15a17042680500b18c91595');
  assert.equal(createHash('sha256').update(JSON.stringify(baked.manifest)).digest('hex'),
    '6da9dee5d92899724c7cf65f891d87795f69858dfadacec2a9fe613bbff97f26');
});

test('summit verification uses the maximum within 200 metres and rejects missing or inaccurate peaks', async () => {
  const { checkSummits } = await import('../tools/build-teton-tour.mjs');
  const { grid } = fixture();
  grid.heightsM.fill(1000);
  grid.points = { 'Grand Teton': { localM: [0, 0], lonLat: [-110.80237, 43.74125] } };
  grid.heightsM[64 * grid.width + 64] = 4199;
  // This higher cell is inside the bounding square but outside the 200 m circle.
  grid.heightsM[74 * grid.width + 74] = 4500;
  const summits = [{ name: 'Grand Teton', elevationM: 4199 }];
  const good = checkSummits(grid, summits);
  assert.equal(good.ok, true);
  assert.equal(good.summits[0].demPeakM, 4199);
  grid.heightsM[64 * grid.width + 64] = 4160;
  assert.equal(checkSummits(grid, summits).ok, false);
  grid.points = {};
  assert.equal(checkSummits(grid, summits).ok, false);
});
