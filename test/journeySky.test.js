import test from 'node:test';
import assert from 'node:assert/strict';
import { dayNight, songNightClock } from '../src/world/DayNight.js';
import { sampleJourneySky } from '../src/world/alpine/JourneySky.js';

const numeric = ['stars01', 'constellations01', 'aurora01', 'night01', 'twilight01'];
const layers = ['stars01', 'constellations01', 'aurora01'];
const at = (timeMs, durationMs = 60000, extra = {}) => sampleJourneySky({ timeMs, durationMs, ...extra });

test('a known journey reveals the stars after sunset, constellations in blue hour, and a coherent night', () => {
  for (const durationMs of [1000, 15000, 60000, 180000, 600000]) {
    const twilightMs = Math.min(durationMs * .25, 45000);
    const opening = at(0, durationMs), ending = at(durationMs, durationMs);
    for (const key of layers) {
      assert.equal(opening[key], 0, `no ${key} on the opening sunset`);
      assert.equal(ending[key], 0, `no ${key} on the final sunrise`);
    }
    assert.equal(opening.phase, 'sunset');
    assert.equal(ending.phase, 'sunrise');
    assert.equal(opening.night01, 0);
    assert.equal(ending.night01, 0);
    assert.equal(opening.twilight01, 1);
    assert.equal(ending.twilight01, 1);
    const lateSunset = at(twilightMs * .3, durationMs);
    assert.ok(lateSunset.stars01 > 0 && lateSunset.stars01 < .05, 'a few stars emerge in late sunset');
    assert.equal(lateSunset.constellations01, 0, 'no line art while the sun is setting');
    assert.equal(lateSunset.aurora01, 0);
    const blueHour = at(twilightMs * .6, durationMs);
    assert.equal(blueHour.phase, 'blue-hour');
    assert.ok(blueHour.stars01 > blueHour.constellations01);
    assert.ok(blueHour.constellations01 > 0 && blueHour.constellations01 < .3, 'art gradually appears at moonrise');
    for (let timeMs = twilightMs * 1.4; timeMs <= durationMs - twilightMs * 1.4; timeMs += durationMs / 100) {
      const night = at(timeMs, durationMs);
      for (const key of [...layers, 'night01']) assert.equal(night[key], 1, `${key} remains full through the night`);
      assert.equal(night.twilight01, 0);
      assert.equal(night.phase, 'moonlight');
    }
    const sunrise = at(durationMs - twilightMs * .36, durationMs);
    for (const key of layers) assert.equal(sunrise[key], 0, `${key} fades before the sun rises`);
  }
});

test('layer reveals and fades are monotone, bounded and continuously eased at their joins', () => {
  const durationMs = 60000, twilightMs = 15000;
  let previous = at(0);
  for (let timeMs = 100; timeMs <= durationMs; timeMs += 100) {
    const current = at(timeMs);
    for (const key of numeric) {
      assert.ok(Number.isFinite(current[key]) && current[key] >= 0 && current[key] <= 1, `${key} stays bounded`);
      const delta = current[key] - previous[key];
      assert.ok(Math.abs(delta) < .025, `${key} never pops`);
      const opening = timeMs <= durationMs / 2;
      assert.ok((key === 'twilight01' ? -delta : delta) * (opening ? 1 : -1) >= -1e-12, `${key} has no intermittent dropouts`);
    }
    previous = current;
  }
  const joins = [0, .28, .48, .56, 1, 1.2, 1.16].map(x => x * twilightMs)
    .concat([0, .4, .64, .6, 1, 1.1, 1.4, 1.18].map(x => durationMs - x * twilightMs));
  for (const timeMs of joins) {
    const left = at(timeMs - 1), center = at(timeMs), right = at(timeMs + 1);
    for (const key of numeric) {
      assert.ok(Math.abs((right[key] - center[key]) - (center[key] - left[key])) < 1e-7,
        `${key} velocity is continuous at ${timeMs}ms`);
    }
  }
});

test('seeking, held time and reduced motion preserve semantic sky phases', () => {
  for (const durationMs of [15000, 60000, 600000]) {
    for (const timeMs of [0, durationMs * .12, durationMs / 2, durationMs * .9, durationMs]) {
      const earlier = at(timeMs, durationMs);
      at(durationMs, durationMs); at(0, durationMs);
      assert.deepEqual(at(timeMs, durationMs), earlier);
      assert.deepEqual(at(timeMs, durationMs, { reducedMotion: true }), earlier,
        'spatial freeze must not freeze sunset or make all constellations appear');
      assert.deepEqual(at(timeMs, durationMs, { light: { night01: .75 } }), earlier,
        'the Range lighting floor must not override the visibility clock');
    }
    assert.deepEqual(at(-1000, durationMs), at(0, durationMs));
    assert.deepEqual(at(durationMs + 100000, durationMs), at(durationMs, durationMs));
  }
});

test('unknown durations reveal into sustained moonlight without inventing a final sunrise', () => {
  for (const durationMs of [0, undefined, -1, NaN, Infinity]) {
    const opening = sampleJourneySky({ durationMs });
    for (const key of layers) assert.equal(opening[key], 0);
    const night = sampleJourneySky({ durationMs, timeMs: 60000 });
    for (const key of [...layers, 'night01']) assert.equal(night[key], 1);
    assert.equal(night.phase, 'moonlight');
    assert.equal(night.twilight01, 0);
    assert.deepEqual(sampleJourneySky({ durationMs, timeMs: 600000 }), night);
  }
  for (const timeMs of [NaN, Infinity, -Infinity, -1]) {
    assert.deepEqual(sampleJourneySky({ timeMs }), sampleJourneySky(), 'invalid heard time holds the opening');
  }
});

test('a sunset keeps its physical sun visible through a readable part of the afterglow', () => {
  for (const durationMs of [1000, 15000, 60000, 180000, 600000]) {
    const clock = songNightClock(durationMs);
    const twilightMs = Math.min(durationMs * .25, 45000);
    assert.ok(dayNight(twilightMs * .25, clock).sunAlt > .025,
      `${durationMs}ms song still has a setting sun a quarter into its twilight`);
    assert.equal(dayNight(twilightMs * .4, clock).sunAlt, 0, 'sun sets before blue hour');
    assert.ok(dayNight(twilightMs * .8, clock).moonAlt > 0, 'moon rises during the afterglow');
    assert.equal(dayNight(durationMs / 2, clock).sunAlt, 0, 'never turns into a full day');
    assert.ok(dayNight(durationMs / 2, clock).moonAlt > .999);
    assert.ok(dayNight(durationMs - twilightMs * .25, clock).sunAlt > .025,
      'sunrise lasts long enough to read too');
  }
});

test('celestial motion eases continuously through twilight joins and the held endpoints', () => {
  const durationMs = 60000, clock = songNightClock(durationMs), twilightMs = 15000;
  const joins = [0, twilightMs * .36, twilightMs * .6, durationMs - twilightMs * .6,
    durationMs - twilightMs * .36, durationMs];
  const stepMs = 1;
  for (const timeMs of joins) {
    const left = dayNight(timeMs - stepMs, clock), center = dayNight(timeMs, clock), right = dayNight(timeMs + stepMs, clock);
    for (const key of ['sunAlt', 'moonAlt', 'night']) {
      const before = (center[key] - left[key]) / stepMs;
      const after = (right[key] - center[key]) / stepMs;
      assert.ok(Math.abs(after - before) < 1e-7, `${key} velocity jumps at ${timeMs}ms`);
    }
  }
});
