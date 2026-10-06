import test from 'node:test';
import assert from 'node:assert/strict';
import * as sky from '../src/world/DayNight.js';
import { resolveCelestialState } from '../src/world/CelestialState.js';
import { computeLight } from '../src/render/LightField.js';

const viewport = { width: 1280, height: 720 };

test('songs start at sunset, spend most of their time under the moon, and end at sunrise', () => {
  assert.equal(typeof sky.songNightClock, 'function');
  for (const duration of [1000, 15000, 30000, 180000, 600000]) {
    const clock = sky.songNightClock(duration);
    assert.ok(Object.isFrozen(clock));
    for (let i = 0; i <= 1000; i++) {
      const s = sky.dayNight(duration * i / 1000, clock);
      assert.ok(s.sunAlt < .2, 'sun stays at the horizon, never full day');
      assert.ok(s.night >= .75, 'retain the night sky during twilight');
      if (i >= 150 && i <= 850) {
        assert.equal(s.sunAlt, 0);
        assert.equal(s.night, 1);
      }
    }
    const start = sky.dayNight(0, clock), end = sky.dayNight(duration, clock);
    assert.ok(start.sunAlt > .1 && start.sunAz01 > .9);
    assert.ok(end.sunAlt > .1 && end.sunAz01 < .1);
    const dusk = sky.twilightAt(clock.phaseAt(0)), dawn = sky.twilightAt(clock.phaseAt(duration));
    assert.equal(dusk.rising, false);
    assert.equal(dawn.rising, true);
    assert.ok(dusk.amount01 > .7 && dawn.amount01 > .7);
    assert.equal(start.moonAlt, 0);
    assert.equal(end.moonAlt, 0);
    assert.ok(sky.dayNight(duration / 2, clock).moonAlt > .999);
    assert.ok(sky.dayNight(duration / 4, clock).moonAlt > 0);
    assert.ok(sky.dayNight(duration * .75, clock).moonAlt > 0);
    assert.deepEqual(sky.dayNight(duration * 2, clock), end, 'song end holds at sunrise');
    assert.deepEqual(sky.dayNight(-1000, clock), start);
    // The dawn phase wrap must not cause a jump in altitude or sky brightness.
    // Twilight is bounded in real time on long songs. Sample at a
    // sub-frame/100ms cadence, rather than stretching each step with it.
    const sampleMs = Math.min(duration / 1000, 100);
    for (let timeMs = sampleMs; timeMs <= duration; timeMs += sampleMs) {
      const a = sky.dayNight(timeMs - sampleMs, clock);
      const b = sky.dayNight(timeMs, clock);
      assert.ok(Math.abs(a.sunAlt - b.sunAlt) < .01);
      assert.ok(Math.abs(a.moonAlt - b.moonAlt) < .01);
      assert.ok(Math.abs(a.night - b.night) < .01);
      assert.ok(Math.abs(a.dawnAlpha - b.dawnAlpha) < .01, 'dawn tint stays continuous across the phase wrap');
      assert.ok(Math.abs(a.duskAlpha - b.duskAlpha) < .01);
    }
  }
});

test('sunset and sunrise use warm sun anchors around a blue moonlit middle', () => {
  assert.equal(typeof sky.songNightClock, 'function');
  const clock = sky.songNightClock(180000);
  const at = timeMs => resolveCelestialState({ timeMs, cycleMs: clock, viewport });
  for (const timeMs of [45000, 90000, 135000]) {
    const state = at(timeMs);
    const light = computeLight({ canvasWidth: viewport.width, canvasHeight: viewport.height, celestialState: state });
    assert.equal(state.activeBody, 'moon');
    assert.equal(state.sun.directGain, 0);
    assert.equal(state.night01, 1);
    assert.equal(light.colorHex, '#c8d8ff');
    assert.ok(light.intensity > 0 && light.intensity <= .25);
    assert.equal(light.x, state.moon.xFrac * viewport.width);
    assert.equal(light.y, state.moon.yFrac * viewport.height);
  }
  for (const timeMs of [0, 180000]) {
    const state = at(timeMs);
    const light = computeLight({ canvasWidth: viewport.width, canvasHeight: viewport.height, celestialState: state });
    assert.equal(state.activeBody, 'sun');
    assert.equal(light.colorHex, state.sun.colorHex);
    assert.notEqual(light.colorHex, '#fff3df');
    assert.equal(light.x, state.sun.xFrac * viewport.width);
  }
  const held = at(45000);
  at(180000); at(0);
  assert.deepEqual(at(45000), held, 'seek and replay reconstruct the same moon and light');
});

test('unknown durations retain repeating moonlight until a song ending is known', () => {
  assert.equal(typeof sky.songNightClock, 'function');
  for (const d of [0, undefined, NaN, Infinity, -1]) {
    const clock = sky.songNightClock(d);
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
