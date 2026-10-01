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
  for (const name of ['_drawSky', '_drawSpectrumMassif', '_drawHorizonEQ', '_drawCrestLight', '_drawFarVignettes', '_drawMidDepthLife',
    '_drawGround', '_drawTerrainFooting', '_drawFlood', '_drawForegroundSwell', '_drawTransitionOverlays',
    '_drawFarShore', '_drawOcean', '_drawOceanLife', '_drawFataMorgana', 'drawDeepSky', '_drawCelestial', '_drawMoon']) {
    m[name] = rec(name);
  }
  const legacy = m._drawLegacyScenic;
  m._drawLegacyScenic = function (...args) { calls.push('_drawLegacyScenic'); void legacy; return '#334455'; };
  m.spaceRidge.drawAurora = rec('spaceRidge');
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
  const seq = calls.filter((c) => /gpu:|_draw(HorizonEQ|CrestLight|SpectrumMassif|FarVignettes|MidDepthLife|Ground|LegacyScenic)|spaceRidge|_drawSky/.test(c));
  assert.deepEqual(seq, ['_drawSky', 'spaceRidge', '_drawSpectrumMassif', 'gpu:far', '_drawCrestLight', '_drawFarVignettes',
    'gpu:mid', '_drawMidDepthLife', 'gpu:near', '_drawGround']);
  assert.ok(!calls.includes('_drawLegacyScenic'), 'no double-painted terrain');
  assert.equal(calls.filter((c) => c === '_drawCrestLight').length, 1, 'the Dancing Ridge lights the far range exactly once');
  assert.ok(!calls.includes('_drawHorizonEQ'), 'its drawn line belongs to the legacy stack only');
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

test('ordinary v2 ocean remains behind every terrain partition without needing a hazard', () => {
  const { m, calls } = manager();
  m._activeWithdrawal = () => 0;
  m._activeTsunami = () => null;
  const pres = fakePresentation();
  m.rangePresentation = pres;
  pres.drawPartition = (ctx, pass) => { calls.push(`gpu:${pass}`); return true; };
  m.draw(anyCtx(), { width: 1408, height: 848 }, 0, 0, null, 1, null, groundView);
  assert.equal(calls.filter((c) => c === '_drawOcean').length, 1);
  for (const pass of ['far', 'mid', 'near']) {
    assert.ok(calls.indexOf('_drawOcean') < calls.indexOf(`gpu:${pass}`), `${pass} terrain occludes sea`);
  }
  assert.ok(!calls.includes('_drawOceanLife'), 'inland scene keeps legacy sea fauna off');
  m.dispose();
});

test('glacial inland pilot suppresses distant sea throughout a biome handoff', () => {
  const { m, calls } = manager();
  m.rangePresentation = fakePresentation();
  m.rangePresentation.captionViewFor = (name) => name === 'CONIFER' ? { glacier: {} } : {};
  for (const t of [0, .5, 1]) {
    m.currentBlend = { from: 'RAINFOREST', to: 'CONIFER', t };
    calls.length = 0;
    m.draw(anyCtx(), { width: 1408, height: 848 }, 0, 0, null, 1, null, groundView);
    assert.ok(!calls.includes('_drawOcean'), 'inland pilot has its own river/lake receivers');
  }
  m.dispose();
});

test('mode resolution: v2 by default, explicit legacy opt-out and view/diagnostic flags', () => {
  assert.deepEqual(resolveRangeMode(''), { mode: 'v2', forcedViewId: null, diag: null });
  assert.deepEqual(resolveRangeMode('?rangeRenderer=legacy'), { mode: 'legacy', forcedViewId: null, diag: null });
  assert.equal(resolveRangeMode('?rangeRenderer=LEGACY').mode, 'legacy');
  assert.deepEqual(resolveRangeMode('?rangeRenderer=v2'), { mode: 'v2', forcedViewId: null, diag: null });
  assert.deepEqual(resolveRangeMode('?rangeRenderer=V2&rangeView=nc-ross-lake-north&rangeDiag=markers'),
    { mode: 'v2', forcedViewId: 'nc-ross-lake-north', diag: 'markers' });
  assert.equal(resolveRangeMode('?rangeRenderer=webgl').mode, 'v2', 'unknown values take the default');
  assert.equal(resolveRangeMode('?renderer=webgl').mode, 'v2', 'the old overlay flag does not change the Range renderer');
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

// Budget: a song's views compete for one residency budget.
const views4 = ['RAINFOREST', 'CONIFER', 'TUNDRA', 'TAIGA'].map((biome, i) => ({ ...catalog.views[0], id: `v${i}`, biome }));
const song4 = () => ({ sceneByBiome: new Map(views4.map((v) => [v.biome, { view: v, fallbackReason: null }])) });
/** A scene with room for `cap` views (prepared or still preparing). */
function budgetScene(cap) {
  const prepared = new Set(), jobs = new Map(), calls = [];
  const s = {
    cap, calls, prepared: new Map(), contextLost: false,
    isReady: (id) => prepared.has(id),
    prepare(view) {
      calls.push(view.id);
      if (jobs.has(view.id)) return jobs.get(view.id);
      if (prepared.size + jobs.size >= s.cap) return Promise.reject(Object.assign(new Error(`no GPU room for ${view.id}`), { reason: 'budget' }));
      const job = new Promise((r) => setTimeout(() => { jobs.delete(view.id); prepared.add(view.id); r({}); }, 5));
      jobs.set(view.id, job);
      return job;
    },
    evict(id) { prepared.delete(id); },
    pinView() {}, resize() {}, release() {}, snapshot: () => ({}), renderPartition: () => ({ width: 2, height: 2 }),
  };
  return s;
}

test('whenReady prepares views in song order and stops at the first that does not fit', async () => {
  const scene = budgetScene(2);
  const p = presentationWith(scene, { catalog: { ...catalog, views: views4 } });
  p.setSong({ terrain: song4(), generation: 1 });
  await p.whenReady();
  assert.ok(scene.isReady('v0') && scene.isReady('v1'), 'the opening views are prepared');
  assert.ok(!scene.isReady('v2') && !scene.isReady('v3'));
  assert.deepEqual(scene.calls, ['v0', 'v1', 'v2'], 'one at a time, in song order; v3 is left for later');
  // A refusal is not a failure: the biome is still v2's (no legacy strips).
  assert.deepEqual(p.snapshot().failures, {});
  assert.ok(p.coversBiome('TUNDRA'));
});

test('a budget refusal is retried once room is freed, never dropped to legacy for the song', async () => {
  const scene = budgetScene(0);
  const p = presentationWith(scene, { catalog: { ...catalog, views: views4 } });
  p.setSong({ terrain: song4(), generation: 1 });
  await p._ensureRuntime();
  p.setFrameInputs(inputs('RAINFOREST'));
  assert.equal(p.beginScenic(), false);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(p.snapshot().deferred, ['v0']);
  // Within the retry interval the view is not asked for again every frame.
  p.setFrameInputs(inputs('RAINFOREST'));
  p.beginScenic();
  assert.equal(scene.calls.length, 1);
  // Room appears (views no longer on screen were evicted); after the
  // interval the next frame asks again and the view arrives.
  scene.cap = 1;
  p._prepare(views4[0], Date.now() + 2000);
  await new Promise((r) => setTimeout(r, 20));
  p.setFrameInputs(inputs('RAINFOREST'));
  assert.equal(p.beginScenic(), true);
  assert.equal(p.snapshot().viewId, 'v0');
});

test('export: settle waits for the view a frame lacked and asks for the same instant again', async () => {
  const scene = budgetScene(1);
  const p = presentationWith(scene, { catalog: { ...catalog, views: views4 } });
  p.setSong({ terrain: song4(), generation: 1, exportMode: true });
  await p.whenReady();
  assert.ok(scene.isReady('v0'));
  // The song reaches CONIFER: its view is not prepared and there is no room
  // until the previous view is evicted (the ledger does that once it is no
  // longer pinned).
  p.setFrameInputs(inputs('CONIFER'));
  assert.equal(p.beginScenic(), false);
  scene.evict('v0');
  assert.equal(await p.settle(), true, 'it waited: the caller redraws the frame');
  p.setFrameInputs(inputs('CONIFER'));
  assert.equal(p.beginScenic(), true);
  assert.equal(p.snapshot().viewId, 'v1');
  assert.equal(await p.settle(), false, 'nothing lacking: no redraw');
});

/** budgetScene whose reservations evict the oldest unpinned view (as the
 *  residency ledger does) before refusing. */
function evictingScene(cap) {
  const s = budgetScene(cap);
  const order = [];
  let pinned = new Set();
  const base = s.prepare;
  s.pinView = (ids) => { pinned = new Set([].concat(ids)); };
  s.ensureSide = () => true;
  s.prepare = (view) => {
    if (!s.isReady(view.id)) {
      const victim = order.find((id) => s.isReady(id) && !pinned.has(id));
      if (victim && order.filter((id) => s.isReady(id)).length >= s.cap) { s.evict(victim); order.splice(order.indexOf(victim), 1); }
    }
    const job = base(view);
    job.then(() => { if (!order.includes(view.id)) order.push(view.id); }, () => {});
    return job;
  };
  return s;
}

test('export: settling a travel keeps the side already prepared while the other is built', async () => {
  const scene = evictingScene(2);
  const makeCanvas = (w, h) => ({ width: w, height: h, getContext: () => anyCtx() });
  const p = presentationWith(scene, { catalog: { ...catalog, views: views4 }, makeCanvas });
  p.setSong({ terrain: song4(), generation: 1, exportMode: true });
  await p.whenReady(); // v0 then v1 prepared, in song order
  assert.ok(scene.isReady('v0') && scene.isReady('v1'));
  // A travel from TUNDRA (v2, not prepared) to RAINFOREST (v0, prepared).
  const travel = inputs('TUNDRA');
  travel.sim.biomes.currentBlend = { from: 'TUNDRA', to: 'RAINFOREST', t: 0.5 };
  p.setFrameInputs(travel);
  p.beginScenic();
  assert.equal(await p.settle(), true);
  assert.ok(scene.isReady('v2') && scene.isReady('v0'), 'the unrelated v1 was evicted, not the incoming v0');
  p.setFrameInputs(travel);
  assert.equal(p.beginScenic(), true);
  assert.equal(p.snapshot().incomingViewId, 'v0');
});

test('export: settle waits for a view still being built even after earlier refusals', async () => {
  const scene = budgetScene(0);
  const p = presentationWith(scene, { catalog: { ...catalog, views: views4 } });
  p.setSong({ terrain: song4(), generation: 1, exportMode: true });
  await p._ensureRuntime();
  p.setFrameInputs(inputs('RAINFOREST'));
  p.beginScenic();
  // Refused twice, then room appears while settle retries.
  let refusals = 0;
  const prepare = scene.prepare;
  scene.prepare = (v) => { if (++refusals === 3) scene.cap = 1; return prepare(v); };
  assert.equal(await p.settle({ attempts: 3 }), true);
  assert.ok(scene.isReady('v0'), 'the attempt that got room was waited for');
});

test('a budget refusal asks the owner to free fallback scenery; only covered biomes lose their strips', async () => {
  const scene = budgetScene(0);
  const p = presentationWith(scene, { catalog: { ...catalog, views: views4 } });
  const asked = [];
  p.onBudgetRefusal = (id) => asked.push(id);
  p.setSong({ terrain: song4(), generation: 1 });
  await p._ensureRuntime();
  p.setFrameInputs(inputs('RAINFOREST'));
  p.beginScenic();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(asked, ['v0']);
  // The owner's side: BiomeManager drops the strip sets v2 covers (a legacy
  // frame re-bakes on demand) and keeps the rest.
  const { m } = manager();
  const kept = [];
  m.strips = { entries: new Map([['RAINFOREST', {}], ['DESERT', {}]]), delete(k) { this.entries.delete(k); } };
  m.rangePresentation = { coversBiome: (b) => b === 'RAINFOREST' };
  assert.equal(m.dropCoveredStrips(), 1);
  kept.push(...m.strips.entries.keys());
  assert.deepEqual(kept, ['DESERT']);
});

test('settle does not wait while the GPU context is lost', async () => {
  const scene = budgetScene(0);
  const p = presentationWith(scene, { catalog: { ...catalog, views: views4 } });
  p.setSong({ terrain: song4(), generation: 1, exportMode: true });
  await p._ensureRuntime();
  p.setFrameInputs(inputs('RAINFOREST'));
  p.beginScenic();
  scene.contextLost = true;
  const t0 = Date.now();
  assert.equal(await p.settle({ timeoutMs: 5000 }), false);
  assert.ok(Date.now() - t0 < 200, 'returned at once');
});

test('frame timings sum every pass of a frame and restart with the next frame', async () => {
  const spin = (ms) => { const end = performance.now() + ms; while (performance.now() < end) { /* busy */ } };
  const scene = fakeScene();
  scene.renderPartition = () => { spin(3); return { width: 2, height: 2 }; };
  scene.renderGround = () => { spin(3); return { canvas: { width: 2, height: 2 }, stage: null }; };
  const p = presentationWith(scene);
  p.setSong({ terrain: { sceneByBiome: new Map([['RAINFOREST', { view: catalog.views[0], fallbackReason: null }]]) }, generation: 1 });
  await p.whenReady();
  const ctx = { save() {}, restore() {}, drawImage() {} };
  const stage = { width: 2, height: 2 };
  const frame = () => {
    p.setFrameInputs(inputs());
    assert.equal(p.beginScenic(), true);
    for (const pass of ['far', 'mid', 'near']) assert.equal(p.drawPartition(ctx, pass, stage), true);
    assert.equal(p.drawGround(ctx, stage), true);
    return { ...p.timings };
  };
  const a = frame();
  assert.ok(a.frameRenderMs >= 12, `four 3 ms passes summed, got ${a.frameRenderMs}`);
  assert.ok(a.lastPartitionMs < a.frameRenderMs, 'the last pass alone is not the frame');
  const b = frame();
  assert.equal(b.frameId, a.frameId + 1);
  assert.ok(b.frameRenderMs < a.frameRenderMs * 2, 'totals restart with each frame');
});

test('a view built across a context loss is retried, not failed; a refused render target asks for room', async () => {
  const scene = fakeScene();
  let tries = 0;
  scene.prepare = () => { tries++; return Promise.reject(Object.assign(new Error('context changed'), { reason: 'context-lost' })); };
  const p = presentationWith(scene);
  p.setSong({ terrain: { sceneByBiome: new Map([['RAINFOREST', { view: catalog.views[0], fallbackReason: null }]]) }, generation: 1 });
  await p.whenReady({ timeoutMs: 50 });
  assert.equal(p.failures.has('v'), false, 'a context change is not the view failing');
  // A playing frame asks again; the refusal defers the next try.
  p.setFrameInputs(inputs());
  assert.equal(p.beginScenic(), false);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(p.failures.has('v'), false);
  assert.ok(p.deferred.has('v'), 'retried after a short delay');
  assert.ok(tries >= 1);

  const s2 = fakeScene();
  s2.resize = () => { throw new Error('no room for the render target'); };
  const q = presentationWith(s2);
  let refusals = 0;
  q.onBudgetRefusal = () => { refusals++; };
  q.setSong({ terrain: { sceneByBiome: new Map([['RAINFOREST', { view: catalog.views[0], fallbackReason: null }]]) }, generation: 1 });
  await q.whenReady();
  q.setFrameInputs(inputs());
  assert.equal(q.beginScenic(), false);
  assert.match(q.snapshot().reason, /budget/);
  assert.equal(refusals, 1);
});

test('migrated no-stage final manager path suppresses opaque foreground painters even during arrival', () => {
  for (const arriving of [false, true]) for (const groundAvailable of [false, true]) {
    const { m, calls } = manager();
    m.groundField = { visibleBars: () => [{ x: 0, width: 1408, y: 500 }] };
    m._groundReceivers = { wetMasks: ['stale'] };
    m._lakeReflectGroundY = 500;
    m.rangePresentation = { ...fakePresentation(), arriving, hasViewComposition: true,
      stage: null, drawGround: () => groundAvailable, groundReceivers: () => null };
    m.draw(anyCtx(), { width: 1408, height: 848 }, 0, 0, null, 1, null, groundView);
    for (const painter of ['_drawGround', '_drawTerrainFooting', '_drawFlood', '_drawForegroundSwell']) {
      assert.ok(!calls.includes(painter), `${painter} cannot cover revealed terrain`);
    }
    assert.equal(m._groundReceivers, null);
    assert.equal(m._lakeReflectGroundY, null);
    assert.equal(calls.filter(c => c === '_drawTransitionOverlays').length, 1);
    m.dispose();
  }
});

test('a view that composes its own foreground takes neither the veil nor the landmark occluders', () => {
  for (const owned of [false, true]) {
    const { m } = manager();
    m.currentBlend = { from: 'TAIGA', to: 'TAIGA', t: 1 };
    let landmarks = 0, discs = 0;
    m.nearField.draw = () => { landmarks++; };
    m.rangePresentation = { hasViewComposition: owned };
    const ctx = anyCtx();
    ctx.ellipse = () => { discs++; };
    m.drawForeground(ctx, { width: 1408, height: 848 }, 0, true);
    assert.equal(landmarks, owned ? 0 : 1);
    assert.equal(discs, owned ? 0 : 3);
    m.dispose();
  }
});
