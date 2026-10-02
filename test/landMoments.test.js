// The land moves only at the song's big moments (RangeFrame.landMoment01 /
// landMotion): still between section changes, a slow swell at each one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAND_SWELL, landMoment01, landMotion, rangeMusicState, sceneDeformation } from '../src/world/alpine/RangeFrame.js';

const sections = [
  { startMs: 0, label: 'intro', meanEnergy: 0.2, relEnergy01: 0.2 },
  { startMs: 20000, label: 'verse', meanEnergy: 0.3, relEnergy01: 0.4 },
  { startMs: 40000, label: 'drop', meanEnergy: 0.9, relEnergy01: 1 },
  { startMs: 60000, label: 'drop', meanEnergy: 0.9, relEnergy01: 1 },
];
const span = LAND_SWELL.riseMs + LAND_SWELL.holdMs + LAND_SWELL.settleMs;

test('the land is still between moments and at the song start', () => {
  for (const t of [0, 5000, 19999, 20000 + span, 39000, 60000 + 4000, 90000]) assert.equal(landMoment01(sections, t), 0, `${t}`);
  assert.equal(landMoment01(null, 1000), 0);
});

test('a lift into a louder part swells fully; a plain change swells less; a repeat not at all', () => {
  const peakOf = (start) => Math.max(...Array.from({ length: 60 }, (_, i) => landMoment01(sections, start + i * 250)));
  const drop = peakOf(40000), verse = peakOf(20000);
  assert.ok(drop > 0.9, `${drop}`);
  assert.ok(Math.abs(verse - LAND_SWELL.changeFloor) < 0.05, `${verse}`);
  assert.equal(peakOf(60000), 0, 'drop into the same drop');
});

test('a swell rises and settles slowly: no frame jolts', () => {
  let prev = 0, maxStep = 0;
  for (let t = 39000; t < 40000 + span + 1000; t += 1000 / 24) {
    const m = landMoment01(sections, t);
    maxStep = Math.max(maxStep, Math.abs(m - prev));
    prev = m;
  }
  assert.ok(maxStep < 0.03, `${maxStep}`);
});

test('kicks, melody and gesture move nothing; the moment alone shapes the land', () => {
  const loud = rangeMusicState({ env: { groove: 1, sustain: 1, kickMul: 1, gesture: 1 }, evaluatedKick01: 1,
    melody: { activity: 1, pitch01: 0.8, pan: 0.3 }, structural01: 1, activity01: 1, tSec: 12 });
  const still = landMotion(loud, 0, { tSec: 12 });
  assert.equal(sceneDeformation(still, 900, 400, 1800, [0, 2000]), 0);
  assert.equal(still.source, loud, 'the heard channels stay on the frame');
  assert.equal(still.kick01, loud.kick01, 'water still ripples to the kick');
  const swell = landMotion(loud, 1, { tSec: 12 });
  assert.ok(Math.abs(sceneDeformation(swell, 900, 400, 1800, [0, 2000])) > 1);
  assert.ok(swell.totalBoundM <= LAND_SWELL.waveM + LAND_SWELL.liftM);
  assert.equal(sceneDeformation(landMotion(loud, 1, { tSec: 12, reducedMotion: true }), 900, 400, 1800, [0, 2000]), 0);
});
