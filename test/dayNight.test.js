import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleMs, dayNight, celestialYFracFor, horizonFade } from '../src/world/DayNight.js';
import { OCEAN_HORIZON_FRAC } from '../src/world/Ocean.js';

test('cycleMs guarantees at least two full cycles for songs long enough to hold them, and never exceeds the song itself', () => {
  for (const durationMs of [180000, 240000, 600000, 3600000]) {
    const c = cycleMs(durationMs);
    assert.ok(c >= 60000 - 1e-6 && c <= 120000 + 1e-6, `cycle out of range for ${durationMs}: ${c}`);
    assert.ok(durationMs / c >= 2 - 1e-6, `must fit at least two cycles for ${durationMs}: ${durationMs / c}`);
  }
  // Short songs (under two minutes) can't fit two 60s+ cycles -- they get
  // one cycle sized to the song, never longer than the song itself.
  for (const durationMs of [1000, 30000, 90000]) {
    const c = cycleMs(durationMs);
    assert.ok(c > 0 && c <= durationMs, `cycle must fit within a short song: ${c} vs ${durationMs}`);
  }
});

test('dayNight: altitudes are bounded, finite, and periodic', () => {
  const cycle = 90000;
  for (let t = -50000; t < 200000; t += 3333) {
    const { sunAlt, moonAlt, night, dawnAlpha, duskAlpha } = dayNight(t, cycle);
    for (const v of [sunAlt, moonAlt, night, dawnAlpha, duskAlpha]) {
      assert.ok(Number.isFinite(v), `non-finite at t=${t}`);
      assert.ok(v >= 0 && v <= 1, `out of [0,1] at t=${t}: ${v}`);
    }
  }
  const a = dayNight(12345, 90000);
  const b = dayNight(12345 + 90000, 90000);
  assert.deepEqual(a, b, 'must be exactly periodic in the cycle length');
});

test('dayNight: sun and moon are never both up, and each is 0 at the other\'s zenith', () => {
  const cycle = 100000;
  for (let t = 0; t < cycle; t += 500) {
    const { sunAlt, moonAlt } = dayNight(t, cycle);
    assert.ok(sunAlt <= 1e-9 || moonAlt <= 1e-9, `both up at t=${t}: sun=${sunAlt} moon=${moonAlt}`);
  }
  const sunZenith = dayNight(cycle * 0.25, cycle);
  assert.ok(sunZenith.sunAlt > 0.99);
  assert.ok(sunZenith.moonAlt < 1e-6);
  const moonZenith = dayNight(cycle * 0.75, cycle);
  assert.ok(moonZenith.moonAlt > 0.99);
  assert.ok(moonZenith.sunAlt < 1e-6);
});

test('dayNight: night is ~0 at sun zenith and ~1 at moon zenith', () => {
  const cycle = 100000;
  assert.ok(dayNight(cycle * 0.25, cycle).night < 0.02);
  assert.ok(dayNight(cycle * 0.75, cycle).night > 0.98);
});

test('celestialYFracFor rises from the ocean horizon toward zenith as altitude increases', () => {
  const horizonY = celestialYFracFor(0);
  const zenithY = celestialYFracFor(1);
  assert.ok(Math.abs(horizonY - OCEAN_HORIZON_FRAC) < 1e-9, 'alt=0 must sit exactly on the sea horizon');
  assert.ok(zenithY < horizonY, 'zenith must be higher on screen (smaller yFrac) than the horizon');
  let prev = horizonY;
  for (let alt = 0; alt <= 1; alt += 0.1) {
    const y = celestialYFracFor(alt);
    assert.ok(y <= prev + 1e-9, 'yFrac must decrease (rise) monotonically with altitude');
    prev = y;
  }
});

test('horizonFade eases a body in/out near the horizon and is fully visible above its band', () => {
  assert.equal(horizonFade(0), 0);
  assert.equal(horizonFade(1), 1);
  assert.ok(horizonFade(0.04) > 0 && horizonFade(0.04) < 1);
  assert.equal(horizonFade(0.5), 1, 'fully faded in well above the horizon band');
});
