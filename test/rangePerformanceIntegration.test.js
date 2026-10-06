import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLandscapePresentation, resolveRangeExperience, rangePerformanceViewId } from '../src/world/LandscapePresentation.js';
import { Simulation } from '../src/sim/Simulation.js';
import { Conductor } from '../src/core/Conductor.js';
import { ParamBus } from '../src/core/ParamBus.js';
import { Renderer } from '../src/render/Renderer.js';
import * as THREE from '../src/vendor/range/three-range.module.js';
import { buildRangeFrame } from '../src/world/alpine/RangeFrame.js';
import { RangeScene } from '../src/world/alpine/RangeScene.js';
import { sceneUniforms } from '../src/world/alpine/TerrainMaterial.js';

test('Range owns a world habitat without enabling retired performer effects', () => {
  assert.equal(resolveLandscapePresentation({ kind: 'alpine' }).trioHabitat, true);
  assert.equal(resolveLandscapePresentation({ kind: 'alpine' }).performers, false);
  assert.equal(resolveLandscapePresentation({ kind: 'alpine' }).inhabitants, false);
  assert.equal(resolveLandscapePresentation({ kind: 'alpine' }, { rangeExperience: 'landscape' }).trioHabitat, false);
  for (const kind of ['abyssal', 'farside', 'nave', 'city']) {
    assert.equal(resolveLandscapePresentation({ kind }).trioHabitat, false);
  }
});

test('performance is the Range default and explicit scenery/view choices remain available', () => {
  assert.equal(resolveRangeExperience(''), 'performance');
  assert.equal(resolveRangeExperience('?rangeExperience=landscape'), 'landscape');
  assert.equal(resolveRangeExperience('?rangeExperience=unknown'), 'performance');
  assert.equal(rangePerformanceViewId({}, 'performance'), 'muncho-lake-south');
  assert.equal(rangePerformanceViewId({}, 'landscape'), null);
  assert.equal(rangePerformanceViewId({ viewId: 'teton-jackson-lake' }, 'performance'), 'teton-jackson-lake');
  assert.equal(rangePerformanceViewId({ biome: 'DESERT' }, 'performance'), null);
});

function fixture(worldId, rangeExperience = 'performance', silent = false) {
  const conductor = new Conductor();
  conductor.load({ timeline: silent ? [] : [
    { tMs: 1000, durMs: 300, role: 'RHYTHM', vel: .9, kick: true, src: 'midi' },
    { tMs: 1000, durMs: 900, role: 'BASS', vel: .8, pitch: 40, src: 'midi' },
    { tMs: 1000, durMs: 600, role: 'MELODY', vel: .7, pitch: 70, src: 'midi' },
  ], durationMs: 60000, bpm: 120, barGrid: [] });
  const sim = new Simulation(conductor, new ParamBus(), { worldId, rangeExperience, songSeed: 315 });
  sim.biomes.pumpStripPrewarm = () => {};
  sim.biomes.draw = function () { assert.equal(this.inhabitedShore, false); };
  sim.perf = { particleMul: 1, heavyPostFx: false, bloomEnabled: false, fullFrameFxEnabled: false };
  sim.highlightReel = null;
  sim.fracture.captureFreeze = () => {};
  const canvas = { width: 640, height: 360 };
  let strokes = 0;
  const ctx = new Proxy({ canvas, globalAlpha: 1,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 0 }), stroke() { strokes++; } },
  { get: (o, p) => p in o ? o[p] : () => {} });
  canvas.getContext = () => ctx;
  const renderer = new Renderer(canvas);
  for (const method of ['_drawMidio', '_drawMidioAfterimages', '_drawGoldAfterimages', '_drawDropImpact', '_drawDropMotionBlur']) {
    renderer[method] = () => assert.fail(`retired path ${method}`);
  }
  return { sim, renderer, strokes: () => strokes };
}

for (const silent of [false, true]) test(`Range compositor leaves cove drawing to the world through seek and silence (${silent})`, () => {
  const { sim, renderer, strokes } = fixture('range', 'performance', silent);
  try {
    sim.startAt(1100); renderer.draw(sim, 1);
    sim.startAt(30000); renderer.draw(sim, 1);
    sim.startAt(1100); renderer.draw(sim, 1);
    assert.equal(strokes(), 0, 'no detached trio outlines are painted after the world draw');
    assert.equal(renderer.lastRangePerformance, undefined);
    assert.equal(renderer.rangePerformanceDraws, undefined);
    assert.equal(renderer.inhabitedShoreDraws, 0);
    assert.equal(renderer._capture, null);
    assert.equal(sim.performer, undefined);
    assert.equal(sim.ensemble, undefined);
  } finally { sim.dispose(); renderer.dispose(); }
});

test('other worlds and scenery-only Range do not request a trio habitat', () => {
  for (const [world, experience] of [['fathom', 'performance'], ['farside', 'performance'], ['range', 'landscape']]) {
    const { sim, renderer } = fixture(world, experience);
    try {
      sim.startAt(1100); renderer.draw(sim, 1);
      assert.equal(sim.presentation.trioHabitat, false);
      assert.equal(renderer.lastRangePerformance, undefined);
    } finally { sim.dispose(); renderer.dispose(); }
  }
});

test('the frame delivers canonical trio sources at heard time, independently of terrain calibration', () => {
  const { sim, renderer } = fixture('range');
  try {
    sim.startAt(1100);
    const build = frameId => buildRangeFrame({ frameId, sim, pose: sim.lerpState(1) });
    const first = build(1);
    assert.equal(first.performance, true);
    assert.equal(first.actors, null, 'legacy world actor routes are suppressed');
    assert.deepEqual(first.habitatMusic, sim.biomes.ridgeMusicSession.sample(sim.heardTimeMs));
    assert.ok(first.habitatMusic.trioSources.broshi.activity > 0);
    assert.ok(Object.isFrozen(first.habitatMusic.trioSources));
    sim.startAt(30000);
    assert.equal(build(2).habitatMusic.trioSources.broshi.activity, 0, 'physical silence reaches the cove');
    sim.startAt(1100);
    assert.deepEqual(build(3).habitatMusic, first.habitatMusic, 'backward seek reads canonical history');
    sim.presentation = resolveLandscapePresentation({ kind: 'alpine' }, { rangeExperience: 'landscape' });
    assert.equal(build(4).habitatMusic, null);
  } finally { sim.dispose(); renderer.dispose(); }
});

test('RangeScene binds cove poses and music to world light and water, and clears them on exit', () => {
  const layout = { id: 'muncho-cove', band: 'mid', waterLevelM: 825,
    anchors: { midio: [-700, 825, -6220], broshi: [-520, 825.1, -6080], midasus: [-380, 890.15, -5940] },
    heights: { midio: 28, broshi: 35, midasus: 22 },
    ground: { midio: 825, broshi: 825.1, midasus: 832.15 },
    right: [-1, 0, 0], forward: [0, 0, 1] };
  const habitat = { group: {}, depthGroup: {}, bandDepthGroup: {}, update(pose) { this.snapshot = pose; } };
  const uniforms = sceneUniforms(THREE, {});
  const p = { habitat, habitatLayout: layout, uniforms };
  const scene = Object.assign(Object.create(RangeScene.prototype), { THREE, camera: new THREE.PerspectiveCamera() });
  const source = { source: 'role:BASS', activity: .9, pitchActivity: .7, pitch01: .4 };
  const frame = { performance: true, timeMs: 1100, actors: null, light: { night01: 1 },
    habitatMusic: { activity01: .9, motionPresence01: 1, bassPressure01: .8, rhythmAccent01: .7, kick01: .6,
      trioSources: { midio: source, broshi: source, midasus: source } } };
  const bind = f => { scene._setActors(p, f); scene._setHabitat(p, f); };
  bind(frame);
  assert.equal(habitat.snapshot.actors.length, 3);
  assert.equal(habitat.group.visible, true);
  assert.equal(habitat.depthGroup.visible, true);
  assert.equal(habitat.bandDepthGroup.visible, true);
  assert.ok(uniforms.uActorColor.value.every(c => c.length() > 0), 'the terrain receives local cove light');
  assert.ok(uniforms.uWakeAmt.value > 0, 'Midio has a music-driven physical wake');
  assert.deepEqual(uniforms.uWake.value.toArray().slice(0, 2), habitat.snapshot.actors[0].positionM.filter((_, i) => i !== 1));
  assert.deepEqual(uniforms.uCovePressure.value.toArray().slice(0, 2), [-520, -6080]);
  assert.ok(uniforms.uCovePressure.value.z > 0, 'bass pressure originates at Broshi’s shore');
  bind({ ...frame, reducedMotion: true });
  assert.equal(uniforms.uWakeAmt.value, 0);
  assert.equal(uniforms.uCovePressure.value.z, 0);
  bind({ ...frame, performance: false });
  assert.equal(habitat.snapshot, null);
  assert.equal(habitat.group.visible, false);
  assert.equal(habitat.depthGroup.visible, false);
  assert.equal(habitat.bandDepthGroup.visible, false);
  assert.ok(uniforms.uActorColor.value.every(c => c.length() === 0));
  assert.equal(uniforms.uWakeAmt.value, 0);
  assert.equal(uniforms.uCovePressure.value.z, 0);
});
