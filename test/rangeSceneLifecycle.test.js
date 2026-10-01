// Range v2 scene lifecycle (review fixes): shared material loads, reservation
// before decode, generation-aware pending work, and eviction that retires a
// prepared view. Exercised on a RangeScene without a GL context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RangeScene } from '../src/world/alpine/RangeScene.js';
import { GraphicsResidency, MiB } from '../src/render/GraphicsResidency.js';

const dir = path.resolve('src/assets/range/v2/materials');
const manifest = JSON.parse(await fs.readFile(path.join(dir, 'wet-conifer.json'), 'utf8'));
const base = 'http://assets.test/v2/';
const files = new Map([[`${base}materials/wet-conifer.json`, JSON.stringify(manifest)]]);
for (const t of Object.values(manifest.textures)) files.set(new URL(t.url, `${base}materials/wet-conifer.json`).href, await fs.readFile(path.join(dir, t.url)));

function bareScene(budgetMiB = 256) {
  const s = Object.create(RangeScene.prototype);
  Object.assign(s, {
    THREE: { Texture: class { dispose() {} }, NoColorSpace: '', RepeatWrapping: 0, LinearFilter: 0, LinearMipmapLinearFilter: 0 },
    residency: new GraphicsResidency({ budgetBytes: budgetMiB * MiB }),
    prepared: new Map(), pending: new Map(), materials: new Map(), materialLoads: new Map(),
  });
  return s;
}
const view = (id) => ({ id, materialManifestUrl: 'materials/wet-conifer.json' });

async function withNet(fn, { onDecode = () => {} } = {}) {
  const f = globalThis.fetch, c = globalThis.createImageBitmap;
  let fetches = 0;
  globalThis.fetch = async (u) => { fetches++; return files.has(String(u)) ? new Response(files.get(String(u))) : new Response('', { status: 404 }); };
  globalThis.createImageBitmap = async (blob) => {
    onDecode();
    const n = (await blob.arrayBuffer()).byteLength;
    const t = Object.values(manifest.textures).find((x) => x.bytes === n);
    return { width: t.width, height: t.height, close() {} };
  };
  try { return await fn(() => fetches); } finally { globalThis.fetch = f; globalThis.createImageBitmap = c; }
}

test('views sharing a material pack load it once, concurrently, without a duplicate reservation', async () => {
  await withNet(async (fetches) => {
    const s = bareScene();
    const [a, b] = await Promise.all([s._acquireMaterial(view('a'), { baseUrl: base }), s._acquireMaterial(view('b'), { baseUrl: base })]);
    assert.equal(a, b);
    assert.deepEqual([...a.users].sort(), ['a', 'b']);
    const unique = new Set(Object.values(manifest.textures).map((t) => t.sha256)).size;
    assert.equal(fetches(), 1 + unique, 'one manifest and one fetch per texture');
    assert.equal(s.residency.snapshot().byOwner['range-material'].count, 1);
  });
});

test('a pack that does not fit is refused before any image is decoded', async () => {
  let decodes = 0;
  await withNet(async () => {
    const s = bareScene(1);
    await assert.rejects(s._acquireMaterial(view('a'), { baseUrl: base }), (e) => e.reason === 'budget');
    assert.equal(s.residency.usedBytes, 0);
  }, { onDecode: () => { decodes++; } });
  assert.equal(decodes, 0);
});

test('evicting a prepared view retires it from the cache and frees its CPU entry', () => {
  const s = bareScene(10);
  s._disposePrepared = () => {};
  const r = s.residency;
  const cpu = r.reserve({ key: 'cpu:v', bytes: 2 * MiB, owner: 'cpu' });
  r.commit(cpu, {});
  const p = { gpuKey: 'gpu:v', cpuKey: 'cpu:v', materialKey: null };
  r.commit(r.reserve({ key: 'gpu:v', bytes: 6 * MiB, owner: 'gpu' }), p, (x) => s._retire('v', x));
  s.prepared.set('v', p);
  // Another owner needs the room; the view is not pinned, so it goes.
  assert.ok(r.reserve({ key: 'other', bytes: 8 * MiB, owner: 'x' }));
  assert.equal(s.prepared.has('v'), false);
  assert.equal(r.snapshot().byOwner.cpu, undefined);
});

test('the view a frame draws is pinned and survives the same pressure', () => {
  const s = bareScene(10);
  s._disposePrepared = () => {};
  const r = s.residency;
  const p = { gpuKey: 'gpu:v', cpuKey: 'cpu:v', materialKey: null };
  r.commit(r.reserve({ key: 'gpu:v', bytes: 6 * MiB, owner: 'gpu' }), p, (x) => s._retire('v', x));
  s.prepared.set('v', p);
  s.pinView('v');
  assert.equal(r.reserve({ key: 'other', bytes: 8 * MiB, owner: 'x' }), null);
  assert.equal(s.prepared.has('v'), true);
});

test('a new generation never inherits an older generation\'s pending rejection', async () => {
  const s = bareScene();
  let rejectOld;
  const old = new Promise((_, rej) => { rejectOld = rej; });
  old.catch(() => {});
  s.pending.set('v', { generation: 1, job: old });
  const real = s.prepare.bind(s);
  const out = real({ id: 'v' }, { generation: 2 });
  // Same generation shares the pending job.
  assert.equal(real({ id: 'v' }, { generation: 1 }), old);
  s.prepare = async (v, o) => ({ fresh: true, generation: o.generation });
  rejectOld(Object.assign(new Error('stale'), { reason: 'stale' }));
  assert.deepEqual(await out, { fresh: true, generation: 2 });
});

test('a preparation that straddles a context loss or restore never publishes; none starts while lost', async () => {
  const s = bareScene();
  s.contextLost = false;
  s.contextEpoch = 0;
  // The decoded terrain is already resident, so prepare goes straight to
  // the GPU stage; the material step is where the context goes away.
  const cpuKey = 'range:terrain-cpu:a';
  s.residency.commit(s.residency.reserve({ key: cpuKey, bytes: MiB, owner: 'range-terrain-cpu' }), { key: cpuKey, data: {}, manifest: {} });
  let released = 0;
  s._acquireMaterial = async () => { s.contextLost = true; s.contextEpoch++; return { pack: { manifest: { rules: {} } } }; };
  s._releaseMaterial = () => { released++; };
  await assert.rejects(s.prepare(view('a'), { baseUrl: base }), (e) => e.reason === 'context-lost');
  assert.equal(s.prepared.has('a'), false);
  assert.equal(released, 1, 'the material hold is returned');
  // While lost, nothing new starts.
  await assert.rejects(s.prepare(view('b'), { baseUrl: base }), (e) => e.reason === 'context-lost');
  assert.equal(s.pending.has('b'), false);
});

test('no foreground never builds ground, and shared target release clears ownership on resize/context cleanup', () => {
  const s = bareScene();
  s.prepared.set('none', { view: { composition: { foreground: 'none', nearLedgeMaxFrac: 0 } } });
  s.contextLost = false;
  const frame = { compositions: { none: { foreground: 'none', nearLedgeMaxFrac: 0 } } };
  assert.equal(s.renderGround(frame, 'none'), null, 'no viewport/GL access when no foreground');
  let disposed = 0;
  s.groundTarget = { dispose() { disposed++; } };
  const r = s.residency.reserve({ key: 'range:ground-target', bytes: 1024, owner: 'range-targets' });
  s.residency.commit(r, s.groundTarget, t => t.dispose());
  s.releaseGroundTarget(); s.releaseGroundTarget();
  assert.equal(s.groundTarget, null);
  assert.equal(disposed, 1);
  assert.equal(s.residency.snapshot().liveBytes, 0);
});
