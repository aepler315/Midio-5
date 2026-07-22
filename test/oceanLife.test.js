import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrappedOffset, islands, ships, seaLifeSchedule, monsterSchedule,
  tsunamiSchedule, tsunamiX, tsunamiLift, tsunamiProfile, fishArcY, serpentHumpY,
  OCEAN_LIFE_WRAP_PX, TSUNAMI_WIDTH_PX, TSUNAMI_SWEEP_MS,
} from '../src/world/OceanLife.js';

test('wrappedOffset stays within (-wrap/2, wrap/2] and matches unwrapped difference near zero', () => {
  for (let x0 = 0; x0 < OCEAN_LIFE_WRAP_PX; x0 += 777) {
    for (let scroll = -20000; scroll <= 20000; scroll += 3333) {
      const d = wrappedOffset(x0, scroll, OCEAN_LIFE_WRAP_PX);
      assert.ok(d > -OCEAN_LIFE_WRAP_PX / 2 - 1e-6 && d <= OCEAN_LIFE_WRAP_PX / 2 + 1e-6, `out of range: ${d}`);
    }
  }
  assert.ok(Math.abs(wrappedOffset(100, 90) - 10) < 1e-9);
});

test('islands/ships are deterministic per seed, differ across seeds, and respect field ranges', () => {
  const a = islands(11, 4), b = islands(11, 4), c = islands(99, 4);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a.length, 4);
  for (const isl of a) {
    assert.ok(isl.rowFrac >= 0 && isl.rowFrac <= 1);
    assert.ok(isl.w > 0 && isl.h > 0);
    assert.ok(['cone', 'mesa', 'palm'].includes(isl.kind));
  }
  const sa = ships(5, 3), sb = ships(5, 3);
  assert.deepEqual(sa, sb);
  assert.equal(sa.length, 3);
  for (const s of sa) {
    assert.ok(s.rowFrac >= 0 && s.rowFrac <= 1);
    assert.ok(s.driftPxS !== 0);
    assert.ok(s.size > 0);
  }
});

test('seaLifeSchedule is sorted, deterministic, and spaced within [minGap, maxGap]', () => {
  const durationMs = 180000;
  const a = seaLifeSchedule(7, durationMs);
  const b = seaLifeSchedule(7, durationMs);
  assert.deepEqual(a, b);
  for (let i = 1; i < a.length; i++) {
    assert.ok(a[i].tMs > a[i - 1].tMs, 'events must be sorted');
    const gap = a[i].tMs - a[i - 1].tMs;
    assert.ok(gap >= 8000 - 1e-6 && gap <= 20000 + 1e-6, `gap out of range: ${gap}`);
  }
  for (const ev of a) {
    assert.ok(['fish', 'pod', 'spout'].includes(ev.kind));
    assert.ok(ev.tMs >= 0 && ev.tMs < durationMs);
    assert.ok(ev.u >= 0 && ev.u <= 1);
  }
});

test('monsterSchedule keeps events clear of the margins and enforces the min gap', () => {
  const durationMs = 240000;
  const evs = monsterSchedule(3, durationMs, { marginMs: 20000, minGapMs: 45000 });
  assert.ok(evs.length >= 1 && evs.length <= 2);
  for (const e of evs) {
    assert.ok(e.tMs >= 20000 && e.tMs <= durationMs - 20000);
  }
  for (let i = 1; i < evs.length; i++) assert.ok(evs[i].tMs - evs[i - 1].tMs >= 45000 - 1e-6);
  // A very short song shouldn't force an impossible schedule.
  assert.doesNotThrow(() => monsterSchedule(3, 10000));
});

test('tsunamiSchedule anchors near supplied hotspots and stays sorted/deterministic', () => {
  const durationMs = 200000;
  const hotspots = [50000, 150000];
  const evs = tsunamiSchedule(1, durationMs, hotspots);
  assert.equal(evs.length, 2);
  for (let i = 0; i < evs.length; i++) {
    assert.ok(Math.abs(evs[i].tMs - hotspots[i]) <= 4000 + 1e-6, `tsunami not anchored near hotspot: ${evs[i].tMs} vs ${hotspots[i]}`);
  }
  for (let i = 1; i < evs.length; i++) assert.ok(evs[i].tMs >= evs[i - 1].tMs);
  const again = tsunamiSchedule(1, durationMs, hotspots);
  assert.deepEqual(evs, again);
  // Fallback with no hotspots still produces 1-2 events.
  const fallback = tsunamiSchedule(1, durationMs, []);
  assert.ok(fallback.length >= 1 && fallback.length <= 2);
});

test('tsunamiX sweeps monotonically across the screen and returns null outside its window', () => {
  const ev = { tMs: 10000, dir: 1 };
  const w = 1280;
  assert.equal(tsunamiX(ev, ev.tMs - TSUNAMI_SWEEP_MS, w), null);
  assert.equal(tsunamiX(ev, ev.tMs + TSUNAMI_SWEEP_MS, w), null);
  let prev = -Infinity;
  for (let dt = -TSUNAMI_SWEEP_MS / 2; dt <= TSUNAMI_SWEEP_MS / 2; dt += 200) {
    const x = tsunamiX(ev, ev.tMs + dt, w);
    assert.ok(Number.isFinite(x));
    assert.ok(x >= prev, 'dir=1 must sweep monotonically rightward');
    prev = x;
  }
  const back = { tMs: 5000, dir: -1 };
  let prevB = Infinity;
  for (let dt = -TSUNAMI_SWEEP_MS / 2; dt <= TSUNAMI_SWEEP_MS / 2; dt += 200) {
    const x = tsunamiX(back, back.tMs + dt, w);
    assert.ok(x <= prevB, 'dir=-1 must sweep monotonically leftward');
    prevB = x;
  }
});

test('tsunamiLift is bounded, peaks at the wall, and reaches zero beyond its width', () => {
  assert.equal(tsunamiLift(0), 1);
  assert.ok(tsunamiLift(TSUNAMI_WIDTH_PX / 2) < 1 && tsunamiLift(TSUNAMI_WIDTH_PX / 2) > 0);
  assert.equal(tsunamiLift(TSUNAMI_WIDTH_PX), 0);
  assert.equal(tsunamiLift(TSUNAMI_WIDTH_PX * 5), 0);
  assert.equal(tsunamiLift(-50), tsunamiLift(50));
});

test('tsunamiProfile and shape helpers stay bounded and finite', () => {
  for (let s = -1; s <= 1; s += 0.1) {
    const p = tsunamiProfile(s);
    assert.ok(Number.isFinite(p) && p >= 0 && p <= 1, `profile out of bounds at s=${s}: ${p}`);
  }
  for (let u = 0; u <= 1; u += 0.1) {
    const y = fishArcY(u);
    assert.ok(Number.isFinite(y) && y >= -1e-9);
  }
  assert.ok(Math.abs(fishArcY(0)) < 1e-6 && Math.abs(fishArcY(1)) < 1e-6, 'the leap starts and lands at the water line');
  for (let u = 0; u <= 1; u += 0.1) {
    const y = serpentHumpY(u, 1.3);
    assert.ok(Number.isFinite(y) && Math.abs(y) <= 10 + 1e-9);
  }
});
