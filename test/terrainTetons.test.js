import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demFromLatLon, crestGuideFromDem } from '../src/world/terrain/LatLonDem.js';
import { profilesFromJSON } from '../src/world/terrain/TerrainProfile.js';
import { alpineTerrainProfiles } from '../src/world/terrain/loadTerrain.js';
import { stripOriginX } from '../src/world/SilhouetteGenerator.js';

test('a north-up raster keeps north to the north, and the crest guide follows the high column', () => {
  // Two rows, row 0 is north. The northern row is high on the west.
  const elev = Float64Array.from([
    3000, 1000,
    1000, 1000,
  ]);
  const dem = demFromLatLon({
    elev, width: 2, height: 2,
    west: -111, south: 43.5, east: -110.98, north: 43.52,
  }, 200);
  assert.ok(dem.width >= 2 && dem.height >= 2);
  const north = dem.elev[(dem.height - 1) * dem.width];
  const south = dem.elev[0];
  assert.ok(north > south, `north ${north} should be the high side, south ${south}`);
  const guide = crestGuideFromDem(dem, 200);
  assert.ok(guide.length >= 2);
  assert.ok(guide[guide.length - 1].y > guide[0].y);
});

test('a terrain strip scrolls to its end and holds instead of tiling', () => {
  const strip = { width: 1000, ridge: { source: 'terrain' } };
  const loop = { width: 1000, ridge: { source: 'procedural' } };
  assert.equal(stripOriginX(strip, 0, 400), 0);
  assert.equal(stripOriginX(strip, 100, 400), -100);
  assert.equal(stripOriginX(strip, 5000, 400), -600);
  assert.equal(stripOriginX(loop, 1500, 400), -500);
});

test('The Range loads the Teton far ridge and nothing nearer', () => {
  const profiles = alpineTerrainProfiles();
  assert.deepEqual(Object.keys(profiles), ['L2']);
  assert.equal(alpineTerrainProfiles(), profiles);
});

test('the Teton front profile is one real range, and its skyline is the high peaks', () => {
  const raw = JSON.parse(readFileSync(new URL('../data/terrain/tetons-front.json', import.meta.url), 'utf8'));
  const profiles = profilesFromJSON(raw);
  assert.deepEqual(Object.keys(profiles), ['L2']);
  assert.equal(raw.meta.note.length > 0, true);
  const layer = profiles.L2;
  let max = -Infinity;
  for (let i = 0; i < layer.skylineElevM.length; i++) {
    if (layer.skylineElevM[i] > max) max = layer.skylineElevM[i];
  }
  // The 200 m grid understates the surveyed 4199 m summit. It should still
  // be the high Teton crest, not the valley floor (~2000 m).
  assert.ok(max > 3900, `skyline max ${max}`);
  assert.ok(raw.meta.summitLat > 43.70 && raw.meta.summitLat < 43.85, raw.meta.summitLat);
  assert.ok(raw.meta.summitLon < -110.75 && raw.meta.summitLon > -110.90, raw.meta.summitLon);
  // The traced crest and the visible skyline are not the same line.
  assert.ok(raw.meta.crestSkylineDisagree > layer.angles.length * 0.5);
});
