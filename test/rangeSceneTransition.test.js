// Range v2 Task 14: travel between two scenic views composites both sides
// through the shared travel seam; the outgoing view stays valid throughout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RangePresentation } from '../src/world/alpine/RangePresentation.js';
import { travelSeam, travelSpans } from '../src/world/TravelSeam.js';

const camera = { eyeStartM: [0, 1500, 0], eyeEndM: [10, 1500, 0], targetStartM: [0, 700, -9000], targetEndM: [10, 700, -9000], fovYDeg: 35 };
const view = (id, biome) => ({ id, regionId: 'r', biome, status: 'approved', catalogVersion: 1,
  terrainManifestUrl: `terrain/${id}.terrain.json`, materialManifestUrl: 'materials/m.json', camera,
  characterScores: { energy: .5, rawness: .5, grandeur: .5, dominance: .5 }, evidence: { reviewPath: 'x' } });
const catalog = { catalogVersion: 1, views: [view('a', 'RAINFOREST'), view('b', 'TAIGA')] };
const W = 1408, H = 848;

function fakeScene({ failB = false, holdB = false, sideRoom = true } = {}) {
  const ready = new Set();
  const calls = [];
  const scene = {
    calls, contextLost: false, sideB: false,
    isReady: (id) => ready.has(id),
    prepare: (v) => {
      if (v.id === 'b' && failB) return Promise.reject(Object.assign(new Error('HTTP 404'), { reason: 'http' }));
      if (v.id === 'b' && holdB) return new Promise(() => {});
      ready.add(v.id);
      return Promise.resolve({});
    },
    resize() {}, release() {}, snapshot: () => ({}), pinView(ids) { scene.pinned = [].concat(ids); },
    ensureSide() { if (!sideRoom) return false; scene.sideB = true; return true; },
    releaseSide() { scene.sideB = false; },
    renderPartition: (frame, pass, id, opts = {}) => { calls.push({ pass, id, side: opts.side || 'A' }); return { id }; },
    renderGround: (frame, id) => ({ canvas: { id }, stage: { id, wetMasks: [], pools: [] } }),
  };
  return scene;
}

const inputs = (t, { travel = true } = {}) => ({
  sim: { songSeed: 1, perf: { level: 0 }, biomes: {
    currentBlend: { from: 'RAINFOREST', to: 'TAIGA', t, travel, travelP: t }, sections: [{ profile: { name: 'RAINFOREST' } }],
    tSec: 1, durationMs: 1000, _profile: () => null, groundField: null, energyCurves: null, world: {},
  } },
  pose: { worldX: 0, midioX: 0, midioDrawX: 0, midioY: 0 },
  scenicViewport: { logicalWidth: W, logicalHeight: H, backingWidth: W, backingHeight: H },
  groundViewport: { logicalWidth: W, logicalHeight: H },
});

function recordingCtx() {
  const draws = [];
  let clip = null;
  const stack = [];
  return {
    draws, globalAlpha: 1, globalCompositeOperation: 'source-over',
    save() { stack.push([clip, this.globalAlpha]); }, restore() { [clip, this.globalAlpha] = stack.pop(); },
    beginPath() {}, rect(x, y, w) { clip = [x, x + w]; }, clip() {},
    drawImage(img) { draws.push({ id: img.id, clip, alpha: this.globalAlpha }); },
  };
}

async function presentation(sceneOpts) {
  const scene = fakeScene(sceneOpts);
  const p = new RangePresentation({ mode: 'v2', catalog, sceneFactory: async () => scene });
  p.setSong({ terrain: { sceneByBiome: new Map([['RAINFOREST', { view: catalog.views[0] }], ['TAIGA', { view: catalog.views[1] }]]) }, generation: 1 });
  await p.whenReady({ timeoutMs: 50 }).catch(() => {});
  return { p, scene };
}

test('endpoints: before the travel only the outgoing view draws, after it only the incoming one', async () => {
  const { p, scene } = await presentation();
  for (const [t, want] of [[0, 'a'], [1, 'b']]) {
    scene.calls.length = 0;
    p.setFrameInputs(inputs(t));
    assert.equal(p.beginScenic(), true);
    assert.equal(p.snapshot().incomingViewId, null);
    p.drawPartition(recordingCtx(), 'far', { width: W, height: H });
    assert.deepEqual(scene.calls.map((c) => c.id), [want]);
  }
});

test('25/50/75%: both sides render; the seam moves right to left, nearest layers first', async () => {
  const { p, scene } = await presentation();
  let prev = Infinity;
  for (const t of [0.25, 0.5, 0.75]) {
    scene.calls.length = 0;
    p.setFrameInputs(inputs(t));
    assert.equal(p.beginScenic(), true);
    assert.equal(p.snapshot().incomingViewId, 'b');
    assert.deepEqual(scene.pinned.sort(), ['a', 'b']);
    const ctx = recordingCtx();
    p.drawPartition(ctx, 'near', { width: W, height: H });
    assert.deepEqual(scene.calls.map((c) => [c.id, c.side]), [['a', 'A'], ['b', 'B']]);
    const { lo, hi } = travelSpans(W, 'L5', t);
    // Solid A left of the seam, solid B right of it, crossfades between.
    const near = (x, y) => Math.abs(x - y) < 1e-6;
    if (lo > -W * 2) assert.ok(ctx.draws.some((d) => d.id === 'a' && d.alpha === 1 && near(d.clip[1], lo)));
    assert.ok(ctx.draws.some((d) => d.id === 'b' && d.alpha === 1 && near(d.clip[0], hi)));
    for (const d of ctx.draws.filter((x) => x.alpha < 1)) assert.ok(d.clip[0] >= lo - 1e-9 && d.clip[1] <= hi + 1e-9);
    const seam = travelSeam(W, 'L5', t);
    assert.ok(seam < prev);
    prev = seam;
  }
  // The near partition leads the far skyline at the same moment.
  assert.ok(travelSeam(W, 'L5', 0.5) < travelSeam(W, 'L2', 0.5));
});

test('an incoming view that is still loading, or fails, leaves the outgoing view drawing', async () => {
  for (const opts of [{ holdB: true }, { failB: true }]) {
    const { p, scene } = await presentation(opts);
    p.setFrameInputs(inputs(0.5));
    assert.equal(p.beginScenic(), true, 'never a legacy flash mid-travel');
    assert.equal(p.snapshot().incomingViewId, null);
    scene.calls.length = 0;
    p.drawPartition(recordingCtx(), 'mid', { width: W, height: H });
    assert.deepEqual(scene.calls.map((c) => c.id), ['a']);
  }
});

test('no room for the incoming target: the outgoing view carries on, and the target is released after travel', async () => {
  const { p, scene } = await presentation({ sideRoom: false });
  p.setFrameInputs(inputs(0.5));
  assert.equal(p.beginScenic(), true);
  assert.equal(p.snapshot().incomingViewId, null);
  const ok = await presentation();
  ok.p.setFrameInputs(inputs(0.5));
  ok.p.beginScenic();
  assert.equal(ok.scene.sideB, true);
  ok.p.setFrameInputs(inputs(1));
  ok.p.beginScenic();
  assert.equal(ok.scene.sideB, false, 'released once no travel needs it');
  void scene;
});

test('the rock stage travels too, and its pools come from the side holding the centre', async () => {
  const { p } = await presentation();
  for (const [t, want] of [[0.1, 'a'], [0.9, 'b']]) {
    p.setFrameInputs(inputs(t));
    p.beginScenic();
    p.drawGround(recordingCtx(), { width: W, height: H });
    assert.equal(p.stage.id, want);
  }
});

test('a view that becomes ready after legacy was on screen fades in over heard time, pure under seek', async () => {
  const { ARRIVAL_SEC } = await import('../src/world/alpine/RangePresentation.js');
  let release;
  const gate = new Promise((r) => { release = r; });
  const scene = fakeScene();
  const prepare = scene.prepare;
  scene.prepare = (v) => gate.then(() => prepare(v));
  const p = new RangePresentation({ mode: 'v2', catalog, sceneFactory: async () => scene });
  p.setSong({ terrain: { sceneByBiome: new Map([['RAINFOREST', { view: catalog.views[0] }]]) }, generation: 1 });
  const at = (tSec, extra = {}) => {
    const i = inputs(1, { travel: false });
    i.sim.biomes.currentBlend = { from: 'RAINFOREST', to: 'RAINFOREST', t: 1 };
    i.sim.biomes.tSec = tSec;
    Object.assign(i.sim, extra);
    p.setFrameInputs(i);
    return p.beginScenic();
  };
  await p.whenReady({ timeoutMs: 1 }).catch(() => {});
  assert.equal(at(10), false, 'legacy while preparing');
  release();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(at(20), true);
  assert.equal(p.arrival, 0);
  assert.equal(p.arriving, true);
  assert.equal(p.groundReceivers(), null, 'receivers stay legacy mid-fade');
  at(20 + ARRIVAL_SEC / 2);
  const mid = p.arrival;
  assert.ok(mid > 0.3 && mid < 0.7);
  at(20 + ARRIVAL_SEC / 2);
  assert.equal(p.arrival, mid, 'paused: holds');
  const ctx = recordingCtx();
  p.drawPartition(ctx, 'far', { width: W, height: H });
  assert.ok(Math.abs(ctx.draws[0].alpha - mid) < 1e-12, 'drawn at the arrival alpha');
  at(20 + ARRIVAL_SEC + 0.01);
  assert.equal(p.arrival, 1);
  assert.equal(p.arriving, false);
  at(21);
  assert.equal(p.arrival, 1, 'a completed arrival never restarts on its own');
  // Export waits for readiness and never fades.
  at(30, {}); p._legacyShown = true;
  at(31, { exportMode: true });
  assert.equal(p.arrival, 1);
});
