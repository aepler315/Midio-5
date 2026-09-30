import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/Simulation.js';
import { Conductor } from '../src/core/Conductor.js';
import { ParamBus } from '../src/core/ParamBus.js';
import { Role, makeNoteEvent } from '../src/core/NoteEvent.js';
import { buildRangeFrame } from '../src/world/alpine/RangeFrame.js';
import { Renderer } from '../src/render/Renderer.js';
import { PerfGovernor } from '../src/render/PerfGovernor.js';
import { compileRangeSources } from '../src/world/alpine/RangeNarrative.js';
import { NearField } from '../src/world/NearField.js';

function scene({ silent = false, rangeListening = false, worldId = 'range' } = {}) {
  const conductor = new Conductor();
  conductor.load({ durationMs: 60000, bpm: 120, confidence: .9, timeline: silent ? [] : [
    makeNoteEvent({ tMs: 100, pitch: 36, durMs: 60000, vel: 1, role: Role.RHYTHM, kick: true, src: 'midi' }),
    makeNoteEvent({ tMs: 100, pitch: 72, durMs: 60000, vel: 1, role: Role.BASS, lane: 'MIDIO', src: 'midi' }),
  ], barGrid: [] });
  const sim = new Simulation(conductor, new ParamBus(), { songSeed: 4, worldId, rangeListening });
  sim.perf = new PerfGovernor();
  // Graphics baking needs a browser canvas; world state updates stay real.
  sim.biomes.pumpStripPrewarm = () => {};
  return sim;
}

// Restoring any retired constructor, anticipation callback, or actor update
// must fail here, even if its painter later multiplies alpha by zero.
for (const options of [{}, { silent: true }, { rangeListening: true }, { worldId: 'overgrowth' }]) {
  test(`real scene owns no performers or actor subscriptions ${JSON.stringify(options)}`, () => {
    const s = scene(options);
    try {
      for (const at of [0, 200, 30000, 59900]) {
        s.step(16, at);
        for (const key of ['midio', 'broshi', 'midasus', 'performer', 'ensemble', 'excursions', 'focus', 'gaze', 'gnat', 'battle', 'obstacles', 'telegraph']) {
          assert.equal(s[key], undefined, `retired ownership: ${key} at ${at}`);
        }
        assert.equal(s.conductor.aheadRegs.length, 0);
        assert.equal(s.conductor.listeners.get('*')?.size || 0, 0);
        const f = buildRangeFrame({ frameId: 1, sim: s, pose: s.lerpState(.5) });
        assert.deepEqual(f.emitters, []);
        assert.equal(f.narrative, null);
      }
      s.startAt(30000);
      assert.equal(s.lerpState(1).originX, 220);
      assert.equal(s.biomes.openingGain, 1);
      s.onBeatTap(30100);
      assert.ok(s.beatAnchor._history.length > 0, 'tap synchronization remains functional');
    } finally { s.dispose(); }
    assert.ok([...s.conductor.listeners.values()].every(v => v.size === 0));
    assert.equal(s.conductor.barListeners.size, 0);
  });
}

test('fallback and export frame construction ignores stale actor objects and reveal handoff', () => {
  const s = scene();
  try {
    s.step(0, 30000);
    const expected = buildRangeFrame({ frameId: 1, sim: s, pose: s.lerpState(1) });
    s.midio = { groundY: 625 };
    s.rangeNarrativeAt = () => ({ sources: { midio: { pitchActivity: 0, pitch01: .5 }, broshi: { activity: 0 } }, handoff: { midio: 0, broshi: 0, midasus: 0 }, cast: { midio: 1 } });
    const actual = buildRangeFrame({ frameId: 1, sim: s, pose: s.lerpState(1) });
    assert.deepEqual(actual.emitters, []);
    assert.deepEqual(actual.music, expected.music);
    assert.equal(actual.narrative, null);
  } finally { s.dispose(); }
});

test('decorative ownership is absent, natural roots and rocks remain', () => {
  const s = scene();
  try {
    assert.equal(s.biomes.farVignettes, undefined);
    assert.equal(s.biomes.murmuration, undefined);
    assert.deepEqual(s.biomes._ships, []);
    assert.deepEqual(s.biomes._seaLife, []);
    assert.deepEqual(s.biomes._monsters, []);
    s.biomes._drawMassifMarkers({}, 60000, 0, 500, 0, 300);
    assert.deepEqual(s.biomes._massifMarkers, []);
    for (const kind of ['alpine', 'overgrowth', 'abyssal']) {
      const field = new NearField(3, { kind });
      assert.ok(Array.from({ length: 100 }, (_, i) => field._sector(i, 'JADE')).some(Boolean), `${kind} natural dressing preserved`);
    }
    for (const kind of ['city', 'strip', 'foundry', 'nave']) {
      const field = new NearField(3, { kind });
      assert.ok(Array.from({ length: 100 }, (_, i) => field._sector(i, 'JADE')).every(d => !d), `${kind} artificial near props removed`);
    }
  } finally { s.dispose(); }
});

test('retired captures are disposed without body callbacks or new graphics allocation', () => {
  const renderer = Object.create(Renderer.prototype);
  let disposed = 0;
  renderer._capture = { dispose() { disposed++; }, capture() { assert.fail('actor captured'); } };
  const result = renderer._captureCastForReflections({}, {}, {}, { _rangeV2Active: true }, {}, {});
  assert.deepEqual(result, { broshi: null, midio: null, midasus: null });
  assert.equal(disposed, 1);
  assert.equal(renderer._capture, null);
});

test('independent bass lane drives mountain pressure immediately without reveal weights', () => {
  const s = scene({ silent: true });
  try {
    s.step(0, 200);
    const before = buildRangeFrame({ frameId: 1, sim: s, pose: s.lerpState(1) });
    s.worldSources = compileRangeSources({ timeline: [
      { tMs: 100, durMs: 1000, vel: 1, role: 'MELODY', lane: 'BROSHI', src: 'midi', pitch: 36 },
    ], casting: { broshi: 'bass-lane' } });
    const active = buildRangeFrame({ frameId: 2, sim: s, pose: s.lerpState(1) });
    assert.ok(active.music.amplitudeM > before.music.amplitudeM, 'world pressure keeps the independent bass evidence');
    assert.equal(active.music.melodicM, 0, 'a bass lane does not become a fabricated lead voice');
  } finally { s.dispose(); }
});

// Canvas is a native browser boundary. Record its painting commands while
// exercising the real shared Renderer and BiomeManager drawing graph.
function recordingCanvas() {
  const calls = [];
  const canvas = { width: 1280, height: 720 };
  const target = { canvas, globalAlpha: 1,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 0 }),
    getLineDash: () => [],
  };
  const ctx = new Proxy(target, { get(obj, key) {
    if (key in obj) return obj[key];
    return (...args) => { calls.push([key, ...args]); };
  } });
  canvas.getContext = () => ctx;
  return { canvas, calls };
}

for (const fallback of [false, true]) {
  test(`real renderer paints opening, seek, restart and export without touching actors (fallback=${fallback})`, () => {
    const previousDocument = globalThis.document;
    const previousPath2D = globalThis.Path2D;
    const previousOffscreen = globalThis.OffscreenCanvas;
    globalThis.Path2D = class { constructor() { return new Proxy({}, { get: () => () => {} }); } };
    globalThis.OffscreenCanvas = class { constructor(width, height) {
      const { canvas } = recordingCanvas(); canvas.width = width; canvas.height = height; return canvas;
    } };
    globalThis.document = { createElement: () => recordingCanvas().canvas };
    const s = scene();
    const { canvas, calls } = recordingCanvas();
    const renderer = new Renderer(canvas);
    s.perf.level = 6;
    s.highlightReel = null; // thumbnails need a browser-native offscreen canvas
    const mgr = s.biomes;
    if (fallback) s.biomes = null;
    for (const key of ['midio', 'broshi', 'midasus', 'performer', 'ensemble', 'focus', 'gaze', 'gnat', 'battle', 'obstacles', 'telegraph']) {
      Object.defineProperty(s, key, { get() { return assert.fail(`renderer accessed retired ${key}`); } });
    }
    try {
      for (const timeMs of [0, 200, 30000, 59900, 30000, 0]) {
        s.biomes = mgr;
        s.startAt(timeMs);
        if (fallback) s.biomes = null;
        renderer.draw(s, 1);
      }
      assert.equal(renderer.drawCount, 6);
      assert.ok(calls.some(c => c[0] === 'fillRect'), 'world/fallback paints a composed frame');
      assert.equal(renderer._capture, null);
      assert.equal(renderer.brush, undefined);
    } finally { renderer.dispose(); s.biomes = mgr; s.dispose();
      if (previousDocument) globalThis.document = previousDocument; else delete globalThis.document;
      if (previousPath2D) globalThis.Path2D = previousPath2D; else delete globalThis.Path2D;
      if (previousOffscreen) globalThis.OffscreenCanvas = previousOffscreen; else delete globalThis.OffscreenCanvas;
    }
  });
}
