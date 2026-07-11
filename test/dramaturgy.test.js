import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castBiomes, classifyTransition, intensityBudget, dayArc, BIOME_TEMPERATURE } from '../src/world/Dramaturgy.js';

const COLD = new Set(['ARCTIC', 'MIRROR', 'SAKURA', 'TWILIGHT']);
const HOT = new Set(['CYBER', 'EMBER', 'SOLAR']);

test('castBiomes sends the extremes to matching biomes and orders the middle by temperature', () => {
  const cast = castBiomes([0.05, 0.95, 0.1, 0.9], 7);
  assert.equal(cast.length, 4);
  // The coldest and hottest sections must land squarely in their bands;
  // mid sections may wander within the seeded jitter, but their biome
  // temperatures must still respect the sections' energy ordering.
  assert.ok(COLD.has(cast[0]), `coldest section got ${cast[0]}`);
  assert.ok(HOT.has(cast[1]), `hottest section got ${cast[1]}`);
  assert.ok(BIOME_TEMPERATURE[cast[2]] < BIOME_TEMPERATURE[cast[3]],
    `cold-ish (${cast[2]}) must cast cooler than hot-ish (${cast[3]})`);
});

test('castBiomes never repeats a biome back to back, and always returns valid names', () => {
  const energies = Array.from({ length: 24 }, (_, i) => 0.5 + 0.5 * Math.sin(i));
  const cast = castBiomes(energies, 3);
  for (let i = 0; i < cast.length; i++) {
    assert.ok(cast[i] in BIOME_TEMPERATURE);
    if (i > 0) assert.notEqual(cast[i], cast[i - 1]);
  }
  assert.deepEqual(castBiomes([], 1), []);
});

test('classifyTransition maps boundary sharpness to cut / shutter / fade', () => {
  assert.equal(classifyTransition(0.9, 1), 'cut');
  assert.equal(classifyTransition(0.5, 1), 'shutter');
  assert.equal(classifyTransition(0.1, 1), 'fade');
  assert.equal(classifyTransition(0.5, 0), 'fade'); // degenerate maxNovelty
});

test('intensityBudget stages the show: restrained start, full middle, bounded finale', () => {
  const start = intensityBudget(0);
  const mid = intensityBudget(0.5);
  const end = intensityBudget(1);
  assert.ok(start >= 0.35 && start < 0.6, `intro too loud/quiet: ${start}`);
  assert.ok(mid > 0.95, `mid-song should be full: ${mid}`);
  assert.ok(end <= 1 + 1e-9);
  let prev = -1;
  for (let p = 0; p <= 0.5; p += 0.02) {
    const b = intensityBudget(p);
    assert.ok(b >= prev - 1e-9, 'budget must ramp monotonically through the intro');
    prev = b;
  }
});

test('dayArc: sun climbs to zenith mid-song; dawn and dusk tints stay at their own ends', () => {
  const dawn = dayArc(0), noon = dayArc(0.5), dusk = dayArc(1);
  assert.ok(noon.celestialYFrac < dawn.celestialYFrac, 'zenith must sit higher (smaller y) than dawn');
  assert.ok(noon.celestialYFrac < dusk.celestialYFrac);
  assert.ok(dawn.dawn.alpha > 0.1);
  assert.equal(noon.dawn.alpha, 0);
  assert.equal(noon.dusk.alpha, 0);
  assert.ok(dusk.dusk.alpha > 0.15);
});
