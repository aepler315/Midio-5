import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZoomDirector, ZOOM_MIN, ZOOM_MAX, ZOOM_NEUTRAL, sceneForBiome, sceneSeedFor, SCENES, pinchZoomDelta,
} from '../src/sim/ZoomDirector.js';

const STEP = 1 / 120;

test('SCENES lists all four interior kinds', () => {
  assert.deepEqual([...SCENES], ['warren', 'temple', 'tomb', 'geode']);
});

test('sceneForBiome maps every stock biome to one of the four scenes, unknowns fall back to warren', () => {
  for (const name of ['JADE', 'SAKURA', 'TWILIGHT']) assert.equal(sceneForBiome(name), 'warren');
  for (const name of ['EMBER', 'SOLAR']) assert.equal(sceneForBiome(name), 'temple');
  for (const name of ['VOID', 'STORM']) assert.equal(sceneForBiome(name), 'tomb');
  for (const name of ['ARCTIC', 'MIRROR', 'CYBER']) assert.equal(sceneForBiome(name), 'geode');
  assert.equal(sceneForBiome('SOME_CUSTOM_MIDI_BIOME'), 'warren');
});

test('sceneSeedFor is deterministic per (song, biome, world bucket) and varies across each', () => {
  const a = sceneSeedFor(42, 'EMBER', 1000);
  const b = sceneSeedFor(42, 'EMBER', 1000);
  assert.equal(a, b, 'same inputs must reproduce the same seed');
  assert.notEqual(a, sceneSeedFor(43, 'EMBER', 1000), 'different song seed should differ');
  assert.notEqual(a, sceneSeedFor(42, 'SOLAR', 1000), 'different biome should differ');
  assert.notEqual(a, sceneSeedFor(42, 'EMBER', 100000), 'a different world bucket should differ');
});

test('value eases toward target with a real lag (not instant), starts at the neutral resting zoom', () => {
  const z = new ZoomDirector(1);
  assert.equal(z.value, ZOOM_NEUTRAL);
  z.nudge(ZOOM_MAX); // clamp will pin target at ZOOM_MAX
  z.update(0, STEP, 'TWILIGHT', 0);
  assert.ok(z.value > ZOOM_NEUTRAL, 'should have started moving');
  assert.ok(z.value < ZOOM_NEUTRAL + (ZOOM_MAX - ZOOM_NEUTRAL) * 0.1, 'a single 8.3ms step must not have arrived yet');
});

test('nudge stays clamped within [ZOOM_MIN, ZOOM_MAX]; toggle snaps between neutral and ZOOM_MAX', () => {
  const z = new ZoomDirector(1);
  z.nudge(-100);
  assert.equal(z.target, ZOOM_MIN);
  z.nudge(100);
  assert.equal(z.target, ZOOM_MAX);
  z.toggle();
  assert.equal(z.target, ZOOM_NEUTRAL, 'toggle backs off to the resting zoom, not the far zoomed-out end');
  z.toggle();
  assert.equal(z.target, ZOOM_MAX);
});

test('sustained nudge toward max eventually reaches full reveal (1) and drops back to 0 when nudged back out', () => {
  const z = new ZoomDirector(7);
  z.nudge(ZOOM_MAX);
  let t = 0;
  for (let i = 0; i < 600; i++) { z.update(t, STEP, 'EMBER', 0); t += 8.33; } // ~5s: several eases
  assert.ok(z.value > ZOOM_MAX - 0.05, `expected value to approach ZOOM_MAX, got ${z.value}`);
  assert.ok(z.reveal > 0.95, `expected near-full reveal, got ${z.reveal}`);

  z.nudge(-ZOOM_MAX);
  for (let i = 0; i < 600; i++) { z.update(t, STEP, 'EMBER', 0); t += 8.33; }
  assert.ok(z.value < ZOOM_MIN + 0.05);
  assert.equal(z.reveal, 0);
});

test('scene latches on crossing into reveal and releases once reveal returns to (near) 0', () => {
  const z = new ZoomDirector(3);
  z.nudge(ZOOM_MAX);
  let t = 0;
  for (let i = 0; i < 600; i++) { z.update(t, STEP, 'ARCTIC', 500); t += 8.33; }
  assert.ok(z.scene, 'expected a latched scene at full zoom');
  assert.equal(z.scene.kind, 'geode', 'ARCTIC should map to geode');

  const latchedSeed = z.scene.seed;
  // Even if the biome/worldX drift while still zoomed in, the latched scene must not change.
  z.update(t, STEP, 'STORM', 999999);
  assert.equal(z.scene.seed, latchedSeed, 'scene must not change mid-zoom even if inputs drift');

  z.nudge(-ZOOM_MAX);
  for (let i = 0; i < 600; i++) { z.update(t, STEP, 'STORM', 999999); t += 8.33; }
  assert.equal(z.scene, null, 'scene should release once fully zoomed back out');
});

test('justCrossedIn/justCrossedOut fire exactly once per crossing of the inside threshold', () => {
  const z = new ZoomDirector(9);
  z.nudge(ZOOM_MAX);
  let t = 0;
  let inCount = 0, outCount = 0;
  for (let i = 0; i < 600; i++) {
    z.update(t, STEP, 'JADE', 0);
    if (z.justCrossedIn) inCount++;
    t += 8.33;
  }
  assert.equal(inCount, 1, `expected exactly one crossing-in, got ${inCount}`);

  z.nudge(-ZOOM_MAX);
  for (let i = 0; i < 600; i++) {
    z.update(t, STEP, 'JADE', 0);
    if (z.justCrossedOut) outCount++;
    t += 8.33;
  }
  assert.equal(outCount, 1, `expected exactly one crossing-out, got ${outCount}`);
});

test('pinchZoomDelta: spreading zooms in, pinching together zooms out, no-op with invalid distances', () => {
  assert.ok(pinchZoomDelta(100, 150, 0.01) > 0, 'spreading fingers should zoom in');
  assert.ok(pinchZoomDelta(150, 100, 0.01) < 0, 'pinching together should zoom out');
  assert.equal(pinchZoomDelta(0, 150, 0.01), 0);
  assert.equal(pinchZoomDelta(150, 0, 0.01), 0);
  assert.equal(pinchZoomDelta(-10, 150, 0.01), 0);
});

test('ZOOM_MIN now allows zooming out below 1 (the world pulling back, not just leaning in)', () => {
  assert.ok(ZOOM_MIN < 1, `expected ZOOM_MIN < 1, got ${ZOOM_MIN}`);
});
