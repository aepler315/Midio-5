// Range v2 Task 8: the presentation boundary. Pass order inside the Range's
// draw, one terrain owner per pass, and explicit legacy fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BiomeManager } from '../src/world/BiomeManager.js';
import { RangePresentation, resolveRangeMode } from '../src/world/alpine/RangePresentation.js';

/** A 2D context that accepts every call and records nothing. */
function anyCtx() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  const handler = {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, transformPoint: (p) => p });
      if (/^create(Linear|Radial|Conic)Gradient$/.test(key)) return () => grad;
      if (key === 'createPattern') return () => ({ setTransform: noop });
      if (key === 'measureText') return () => ({ width: 10 });
      if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (key === 'canvas') return { width: 1408, height: 848 };
      return noop;
    },
    set(target, key, value) { target[key] = value; return true; },
  };
  return new Proxy({}, handler);
}

function manager() {
  const m = new BiomeManager({
    conductor: { barGrid: [], onBar: () => () => {}, on: () => () => {} },
    durationMs: 60000, canvasWidth: 1280, canvasHeight: 720, groundY: 625, songSeed: 3, worldId: 'range',
  });
  const calls = [];
  const rec = (name) => function () { calls.push(name); };
  for (const name of ['_drawSky', '_drawSpectrumMassif', '_drawHorizonEQ', '_drawFarVignettes', '_drawMidDepthLife',
    '_drawGround', '_drawTerrainFooting', '_drawFlood', '_drawForegroundSwell', '_drawTransitionOverlays',
    '_drawFarShore', '_drawOcean', '_drawOceanLife', '_drawFataMorgana', 'drawDeepSky', '_drawCelestial', '_drawMoon']) {
    m[name] = rec(name);
  }
  const legacy = m._drawLegacyScenic;
  m._drawLegacyScenic = function (...args) { calls.push('_drawLegacyScenic'); void legacy; return '#334455'; };
  m.spaceRidge.draw = rec('spaceRidge');
  m.stripsFor = () => ({});
  return { m, calls };
}

function fakePresentation({ ready = true } = {}) {
  const passes = [];
  return {
    passes,
    enabled: true,
    beginScenic() { return ready; },
    drawPartition(ctx, pass) { passes.push(pass); return true; },
  };
}

const groundView = { stage: { width: 1408, height: 848 }, apply() {} };

test('v2 draws its partitions at the retained pass boundaries, legacy scenery not at all', () => {
  const { m, calls } = manager();
  const pres = fakePresentation();
  m.rangePresentation = pres;
  const order = [];
  pres.drawPartition = (ctx, pass) => { order.push(`gpu:${pass}`); calls.push(`gpu:${pass}`); return true; };
  m.draw(anyCtx(), { width: 1408, height: 848 }, 0, 0, null, 1, null, groundView);
  const seq = calls.filter((c) => /gpu:|_draw(HorizonEQ|SpectrumMassif|FarVignettes|MidDepthLife|Ground|LegacyScenic)|spaceRidge|_drawSky/.test(c));
  assert.deepEqual(seq, ['_drawSky', 'spaceRidge', '_drawSpectrumMassif', 'gpu:far', '_drawHorizonEQ', '_drawFarVignettes',
    'gpu:mid', '_drawMidDepthLife', 'gpu:near', '_drawGround']);
  assert.ok(!calls.includes('_drawLegacyScenic'), 'no double-painted terrain');
  assert.equal(calls.filter((c) => c === '_drawHorizonEQ').length, 1, 'the Dancing Ridge draws exactly once');
  assert.equal(m._rangeV2Active, true);
  m.dispose();
});

test('when v2 is not ready the legacy stack draws, with the ridge in its original place', () => {
  const { m, calls } = manager();
  m.rangePresentation = fakePresentation({ ready: false });
  m.draw(anyCtx(), { width: 1408, height: 848 }, 0, 0, null, 1, null, groundView);
  const seq = calls.filter((c) => /gpu:|_draw(HorizonEQ|SpectrumMassif|LegacyScenic|Ground)/.test(c));
  assert.deepEqual(seq, ['_drawHorizonEQ', '_drawSpectrumMassif', '_drawLegacyScenic', '_drawGround']);
  assert.equal(m._rangeV2Active, false);
  m.dispose();
});

test('mode resolution: legacy by default, explicit v2 and view/diagnostic flags', () => {
  assert.deepEqual(resolveRangeMode(''), { mode: 'legacy', forcedViewId: null, diag: null });
  assert.deepEqual(resolveRangeMode('?rangeRenderer=v2'), { mode: 'v2', forcedViewId: null, diag: null });
  assert.deepEqual(resolveRangeMode('?rangeRenderer=V2&rangeView=nc-ross-lake-north&rangeDiag=markers'),
    { mode: 'v2', forcedViewId: 'nc-ross-lake-north', diag: 'markers' });
  assert.equal(resolveRangeMode('?rangeRenderer=webgl').mode, 'legacy', 'unknown values never enable v2');
  assert.equal(resolveRangeMode('?renderer=webgl').mode, 'legacy', 'the old overlay flag does not imply terrain');
});

const catalog = { catalogVersion: 1, views: [{
  id: 'v', regionId: 'r', biome: 'RAINFOREST', status: 'candidate', catalogVersion: 1,
  terrainManifestUrl: 'terrain/v.terrain.json', materialManifestUrl: 'materials/m.json',
  camera: { eyeStartM: [0, 1500, 0], eyeEndM: [10, 1500, 0], targetStartM: [0, 700, -9000], targetEndM: [10, 700, -9000], fovYDeg: 35 },
  characterScores: { energy: .5, rawness: .5, grandeur: .5, dominance: .5 }, evidence: { reviewPath: 'x' },
}] };

function presentationWith(scene, extra = {}) {
  return new RangePresentation({ mode: 'v2', catalog, sceneFactory: async () => scene, ...extra });
}
function fakeScene({ fail = null } = {}) {
  const prepared = new Set();
  return {
    prepared: new Map(), contextLost: false,
    isReady: (id) => prepared.has(id),
    prepare: (view) => (fail ? Promise.reject(Object.assign(new Error(fail), { reason: 'http' })) : (prepared.add(view.id), Promise.resolve({}))),
    resize() {}, release() {}, snapshot: () => ({}),
    renderPartition: () => ({ width: 2, height: 2 }),
  };
}
const inputs = (biome = 'RAINFOREST') => ({
  sim: { songSeed: 1, perf: { level: 0 }, biomes: {
    currentBlend: { from: biome, to: biome, t: 1 }, sections: [{ profile: { name: biome } }], tSec: 1, durationMs: 1000,
    _profile: () => null, groundField: null, energyCurves: null, world: {},
  } },
  pose: { worldX: 0, midioX: 0, midioDrawX: 0, midioY: 0 },
  scenicViewport: { logicalWidth: 1408, logicalHeight: 848, backingWidth: 1408, backingHeight: 848 },
  groundViewport: { logicalWidth: 1408, logicalHeight: 848 },
});

test('an assigned view that is still preparing keeps the frame on legacy, then switches', async () => {
  const p = presentationWith(fakeScene());
  p.setSong({ terrain: { sceneByBiome: new Map([['RAINFOREST', { view: catalog.views[0], fallbackReason: null }]]) }, generation: 1 });
  p.setFrameInputs(inputs());
  assert.equal(p.beginScenic(), false);
  await p.whenReady();
  p.setFrameInputs(inputs());
  assert.equal(p.beginScenic(), true);
  assert.equal(p.snapshot().viewId, 'v');
  assert.equal(p.snapshot().forcedCandidate, false);
});

test('a failed asset takes the legacy path with a recorded reason and no retry storm', async () => {
  const scene = fakeScene({ fail: 'HTTP 404' });
  let tries = 0;
  const prepare = scene.prepare;
  scene.prepare = (...a) => { tries++; return prepare(...a); };
  const p = presentationWith(scene);
  p.setSong({ terrain: { sceneByBiome: new Map([['RAINFOREST', { view: catalog.views[0], fallbackReason: null }]]) }, generation: 1 });
  await p.whenReady();
  for (let i = 0; i < 5; i++) { p.setFrameInputs(inputs()); assert.equal(p.beginScenic(), false); }
  assert.match(p.snapshot().reason, /404/);
  assert.equal(tries, 1);
});

test('no WebGL2: the runtime fails once and legacy continues', async () => {
  const p = new RangePresentation({ mode: 'v2', catalog, sceneFactory: async () => { throw new Error('WebGL2 unavailable'); } });
  p.setFrameInputs(inputs());
  p.beginScenic();
  await p.whenReady();
  p.setFrameInputs(inputs());
  assert.equal(p.beginScenic(), false);
  assert.match(p.snapshot().reason, /WebGL2 unavailable/);
  assert.equal(p.snapshot().runtime, 'failed');
});

test('a biome without an approved view stays legacy with its fallback reason', async () => {
  const p = presentationWith(fakeScene());
  p.setSong({ terrain: { sceneByBiome: new Map([['DESERT', { view: null, fallbackReason: 'no-view-for-biome' }]]) }, generation: 1 });
  await p.whenReady();
  p.setFrameInputs(inputs('DESERT'));
  assert.equal(p.beginScenic(), false);
  assert.equal(p.snapshot().reason, 'no-view-for-biome');
});

test('a forced candidate is drawn and labelled; legacy mode never starts a GPU context', async () => {
  const forced = presentationWith(fakeScene(), { forcedViewId: 'v' });
  forced.setSong({ terrain: null, generation: 1 });
  await forced.whenReady();
  forced.setFrameInputs(inputs('DESERT'));
  assert.equal(forced.beginScenic(), true);
  assert.equal(forced.snapshot().forcedCandidate, true);
  let built = false;
  const legacy = new RangePresentation({ mode: 'legacy', catalog, sceneFactory: async () => { built = true; } });
  legacy.setFrameInputs(inputs());
  assert.equal(legacy.beginScenic(), false);
  await legacy.whenReady();
  assert.equal(built, false);
});

test('blending toward a biome with no view fades the outgoing view out over legacy; arriving there draws legacy', async () => {
  const p = presentationWith(fakeScene());
  p.setSong({ terrain: { sceneByBiome: new Map([
    ['RAINFOREST', { view: catalog.views[0], fallbackReason: null }],
    ['DESERT', { view: null, fallbackReason: 'no-view-for-biome' }],
  ]) }, generation: 1 });
  await p.whenReady();
  const at = (t) => {
    const i = inputs();
    i.sim.biomes.currentBlend = { from: 'RAINFOREST', to: 'DESERT', t };
    p.setFrameInputs(i);
    return p.beginScenic();
  };
  assert.equal(at(0), true, 'before the blend starts the outgoing view draws');
  assert.equal(p.arrival, 1);
  // Not a one-frame cut: the outgoing view keeps drawing, fading out over
  // the legacy stack as the blend proceeds.
  assert.equal(at(0.25), true);
  const early = p.arrival;
  assert.equal(p.snapshot().viewId, catalog.views[0].id);
  assert.ok(p.arriving, 'legacy scenery draws underneath');
  assert.equal(at(0.75), true);
  assert.ok(p.arrival < early && early < 1, `fades out: ${early} -> ${p.arrival}`);
  assert.equal(at(1), false);
  assert.equal(p.snapshot().reason, 'no-view-for-biome');
});

test('a view that fails to prepare asks for the captions to be rebuilt', async () => {
  const p = presentationWith(fakeScene({ fail: 'HTTP 404' }));
  let refreshed = 0;
  p.onAvailabilityChange = () => { refreshed++; };
  p.setSong({ terrain: { sceneByBiome: new Map([['RAINFOREST', { view: catalog.views[0], fallbackReason: null }]]) }, generation: 1 });
  await p.whenReady();
  assert.equal(refreshed, 1);
  assert.equal(p.captionViewFor('RAINFOREST'), null, 'the failed view is no longer named');
});
