import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WeatherDirector, kindForMood, KINDS } from '../src/sim/WeatherDirector.js';

const STEP = 1 / 120;

test('KINDS lists all seven weather kinds', () => {
  assert.deepEqual([...KINDS], ['rain', 'snow', 'petals', 'embers', 'sunshine', 'fog', 'wind']);
});

test('kindForMood: sad valence -> rain, neutral -> snow, happy -> petals', () => {
  assert.equal(kindForMood(-0.8, 0.3, 'snow'), 'rain');
  assert.equal(kindForMood(0, 0.3, 'snow'), 'snow');
  assert.equal(kindForMood(0.8, 0.3, 'snow'), 'petals');
});

test('kindForMood: high epic overrides valence to embers', () => {
  assert.equal(kindForMood(-0.8, 0.9, 'snow'), 'embers');
  assert.equal(kindForMood(0.8, 0.9, 'rain'), 'embers');
});

test('kindForMood: becalmed and happy -> sunshine, becalmed and sad -> fog', () => {
  assert.equal(kindForMood(0.8, 0.1, 'snow'), 'sunshine');
  assert.equal(kindForMood(-0.8, 0.1, 'snow'), 'fog');
  // Becalmed but mood-neutral still falls through to the ordinary mapping.
  assert.equal(kindForMood(0, 0.1, 'snow'), 'snow');
});

test('kindForMood: energetic and mood-neutral (short of embers) -> wind', () => {
  assert.equal(kindForMood(0, 0.6, 'snow'), 'wind');
  assert.equal(kindForMood(0.1, 0.6, 'rain'), 'wind');
  // Too far from neutral valence, even at wind-range epic, falls through.
  assert.equal(kindForMood(0.8, 0.6, 'snow'), 'petals');
});

test('kindForMood: none of the new dramatic kinds disturb the original rain/snow/petals/embers mapping at epic=0.3', () => {
  assert.equal(kindForMood(-0.8, 0.3, 'snow'), 'rain');
  assert.equal(kindForMood(0, 0.3, 'snow'), 'snow');
  assert.equal(kindForMood(0.8, 0.3, 'snow'), 'petals');
});

test('kindForMood: hysteresis keeps the current kind near a boundary', () => {
  // Boundary is -0.2; from 'rain' the exit threshold shifts to -0.2+0.08.
  assert.equal(kindForMood(-0.15, 0.3, 'rain'), 'rain', 'should not flip back to snow yet');
  assert.equal(kindForMood(-0.05, 0.3, 'rain'), 'snow', 'clearly past the widened boundary');
  // From 'snow', both boundaries widen outward.
  assert.equal(kindForMood(-0.22, 0.3, 'snow'), 'snow');
  assert.equal(kindForMood(-0.35, 0.3, 'snow'), 'rain');
});

test('WeatherDirector defaults to snow and stays there under neutral mood', () => {
  const w = new WeatherDirector();
  assert.equal(w.kind, 'snow');
  let t = 0;
  for (let i = 0; i < 200; i++) { w.update(t, STEP, { valence: 0, epic: 0.3, energySlow: 0.6 }); t += 8.33; }
  assert.equal(w.kind, 'snow');
});

test('WeatherDirector: a kind change eases the outgoing kind fully to 0 before swapping (no double-draw)', () => {
  const w = new WeatherDirector();
  let t = 0;
  // Build up intensity as snow first.
  for (let i = 0; i < 600; i++) { w.update(t, STEP, { valence: 0, epic: 0.3, energySlow: 0.9 }); t += 8.33; }
  assert.ok(w.intensity > 0.3, 'should have built up some snow intensity');

  // Force the next re-evaluation to land immediately (deterministic, rather
  // than waiting out KIND_REEVAL_MS in real simulated time), then push
  // valence hard toward rain and step through the transition.
  w._nextEvalMs = t;
  let lastSnowIntensity = w.intensity;
  for (let i = 0; i < 600; i++) {
    w.update(t, STEP, { valence: -0.9, epic: 0.3, energySlow: 0.9 });
    t += 8.33;
    if (w.kind === 'snow') lastSnowIntensity = w.intensity;
    if (w.kind === 'rain') break;
  }
  assert.equal(w.kind, 'rain', 'should eventually swap to rain');
  // The swap to 'rain' and the snap-to-0 happen in the same update() call
  // (no point drawing a dead zero frame) -- so what we can observe is that
  // snow's intensity was already negligible on the step right before the
  // swap, i.e. it faded out rather than being cut off mid-flight.
  assert.ok(lastSnowIntensity < 0.02, `snow should have faded to near-0 before the swap, was ${lastSnowIntensity}`);
});

test('WeatherDirector: intensity rises under sustained energy and falls under calm', () => {
  const hot = new WeatherDirector(), calm = new WeatherDirector();
  let t = 0;
  for (let i = 0; i < 600; i++) {
    hot.update(t, STEP, { valence: 0, epic: 0.3, energySlow: 0.9, calm: 0 });
    calm.update(t, STEP, { valence: 0, epic: 0.3, energySlow: 0.9, calm: 1 });
    t += 8.33;
  }
  assert.ok(hot.intensity > calm.intensity, `hot=${hot.intensity} should exceed calm=${calm.intensity}`);
  assert.ok(hot.intensity > 0.3);
});

test('WeatherDirector: intensity stays bounded 0..1 even with surge boost stacked on full energy', () => {
  const w = new WeatherDirector();
  let t = 0;
  for (let i = 0; i < 600; i++) { w.update(t, STEP, { valence: 0, epic: 0.3, energySlow: 1, surge: 1 }); t += 8.33; }
  assert.ok(w.intensity <= 1 + 1e-9);
});

test('WeatherDirector: unravel (the coda) forces intensity toward 0 regardless of energy', () => {
  const w = new WeatherDirector();
  let t = 0;
  for (let i = 0; i < 600; i++) { w.update(t, STEP, { valence: 0, epic: 0.3, energySlow: 1 }); t += 8.33; }
  assert.ok(w.intensity > 0.3, 'should be raining/snowing hard before the coda');
  // RELEASE_TAU_SEC is 6s -- give the exponential release enough simulated
  // time (~40s) to actually settle under the dormant gate, not just decay partway.
  for (let i = 0; i < 5000; i++) { w.update(t, STEP, { valence: 0, epic: 0.3, energySlow: 1, unravel: 1 }); t += 8.33; }
  assert.equal(w.intensity, 0, 'the coda should fully clear the sky');
});

test('WeatherDirector: low energy/quiet mood leaves the layer fully dormant (exactly 0, not just low)', () => {
  const w = new WeatherDirector();
  let t = 0;
  for (let i = 0; i < 600; i++) { w.update(t, STEP, { valence: 0, epic: 0.3, energySlow: 0.1, calm: 0.5 }); t += 8.33; }
  assert.equal(w.intensity, 0);
});

test('WeatherDirector.state exposes exactly one live kind', () => {
  const w = new WeatherDirector();
  w.update(0, STEP, { valence: 0, epic: 0.3, energySlow: 0.9 });
  const s = w.state;
  assert.ok(KINDS.includes(s.kind));
  assert.equal(typeof s.intensity, 'number');
});
