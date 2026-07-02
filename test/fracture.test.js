import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FractureEngine } from '../src/world/FractureEngine.js';
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

test('FractureEngine triangulates accumulated crack nodes into fragments', () => {
  const durationMs = 30000;
  const conductor = buildConductorWithKicks(durationMs);
  const fx = new FractureEngine(conductor, { canvasWidth: 800, canvasHeight: 600, songSeed: 7, durationMs });

  // Force a couple of cracks to exist without running the full song.
  fx._birthCrack(0, 0, null);
  fx._birthCrack(3, 1000, null);
  fx._triangulate();

  assert.ok(fx.fragments.count > 0, 'expected triangulation to produce fragments');
  for (const f of fx.fragments.active) {
    assert.equal(f.tri.length, 3);
    assert.ok(Number.isFinite(f.vx) && Number.isFinite(f.vy));
  }
});
