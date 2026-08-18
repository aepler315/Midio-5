import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/utils/math.js';
import { buildDisasterSchedule, DisasterDirector } from '../src/sim/DisasterDirector.js';
import { QuakeDirector } from '../src/sim/QuakeDirector.js';

test('buildDisasterSchedule: too short a song gets no disasters at all', () => {
  const rand = mulberry32(1);
  assert.deepEqual(buildDisasterSchedule(rand, 10000, []), []);
});

test('buildDisasterSchedule: a long song without hotspots still gets a scheduled quake', () => {
  const rand = mulberry32(2);
  const sched = buildDisasterSchedule(rand, 180000, []);
  assert.equal(sched.length, 1);
  assert.equal(sched[0].kind, 'quake');
  assert.ok(sched[0].tMs > 0 && sched[0].tMs < 180000);
});

test('buildDisasterSchedule: anchors near a supplied hotspot, not at a fixed fraction', () => {
  const rand = mulberry32(3);
  const hotspot = 90000;
  const sched = buildDisasterSchedule(rand, 180000, [hotspot]);
  assert.ok(Math.abs(sched[0].tMs - hotspot) <= 6000, `expected near ${hotspot}, got ${sched[0].tMs}`);
});

test('DisasterDirector: never fires before its own scheduled time', () => {
  const d = new DisasterDirector(9, 180000, [90000]);
  const quake = new QuakeDirector(9);
  d.update(0, 0, { quake });
  assert.equal(d.justStruck, false);
  assert.equal(quake.active, false);
});

test('DisasterDirector: fires exactly once at its scheduled time, and strikes the quake', () => {
  const d = new DisasterDirector(9, 180000, [90000]);
  const quake = new QuakeDirector(9);
  const strikeMs = d._schedule[0].tMs;
  d.update(strikeMs, 500, { quake });
  assert.equal(d.justStruck, true);
  assert.equal(d.struckKind, 'quake');
  // A second update at the same instant must not re-fire.
  d.update(strikeMs, 500, { quake });
  assert.equal(d.justStruck, false);
});

test('DisasterDirector: exclusivity -- reports activeKind while the quake is still live', () => {
  const d = new DisasterDirector(9, 180000, [90000]);
  const quake = new QuakeDirector(9);
  const strikeMs = d._schedule[0].tMs;
  d.update(strikeMs, 0, { quake });
  quake.update(strikeMs, 0.016, null);
  d.update(strikeMs + 16, 0, { quake });
  assert.equal(d.activeKind, 'quake');
});

test('DisasterDirector: never exceeds its own schedule length even run for a very long time', () => {
  const d = new DisasterDirector(9, 180000, [90000]);
  const quake = new QuakeDirector(9);
  let t = 0;
  let fires = 0;
  for (let i = 0; i < 20000; i++) {
    t += 100;
    d.update(t, 0, { quake });
    quake.update(t, 0.1, null);
    if (d.justStruck) fires++;
  }
  assert.equal(fires, d._schedule.length);
});
