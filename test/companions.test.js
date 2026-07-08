import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Midasus } from '../src/sim/Midasus.js';
import { Broshi } from '../src/sim/Broshi.js';
import { Conductor } from '../src/core/Conductor.js';
import { ParamBus } from '../src/core/ParamBus.js';
import { makeNoteEvent, Role } from '../src/core/NoteEvent.js';

function stepFor(fn, totalMs, dtMs = 1000 / 120) {
  for (let t = 0; t < totalMs; t += dtMs) fn(t, dtMs / 1000);
}

test('Midasus consumes melody notes in strict order, never skipping', () => {
  const timeline = [];
  for (let i = 0; i < 20; i++) {
    timeline.push(makeNoteEvent({ tMs: i * 100, pitch: 60 + (i % 7), vel: 0.6, role: Role.MELODY, src: 'midi' }));
  }
  const midio = { screenX: 200, groundY: 480, y: 0 };
  const m = new Midasus(timeline, midio, { groundY: 480, ceilingY: 40 });
  stepFor((t, dt) => m.update(t, dt), 2100);
  assert.equal(m.i, timeline.length); // every note consumed
});

test('Midasus handles a burst of several notes landing in a single sim step', () => {
  const timeline = [
    makeNoteEvent({ tMs: 10, pitch: 60, vel: 0.5, role: Role.MELODY, src: 'midi' }),
    makeNoteEvent({ tMs: 11, pitch: 64, vel: 0.5, role: Role.MELODY, src: 'midi' }),
    makeNoteEvent({ tMs: 12, pitch: 67, vel: 0.5, role: Role.MELODY, src: 'midi' }),
  ];
  const midio = { screenX: 200, groundY: 480, y: 0 };
  const m = new Midasus(timeline, midio, { groundY: 480, ceilingY: 40 });
  m.update(20, 1000 / 120 / 1000); // single step past all three onsets
  assert.equal(m.i, 3);
});

test('Midasus falls into orbital wander after 800ms of silence', () => {
  const timeline = [makeNoteEvent({ tMs: 0, pitch: 60, vel: 0.5, role: Role.MELODY, src: 'midi' })];
  const midio = { screenX: 200, groundY: 480, y: 0 };
  const m = new Midasus(timeline, midio, { groundY: 480, ceilingY: 40 });
  stepFor((t, dt) => m.update(t, dt), 200);
  assert.ok(m.rest < 0.5);
  stepFor((t, dt) => m.update(200 + t, dt), 1200);
  assert.ok(m.rest > 0.9);
});

test('Broshi trails behind Midio by default (TRAIL setpoint)', () => {
  const conductor = new Conductor();
  conductor.load({ timeline: [], barGrid: [], durationMs: 10000 });
  const paramBus = new ParamBus();
  const b = new Broshi(conductor, paramBus);
  const midio = { screenX: 200, groundY: 480, y: 0 };
  stepFor((t, dt) => b.update(t, dt, midio, null, null, 0, 480), 5000);
  assert.ok(b.xRel < -100 && b.xRel > -180); // settled near d*=-140
});

test('Broshi SURGEs on the scripted 8-bar timer', () => {
  const conductor = new Conductor();
  const barGrid = [];
  const barMs = 500;
  for (let i = 0; i < 12; i++) barGrid.push({ tick: i * 4, ms: i * barMs, numerator: 4, denominator: 4 });
  conductor.load({ timeline: [], barGrid, durationMs: 12 * barMs });
  const paramBus = new ParamBus();
  const b = new Broshi(conductor, paramBus);
  b._lastBarPeriodMs = barMs;
  const midio = { screenX: 200, groundY: 480, y: 0 };

  let sawSurge = false;
  const dtMs = 1000 / 120;
  for (let t = 0; t < 12 * barMs; t += dtMs) {
    conductor.dispatchUpTo(t);
    b.update(t, dtMs / 1000, midio, null, null, 0, 480);
    if (b.state === 'SURGE') sawSurge = true;
  }
  assert.equal(sawSurge, true);
});

test('Broshi PANICs when an obstacle is inside the 300ms lookahead', () => {
  const conductor = new Conductor();
  conductor.load({ timeline: [], barGrid: [], durationMs: 10000 });
  const paramBus = new ParamBus();
  const b = new Broshi(conductor, paramBus);
  const midio = { screenX: 200, groundY: 480, y: 0 };
  const fakeObstacles = { nearestAhead: () => ({ tMs: 1150, wx: 500 }) };
  b.update(1000, 1 / 120, midio, null, fakeObstacles, 0, 480);
  assert.equal(b.state, 'PANIC');
});
