import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../src/vendor/range/three-range.module.js';
import { JourneyScene } from '../src/world/alpine/JourneyScene.js';
import * as JourneyMaterial from '../src/world/alpine/JourneyMaterial.js';
import { JOURNEY_VIEW } from '../src/world/alpine/JourneyWorld.js';
import { GraphicsResidency } from '../src/render/GraphicsResidency.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('a cancelled bitmap decode cannot release a ready replacement journey', { timeout: 5000 }, async t => {
  // Exercise real preparation, verified asset loading and disposal. Only the
  // browser's canvas/GPU boundary and asynchronous bitmap decoder are stubbed.
  const globals = new Map();
  const replaceGlobal = (name, value) => {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  class RendererStub {
    setPixelRatio() {}
    dispose() {}
    forceContextLoss() {}
  }
  replaceGlobal('document', { createElement: () => ({
    getContext: () => ({}), addEventListener() {}, removeEventListener() {},
  }) });
  replaceGlobal('fetch', async (url, { signal } = {}) => {
    signal?.throwIfAborted();
    const bytes = await readFile(new URL(url));
    return { ok: true, arrayBuffer: async () => {
      signal?.throwIfAborted();
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    } };
  });

  const enteredDecode = deferred(), finishDecode = deferred();
  const manifest = JSON.parse(await readFile(new URL('../src/assets/range/v2/materials/wet-conifer.json', import.meta.url), 'utf8'));
  const dimensions = new Map(Object.values(manifest.textures).map(texture => [texture.bytes, texture]));
  const images = [];
  let decodeCount = 0;
  replaceGlobal('createImageBitmap', async blob => {
    if (++decodeCount === 1) {
      enteredDecode.resolve();
      await finishDecode.promise;
    }
    const { width, height } = dimensions.get(blob.size);
    const image = { width, height, closed: false, close() { this.closed = true; } };
    images.push(image);
    return image;
  });

  const residency = new GraphicsResidency();
  const runtime = { ...THREE, WebGLRenderer: RendererStub };
  const old = new JourneyScene({ THREE: runtime, residency });
  const replacement = new JourneyScene({ THREE: runtime, residency });
  let oldLoad;
  t.after(async () => {
    finishDecode.resolve();
    await oldLoad?.catch(() => {});
    old.dispose(); replacement.dispose();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  oldLoad = old.prepare(JOURNEY_VIEW, { generation: 1 });
  await Promise.race([enteredDecode.promise, oldLoad.then(() => assert.fail('old load must pause inside bitmap decode'))]);
  old.dispose();
  residency.cancelGeneration(1);
  await replacement.prepare(JOURNEY_VIEW, { generation: 2 });
  assert.equal(replacement.isReady(JOURNEY_VIEW.id), true);
  const prepared = replacement.prepared.get(JOURNEY_VIEW.id);
  const replacementImages = [...prepared.pack.images.values()];
  assert.ok(prepared.shadowScene.children.includes(prepared.cast.depthGroup), 'the articulated cast supplies terrain shadow contact');
  if(JourneyMaterial.journeyDressing){
    assert.ok(prepared.dressing, 'native shoreline dressing is prepared');
    assert.ok(prepared.meshes.includes(prepared.dressing)&&prepared.scene.children.includes(prepared.dressing));
  }
  let disposedGeometries=0;
  for(const mesh of prepared.meshes)mesh.geometry.addEventListener('dispose',()=>disposedGeometries++);

  finishDecode.resolve();
  await oldLoad;
  assert.equal(old.pending.size, 0);
  assert.equal(replacement.isReady(JOURNEY_VIEW.id), true, 'stale cleanup must leave the replacement ready');
  assert.equal(replacement.prepared.get(JOURNEY_VIEW.id), prepared);
  assert.equal(residency.entries.get(prepared.gpuKey)?.resource, prepared, 'the replacement retains its live reservation');
  assert.ok(replacementImages.every(image => !image.closed), 'replacement images remain available for GPU upload');
  assert.ok(images.filter(image => !replacementImages.includes(image)).every(image => image.closed), 'stale decoded images are closed');

  replacement.dispose();
  assert.equal(residency.entries.size, 0, 'final disposal releases all reservations');
  assert.equal(disposedGeometries,prepared.meshes.length,'every owned mesh geometry, including dressing, is disposed exactly once');
  assert.ok(images.every(image => image.closed));
});
