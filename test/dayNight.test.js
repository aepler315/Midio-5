import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cycleMs, dayNight, celestialYFracFor, horizonFade,
  celestialXFracFor, sunScreenFrac, cyclePhase01,
  CELESTIAL_RISE_XFRAC, CELESTIAL_SET_XFRAC,
} from '../src/world/DayNight.js';
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

test('celestialXFracFor carries a body from the rise edge to the set edge, monotonically', () => {
  assert.ok(Math.abs(celestialXFracFor(0) - CELESTIAL_RISE_XFRAC) < 1e-9, 'az=0 is the rising horizon');
  assert.ok(Math.abs(celestialXFracFor(1) - CELESTIAL_SET_XFRAC) < 1e-9, 'az=1 is the setting horizon');
  assert.ok(CELESTIAL_SET_XFRAC < CELESTIAL_RISE_XFRAC, 'bodies rise ahead (right) and set behind (left)');
  let prev = celestialXFracFor(0);
  for (let u = 0; u <= 1; u += 0.05) {
    const x = celestialXFracFor(u);
    assert.ok(x <= prev + 1e-9, `must travel one way only, broke at ${u}`);
    assert.ok(x >= CELESTIAL_SET_XFRAC - 1e-9 && x <= CELESTIAL_RISE_XFRAC + 1e-9, 'stays between the horizons');
    prev = x;
  }
  // Out-of-range input is clamped, not extrapolated off-screen.
  assert.ok(Math.abs(celestialXFracFor(-3) - CELESTIAL_RISE_XFRAC) < 1e-9);
  assert.ok(Math.abs(celestialXFracFor(9) - CELESTIAL_SET_XFRAC) < 1e-9);
});

test('dayNight: each body\'s azimuth runs 0->1 across its own arc and holds at the horizon it left', () => {
  const cycle = 80000;
  for (let t = 0; t < cycle; t += 250) {
    const { sunAz01, moonAz01 } = dayNight(t, cycle);
    for (const v of [sunAz01, moonAz01]) {
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `azimuth out of [0,1] at t=${t}: ${v}`);
    }
  }
  // Sun owns the first half: 0 at its rise, 1 by its set, then parked.
  assert.ok(Math.abs(dayNight(0, cycle).sunAz01 - 0) < 1e-9);
  assert.ok(Math.abs(dayNight(cycle * 0.25, cycle).sunAz01 - 0.5) < 1e-9);
  assert.ok(Math.abs(dayNight(cycle * 0.75, cycle).sunAz01 - 1) < 1e-9, 'sun stays set through the night');
  // Moon owns the second: parked at its rise edge all day, then crosses.
  assert.ok(Math.abs(dayNight(cycle * 0.25, cycle).moonAz01 - 0) < 1e-9, 'moon waits at its rise edge');
  assert.ok(Math.abs(dayNight(cycle * 0.75, cycle).moonAz01 - 0.5) < 1e-9);
});

test('dayNight: altitude and azimuth stay in step, so a body climbs as it crosses', () => {
  const cycle = 90000;
  // Each body is highest exactly halfway across its own arc.
  const sunPeak = dayNight(cycle * 0.25, cycle);
  assert.ok(sunPeak.sunAlt > 0.999 && Math.abs(sunPeak.sunAz01 - 0.5) < 1e-9);
  const moonPeak = dayNight(cycle * 0.75, cycle);
  assert.ok(moonPeak.moonAlt > 0.999 && Math.abs(moonPeak.moonAz01 - 0.5) < 1e-9);
  // ...and on the horizon at both ends of it.
  assert.ok(dayNight(0, cycle).sunAlt < 1e-9);
  assert.ok(dayNight(cycle * 0.5 - 1, cycle).sunAlt < 0.01);
});

test('sunScreenFrac: the sun keeps going below the horizon all night', () => {
  const horizon = OCEAN_HORIZON_FRAC;
  assert.ok(sunScreenFrac(0.25).yFrac < horizon, 'above the horizon at midday');
  assert.ok(sunScreenFrac(0.75).yFrac > horizon, 'below the horizon at midnight');
  assert.ok(Math.abs(sunScreenFrac(0).yFrac - horizon) < 1e-9, 'on the horizon at sunrise');
  assert.ok(Math.abs(sunScreenFrac(0.5).yFrac - horizon) < 1e-9, 'on the horizon at sunset');
  // As far under at its nadir as over at its noon -- it's the same circle.
  const noonRise = horizon - sunScreenFrac(0.25).yFrac;
  const nadirDrop = sunScreenFrac(0.75).yFrac - horizon;
  assert.ok(Math.abs(noonRise - nadirDrop) < 1e-9, 'the arc is symmetric about the horizon');
  // It retraces its own path underneath rather than jumping across.
  assert.ok(Math.abs(sunScreenFrac(0.5).xFrac - sunScreenFrac(0.5 + 1e-6).xFrac) < 1e-3, 'no jump at sunset');
  assert.ok(Math.abs(sunScreenFrac(0.999).xFrac - sunScreenFrac(0).xFrac) < 1e-2, 'no jump at sunrise');
  for (let p = 0; p <= 1; p += 0.01) {
    const s = sunScreenFrac(p);
    assert.ok(Number.isFinite(s.xFrac) && Number.isFinite(s.yFrac), `non-finite at p=${p}`);
    assert.ok(s.altSigned >= -1 - 1e-9 && s.altSigned <= 1 + 1e-9, `altSigned out of range at p=${p}`);
  }
  // Periodic, like everything else on this clock.
  assert.deepEqual(sunScreenFrac(0.3), sunScreenFrac(1.3));
  assert.deepEqual(sunScreenFrac(0.3), sunScreenFrac(-0.7));
});

test('sunScreenFrac agrees with dayNight about where the sun is while it is up', () => {
  const cycle = 90000;
  for (let p = 0.02; p < 0.5; p += 0.02) {
    const dn = dayNight(p * cycle, cycle);
    const s = sunScreenFrac(p);
    assert.ok(Math.abs(s.altSigned - dn.sunAlt) < 1e-9, `altitude disagrees at p=${p}`);
    assert.ok(Math.abs(s.xFrac - celestialXFracFor(dn.sunAz01)) < 1e-9, `azimuth disagrees at p=${p}`);
  }
});

test('cyclePhase01 wraps to [0,1) and matches the phase dayNight works in', () => {
  assert.ok(Math.abs(cyclePhase01(0, 1000) - 0) < 1e-9);
  assert.ok(Math.abs(cyclePhase01(250, 1000) - 0.25) < 1e-9);
  assert.ok(Math.abs(cyclePhase01(1250, 1000) - 0.25) < 1e-9, 'wraps forward');
  assert.ok(Math.abs(cyclePhase01(-750, 1000) - 0.25) < 1e-9, 'wraps backward');
  for (const t of [-9999, 0, 12345, 1e9]) {
    const v = cyclePhase01(t, 777);
    assert.ok(v >= 0 && v < 1, `out of [0,1) for t=${t}: ${v}`);
  }
});
