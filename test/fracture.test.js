import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FractureEngine,
  buildMountainRidgePolylines,
  polylineFromPoints,
  shatterFadeAlpha,
  shatterMotionU,
} from '../src/world/FractureEngine.js';
import { Conductor } from '../src/core/Conductor.js';
import { makeNoteEvent, Role } from '../src/core/NoteEvent.js';

function buildConductorWithKicks(durationMs, kickPeriodMs = 500) {
  const timeline = [];
  for (let t = 0; t < durationMs; t += kickPeriodMs) {
    timeline.push(makeNoteEvent({ tMs: t, pitch: 36, vel: 0.8, role: Role.RHYTHM, kick: true, src: 'audio' }));
  }
  const barGrid = [];
  for (let t = 0; t < durationMs; t += kickPeriodMs * 4) barGrid.push({ tick: 0, ms: t, numerator: 4, denominator: 4 });
  const conductor = new Conductor();
  conductor.load({ timeline, barGrid, durationMs });
  return conductor;
}

test('polylineFromPoints accumulates segment lengths', () => {
  const p = polylineFromPoints([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 4 + 5 }]);
  assert.equal(p.nodes.length, 3);
  assert.equal(p.lengths.length, 2);
  assert.ok(Math.abs(p.lengths[0] - 5) < 1e-9);
  assert.ok(Math.abs(p.lengths[1] - 5) < 1e-9);
  assert.ok(Math.abs(p.total - 10) < 1e-9);
});

test('buildMountainRidgePolylines: deterministic, count, and peak-like silhouette', () => {
  const w = 1280, h = 720;
  const a = buildMountainRidgePolylines(w, h, 42, 8);
  const b = buildMountainRidgePolylines(w, h, 42, 8);
  const c = buildMountainRidgePolylines(w, h, 99, 8);
  assert.equal(a.length, 8);
  assert.deepEqual(a, b, 'same seed reproduces the ridge plan');
  assert.notDeepEqual(a, c, 'different seeds diverge');

  // Every polyline has real length and stays on/near the canvas.
  for (const poly of a) {
    assert.ok(poly.nodes.length >= 2);
    assert.ok(poly.total > 20, 'ridge must have real length');
    for (const n of poly.nodes) {
      assert.ok(n.x > -w * 0.1 && n.x < w * 1.1);
      assert.ok(n.y > -h * 0.05 && n.y < h * 1.05);
    }
  }

  // The massif should reach high on the frame (small y) and rest lower (large y).
  const allY = a.flatMap((p) => p.nodes.map((n) => n.y));
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  assert.ok(minY < h * 0.35, `peaks should crest high on the frame, minY=${minY}`);
  assert.ok(maxY > h * 0.55, `foothills should sit lower on the frame, maxY=${maxY}`);
});

test('shatterFadeAlpha / shatterMotionU are smooth hold-then-ease envelopes', () => {
  assert.equal(shatterFadeAlpha(0), 1);
  assert.equal(shatterFadeAlpha(400), 1);
  assert.ok(shatterFadeAlpha(900) < 1 && shatterFadeAlpha(900) > 0);
  assert.ok(shatterFadeAlpha(2000) <= 1e-9);

  assert.equal(shatterMotionU(0), 0);
  assert.equal(shatterMotionU(50), 0); // still in freeze hold
  assert.ok(shatterMotionU(200) > 0 && shatterMotionU(200) < 1);
  assert.ok(shatterMotionU(800) >= 0.99);
});

test('FractureEngine births cracks as the stress accumulator crosses thresholds over a song', () => {
  const durationMs = 60000;
  const conductor = buildConductorWithKicks(durationMs);
  const fx = new FractureEngine(conductor, { canvasWidth: 1280, canvasHeight: 720, songSeed: 42, durationMs });

  const dtMs = 1000 / 120;
  const fakeEnergy = { globalEnergy: () => 0.6 };
  for (let t = 0; t < durationMs - 1000; t += dtMs) {
    conductor.dispatchUpTo(t);
    fx.update(t, dtMs / 1000, fakeEnergy, null);
  }

  assert.ok(fx.cracks.length > 0, 'expected at least one crack to have been born');
  assert.ok(fx.stress > 0.15);
  // Ridge plan is precomputed and cracks walk it.
  assert.equal(fx._ridgePlan.length, 8);
  for (const crack of fx.cracks) {
    assert.ok(crack.nodes.length >= 2);
    assert.ok(crack.total > 0);
  }
});

test('FractureEngine transitions to about-to-freeze 300ms before the song ends', () => {
  const durationMs = 5000;
  const conductor = buildConductorWithKicks(durationMs);
  const fx = new FractureEngine(conductor, { canvasWidth: 1280, canvasHeight: 720, songSeed: 1, durationMs });

  const dtMs = 1000 / 120;
  let flippedAt = null;
  for (let t = 0; t < durationMs; t += dtMs) {
    conductor.dispatchUpTo(t);
    fx.update(t, dtMs / 1000, null, null);
    if (fx.isAboutToFreeze && flippedAt === null) flippedAt = t;
  }
  assert.ok(flippedAt !== null, 'expected shatterState to reach about-to-freeze');
  assert.ok(Math.abs(flippedAt - (durationMs - 300)) < 50);
});

test('FractureEngine triangulates accumulated crack nodes into fragments with stagger', () => {
  const durationMs = 30000;
  const conductor = buildConductorWithKicks(durationMs);
  const fx = new FractureEngine(conductor, { canvasWidth: 800, canvasHeight: 600, songSeed: 7, durationMs });

  fx._birthCrack(0, 0, null);
  fx._birthCrack(3, 1000, null);
  fx._triangulate();

  assert.ok(fx.fragments.count > 0, 'expected triangulation to produce fragments');
  for (const f of fx.fragments.active) {
    assert.equal(f.tri.length, 3);
    assert.ok(Number.isFinite(f.vx0) && Number.isFinite(f.vy0));
    assert.ok(f.startDelayMs >= 0);
  }
});

test('shatter update eases fragments then settles to done without a hard pop', () => {
  const durationMs = 10000;
  const conductor = buildConductorWithKicks(durationMs);
  const fx = new FractureEngine(conductor, { canvasWidth: 640, canvasHeight: 360, songSeed: 3, durationMs });
  fx._birthCrack(0, 0, null);
  fx.freezeMs = 0;
  fx.shatterState = 'frozen';
  fx._triangulate();
  fx._lastNowMs = 0;

  // During freeze hold, shards stay put.
  fx.update(40, 0.04, null, null);
  const sample = fx.fragments.active[0];
  const x0 = sample.x, y0 = sample.y;

  fx.update(80, 0.04, null, null);
  assert.ok(Math.abs(sample.x - x0) < 2 && Math.abs(sample.y - y0) < 2, 'hold should keep shards nearly still');

  // Later they drift and eventually complete.
  for (let t = 100; t < 1700; t += 16) {
    fx._lastNowMs = t;
    fx.update(t, 0.016, null, null);
  }
  assert.equal(fx.shatterState, 'done');
  assert.equal(fx.fragments.count, 0);
});
