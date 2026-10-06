import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLandscapePresentation, resolveRangeExperience, rangePerformanceViewId } from '../src/world/LandscapePresentation.js';
import { Simulation } from '../src/sim/Simulation.js';
import { Conductor } from '../src/core/Conductor.js';
import { ParamBus } from '../src/core/ParamBus.js';
import { Renderer } from '../src/render/Renderer.js';

test('Range owns a passive trio stage without enabling retired performer effects', () => {
  assert.equal(resolveLandscapePresentation({ kind: 'alpine' }).trioStage, true);
  assert.equal(resolveLandscapePresentation({ kind: 'alpine' }).performers, false);
  assert.equal(resolveLandscapePresentation({ kind: 'alpine' }).inhabitants, false);
  assert.equal(resolveLandscapePresentation({ kind: 'alpine' }, { rangeExperience: 'landscape' }).trioStage, false);
  for (const kind of ['abyssal', 'farside', 'nave', 'city']) {
    assert.equal(resolveLandscapePresentation({ kind }).trioStage, false);
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

for (const silent of [false, true]) test(`actual Range compositor retains the stage through seek and silence (${silent})`, () => {
  const { sim, renderer, strokes } = fixture('range', 'performance', silent);
  try {
    sim.startAt(1100); renderer.draw(sim, 1);
    const first = renderer.lastRangePerformance;
    assert.ok(first, 'the actual scene must emit a performance frame');
    assert.ok(strokes() > 50, 'the trio meshes must reach the main canvas');
    sim.startAt(30000); renderer.draw(sim, 1);
    sim.startAt(1100); renderer.draw(sim, 1);
    assert.deepEqual(renderer.lastRangePerformance, first, 'seek reconstructs the same stage');
    assert.equal(renderer.rangePerformanceDraws, 3);
    assert.equal(renderer.inhabitedShoreDraws, 0);
    assert.equal(renderer._capture, null);
    assert.equal(sim.performer, undefined);
    assert.equal(sim.ensemble, undefined);
  } finally { sim.dispose(); renderer.dispose(); }
});

test('other worlds and scenery-only Range do not receive the performance layer', () => {
  for (const [world, experience] of [['fathom', 'performance'], ['farside', 'performance'], ['range', 'landscape']]) {
    const { sim, renderer } = fixture(world, experience);
    try {
      sim.startAt(1100); renderer.draw(sim, 1);
      assert.equal(renderer.lastRangePerformance, null);
      assert.equal(renderer.rangePerformanceDraws, 0);
    } finally { sim.dispose(); renderer.dispose(); }
  }
});
