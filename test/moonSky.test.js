import test from 'node:test';
import assert from 'node:assert/strict';
import * as sky from '../src/world/DayNight.js';
import { resolveCelestialState } from '../src/world/CelestialState.js';
import { computeLight } from '../src/render/LightField.js';

const viewport = { width: 1280, height: 720 };

test('each song gets one moonrise and moonset, including short recordings', () => {
  assert.equal(typeof sky.songMoonClock, 'function');
  for (const duration of [1000, 15000, 30000, 180000, 600000]) {
    const clock = sky.songMoonClock(duration);
    assert.ok(Object.isFrozen(clock));
    let previousAz = -1;
    for (let i = 0; i <= 100; i++) {
      const s = sky.dayNight(duration * i / 100, clock);
      assert.equal(s.sunAlt, 0);
      assert.equal(s.night, 1);
      assert.equal(s.dawnAlpha, 0);
      assert.equal(s.duskAlpha, 0);
      assert.ok(s.moonAz01 >= previousAz);
      previousAz = s.moonAz01;
    }
    assert.equal(sky.dayNight(0, clock).moonAlt, 0);
    assert.equal(sky.dayNight(duration, clock).moonAlt, 0);
    assert.ok(sky.dayNight(duration / 2, clock).moonAlt > .999);
    assert.ok(sky.dayNight(duration / 4, clock).moonAlt > 0);
    assert.ok(sky.dayNight(duration * .75, clock).moonAlt > 0);
    assert.deepEqual(sky.dayNight(duration * 2, clock), sky.dayNight(duration, clock), 'song end holds after moonset');
    assert.deepEqual(sky.dayNight(-1000, clock), sky.dayNight(0, clock));
  }
});

test('lunar lighting uses the moon anchor, blue night fill and dark horizon endpoints', () => {
  assert.equal(typeof sky.songMoonClock, 'function');
  const clock = sky.songMoonClock(180000);
  const at = timeMs => resolveCelestialState({ timeMs, cycleMs: clock, viewport });
  for (const timeMs of [18000, 45000, 90000, 135000, 162000]) {
    const state = at(timeMs);
    const light = computeLight({ canvasWidth: viewport.width, canvasHeight: viewport.height, celestialState: state });
    assert.equal(state.activeBody, 'moon');
    assert.equal(state.sun.directGain, 0);
    assert.equal(state.night01, 1);
    assert.equal(light.colorHex, '#c8d8ff');
    assert.ok(light.intensity > 0 && light.intensity <= .25);
    assert.equal(light.x, state.moon.xFrac * viewport.width);
    assert.equal(light.y, state.moon.yFrac * viewport.height);
    assert.ok(state.ambientMultiplier <= .35);
  }
  for (const timeMs of [0, 180000]) {
    assert.equal(at(timeMs).activeBody, null);
    assert.equal(at(timeMs).darkness01, 1);
  }
  const held = at(45000);
  at(170000); at(1000);
  assert.deepEqual(at(45000), held, 'seek and replay reconstruct the same moon and light');
});

test('unknown durations repeat lunar arcs without ever entering daylight', () => {
  assert.equal(typeof sky.songMoonClock, 'function');
  for (const d of [0, undefined, NaN, Infinity, -1]) {
    const clock = sky.songMoonClock(d);
    for (const timeMs of [0, 1000, 75000, 150000, 225000, 600000]) {
      const s = sky.dayNight(timeMs, clock);
      assert.equal(s.sunAlt, 0);
      assert.equal(s.night, 1);
      assert.ok(Number.isFinite(s.moonAlt));
    }
    assert.deepEqual(sky.dayNight(75000, clock), sky.dayNight(225000, clock));
    assert.ok(sky.dayNight(75000, clock).moonAlt > .99);
  }
});
