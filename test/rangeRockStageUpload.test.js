// Range v2 rock stage: per-frame geometry uploads reuse GPU attributes, and
// an empty first frame (no pools yet) still allocates them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import { RockStageGL } from '../src/world/alpine/RockStageGL.js';

const upload = (geometry, attrs, indices = null) => RockStageGL.prototype._upload.call({ THREE }, geometry, attrs, indices);

test('an empty first upload allocates the attributes, and later frames reuse them', () => {
  const g = new THREE.BufferGeometry();
  upload(g, { position: [new Float32Array(0), 3] });
  const first = g.getAttribute('position');
  assert.ok(first, 'allocated on the first frame even with nothing to draw');
  upload(g, { position: [Float32Array.from([1, 2, 3, 4, 5, 6]), 3] });
  assert.equal(g.getAttribute('position'), first, 'fits: rewritten in place');
  assert.deepEqual([...g.getAttribute('position').array.slice(0, 6)], [1, 2, 3, 4, 5, 6]);
  upload(g, { position: [new Float32Array(3 * 500), 3] });
  assert.notEqual(g.getAttribute('position'), first, 'outgrown: reallocated');
});

test('the terrain surface texture drops its CPU copy once uploaded', async () => {
  const { createSurfaceTexture } = await import('../src/world/alpine/TerrainGL.js');
  const zlib = await import('node:zlib');
  const { bakeTerrain } = await import('../tools/lib/terrain-bake.mjs');
  const { decodeTerrain } = await import('../src/world/alpine/TerrainMesh.js');
  const W = 65, cell = 10, heightsM = new Float32Array(W * W), valid = new Uint8Array(W * W).fill(1);
  for (let i = 0; i < W * W; i++) heightsM[i] = 500 + (i % W) * 2;
  const grid = { width: W, height: W, cellSizeM: cell, originM: [-320, -320], heightsM, valid, horizontalCrs: 'synthetic',
    verticalReference: 'synthetic', sourceResolutionM: cell, outputSpacingM: cell };
  const view = { id: 't', camera: { eyeStartM: [0, 900, 900], eyeEndM: [0, 900, 900], targetStartM: [0, 500, 0], targetEndM: [0, 500, 0], fovYDeg: 35 } };
  const baked = await bakeTerrain(grid, view);
  const data = decodeTerrain(baked.manifest, new Uint8Array(zlib.gunzipSync(baked.payload)));
  const s = createSurfaceTexture(THREE, data);
  assert.ok(s.texture.image.data.byteLength > 0, 'uploadable before the first upload');
  s.texture.onUpdate(s.texture); // what the renderer calls after uploading
  assert.equal(s.texture.image.data, null);
  assert.equal(s.texture.image.width, s.width);
  assert.equal(s.texture.onUpdate, null, 'dropped once');
});
