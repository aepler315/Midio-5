import test from 'node:test';
import assert from 'node:assert/strict';
import { songNightClock, dayNight, twilightAt, cyclePhase01 } from '../src/world/DayNight.js';
import * as sky from '../src/world/DayNight.js';
import { rangeSkyState } from '../src/world/alpine/RangeFrame.js';
import { resolveCelestialState } from '../src/world/CelestialState.js';
import { hexLerp } from '../src/utils/color.js';

const at = (timeMs, clock) => typeof sky.twilightForClock === 'function'
  ? sky.twilightForClock(timeMs, clock) : twilightAt(cyclePhase01(timeMs, clock));
const rgb = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
const distance = (a, b) => Math.max(...rgb(a).map((c, i) => Math.abs(c - rgb(b)[i])));

test('sunset afterglow lingers into moonrise and fades across a blue hour', () => {
  const clock = songNightClock(60000);
  assert.ok(at(9000, clock).amount01 > .3, 'retain afterglow as the moon begins to rise');
  assert.ok(at(12000, clock).amount01 > .05, 'avoid dropping straight to a colorless sky');
  assert.equal(at(15000, clock).amount01, 0);
  const violet = rgb(at(9000, clock).colors.mid);
  assert.ok(violet[2] > violet[0], 'the departing pink cools toward violet-blue');
});

test('sky and air color changes stay gradual through sunset, moonrise, and dawn', () => {
  const clock = songNightClock(60000), profile = { sky: ['#383d46', '#525662', '#777986'] };
  const mgr = { visualStyle: 'soft', _dayNightCycleMs: clock, _rotated: c => c, lerpCache: { get: hexLerp } };
  let previous;
  for (let timeMs = 0; timeMs <= 60000; timeMs += 250) {
    mgr.celestialState = resolveCelestialState({ timeMs, cycleMs: clock, viewport: { width: 1280, height: 720 } });
    mgr._twilight = at(timeMs, clock);
    const current = rangeSkyState(mgr, profile, profile, 1, dayNight(timeMs, clock).night, { skyDark: 1 });
    assert.equal(current.air, current.horizon, 'distant land and water share the same color fade');
    if (previous) {
      for (const stop of ['top', 'mid', 'horizon']) assert.ok(distance(previous[stop], current[stop]) < 14,
        `${stop} jumps ${distance(previous[stop], current[stop])} levels at ${timeMs}ms`);
    }
    previous = current;
  }
});

test('twilight sampling holds and reconstructs exactly when paused or seeking backward', () => {
  const clock = songNightClock(180000), earlier = at(21000, clock);
  at(170000, clock); at(1000, clock);
  assert.deepEqual(at(21000, clock), earlier);
  assert.deepEqual(at(21000, clock), earlier);
  assert.deepEqual(at(-1000, clock), at(0, clock));
  assert.deepEqual(at(200000, clock), at(180000, clock));
});


test('ordinary day cycles and unknown-duration moonlight keep their existing twilight rules', () => {
  for (const clock of [90000, songNightClock(0)]) {
    for (const timeMs of [0, 10000, 40000, 80000, 120000]) {
      assert.deepEqual(sky.twilightForClock(timeMs, clock), twilightAt(cyclePhase01(timeMs, clock)));
    }
  }
});

test('moonrise retains a cool night sky even when the biome palette is pale and warm', () => {
  const clock = songNightClock(60000), profile = { sky: ['#e6d2b6', '#efddc1', '#f8e6c8'] };
  const mgr = { visualStyle: 'soft', _dayNightCycleMs: clock, _rotated: c => c, lerpCache: { get: hexLerp },
    celestialState: resolveCelestialState({ timeMs: 15000, cycleMs: clock, viewport: { width: 1280, height: 720 } }),
    _twilight: at(15000, clock) };
  const colors = rangeSkyState(mgr, profile, profile, 1, 1, { skyDark: 1 });
  for (const stop of ['top', 'mid', 'horizon']) {
    const [r, g, b] = rgb(colors[stop]);
    assert.ok(b > r && b > g, `${stop} remains blue instead of washed-out beige: ${colors[stop]}`);
    assert.ok(Math.max(r, g, b) < 125, `${stop} stays a night sky`);
  }
});
