// Range v2 Task 7: verified, cancelable, budgeted terrain preparation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bakeTerrain } from '../tools/lib/terrain-bake.mjs';
import { prepareTerrainAssets, loadTerrainPackage, RangeAssetError } from '../src/world/alpine/RangeAssets.js';
import { GraphicsResidency, MiB } from '../src/render/GraphicsResidency.js';

const W = 129;
const heightsM = new Float32Array(W * W).map((_, i) => 1000 + 300 * Math.sin((i % W) / 17) * Math.cos(Math.floor(i / W) / 23));
const grid = { width: W, height: W, cellSizeM: 10, originM: [-640, -640], heightsM, valid: new Uint8Array(W * W).fill(1),
  horizontalCrs: 'synthetic', verticalReference: 'synthetic', sourceResolutionM: 10, outputSpacingM: 10 };
const camera = { eyeStartM: [0, 1800, 900], eyeEndM: [100, 1800, 900], targetStartM: [0, 1000, 0], targetEndM: [100, 1000, 0], fovYDeg: 35 };
const baked = await bakeTerrain(grid, { id: 'v1', camera });
const manifestText = JSON.stringify(baked.manifest);
const base = 'http://assets.test/v2/';
const view = { id: 'v1', terrainManifestUrl: 'terrain/v1.terrain.json',
  terrainManifestSha256: createHash('sha256').update(manifestText).digest('hex') };

function server(overrides = {}) {
  const files = {
    [`${base}terrain/v1.terrain.json`]: () => new Response(manifestText),
    [`${base}terrain/v1.terrain.bin.gz`]: () => new Response(baked.payload),
    ...overrides,
  };
  const log = [];
  const fetchImpl = async (url) => { log.push(url); const f = files[url]; return f ? f() : new Response('nope', { status: 404 }); };
  return { fetchImpl, log };
}
const ledger = (mb = 64) => new GraphicsResidency({ budgetBytes: mb * MiB });

test('a valid package prepares, commits once and is reused', async () => {
  const r = ledger();
  const { fetchImpl, log } = server();
  const a = await prepareTerrainAssets(view, { baseUrl: base, residency: r, generation: 1, fetchImpl });
  assert.equal(a.viewId, 'v1');
  assert.ok(a.data.tiles.size > 0);
  assert.ok(r.liveBytes > 0 && r.pendingBytes === 0);
  const again = await prepareTerrainAssets(view, { baseUrl: base, residency: r, generation: 1, fetchImpl });
  assert.equal(again, a);
  assert.equal(log.length, 2, 'reuse does not refetch');
});

test('missing assets fail explicitly', async () => {
  const { fetchImpl } = server({ [`${base}terrain/v1.terrain.bin.gz`]: () => new Response('x', { status: 404 }) });
  const r = ledger();
  await assert.rejects(prepareTerrainAssets(view, { baseUrl: base, residency: r, fetchImpl }), (e) => e instanceof RangeAssetError && e.reason === 'http');
  assert.equal(r.usedBytes, 0, 'the failed reservation is released');
});

test('truncated or tampered payloads are rejected by length/hash', async () => {
  const cut = server({ [`${base}terrain/v1.terrain.bin.gz`]: () => new Response(baked.payload.subarray(0, 100)) });
  await assert.rejects(prepareTerrainAssets(view, { baseUrl: base, residency: ledger(), fetchImpl: cut.fetchImpl }), /length|hash/);
  const tampered = Buffer.from(baked.payload); tampered[tampered.length - 20] ^= 0xff;
  const bad = server({ [`${base}terrain/v1.terrain.bin.gz`]: () => new Response(tampered) });
  await assert.rejects(prepareTerrainAssets(view, { baseUrl: base, residency: ledger(), fetchImpl: bad.fetchImpl }), /hash/);
  const otherManifest = server({ [`${base}terrain/v1.terrain.json`]: () => new Response(manifestText.replace('"version":1', '"version":1 ')) });
  await assert.rejects(prepareTerrainAssets(view, { baseUrl: base, fetchImpl: otherManifest.fetchImpl }), /catalog/);
});

test('a late response for an older generation is never published', async () => {
  const r = ledger();
  let current = 5;
  let release;
  const gate = new Promise((res) => { release = res; });
  const { fetchImpl } = server({ [`${base}terrain/v1.terrain.bin.gz`]: async () => { await gate; return new Response(baked.payload); } });
  const p = prepareTerrainAssets(view, { baseUrl: base, residency: r, generation: 5, isCurrent: (g) => g === current, fetchImpl });
  await new Promise((res) => setTimeout(res, 10));
  current = 6; // a newer song/world took over
  release();
  await assert.rejects(p, (e) => e.reason === 'stale');
  assert.equal(r.has('range:terrain-cpu:v1'), false);
  assert.equal(r.usedBytes, 0);
});

test('cancelling the generation mid-decode frees its bytes and rejects', async () => {
  const r = ledger();
  let release;
  const gate = new Promise((res) => { release = res; });
  const { fetchImpl } = server({ [`${base}terrain/v1.terrain.bin.gz`]: async () => { await gate; return new Response(baked.payload); } });
  const p = prepareTerrainAssets(view, { baseUrl: base, residency: r, generation: 9, fetchImpl });
  await new Promise((res) => setTimeout(res, 10));
  assert.ok(r.pendingBytes > 0);
  r.cancelGeneration(9);
  assert.equal(r.pendingBytes, 0);
  release();
  await assert.rejects(p, (e) => e.reason === 'stale');
  assert.equal(r.usedBytes, 0);
});

test('an aborted load rejects as aborted', async () => {
  const ac = new AbortController();
  ac.abort();
  const { fetchImpl } = server();
  await assert.rejects(prepareTerrainAssets(view, { baseUrl: base, signal: ac.signal, fetchImpl: (u, init) => (init?.signal?.aborted ? Promise.reject(new Error('aborted')) : fetchImpl(u)) }),
    (e) => e.reason === 'aborted' || e.reason === 'stale');
});

test('budget denial throws before downloading the payload', async () => {
  const r = ledger(0.05);
  const { fetchImpl, log } = server();
  await assert.rejects(prepareTerrainAssets(view, { baseUrl: base, residency: r, fetchImpl }), (e) => e.reason === 'budget');
  assert.deepEqual(log, [`${base}terrain/v1.terrain.json`]);
});

test('a host that already decoded the gzip transfer is accepted by decoded identity', async () => {
  const zlib = await import('node:zlib');
  const plain = zlib.gunzipSync(baked.payload);
  const { fetchImpl } = server({ [`${base}terrain/v1.terrain.bin.gz`]: () => new Response(plain) });
  const pkg = await loadTerrainPackage(`${base}terrain/v1.terrain.json`, { fetchImpl });
  assert.equal(pkg.bytes.decoded, baked.manifest.payload.decodedByteLength);
});
