import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySamples, crestRingCells } from '../tools/lib/biomeSample.mjs';

const hit = (biome, ecoregion) => ({ biome, ecoregion });

test('the summit ecoregion stands even when the window is mostly basin', () => {
  const forest = hit('Tropical & Subtropical Coniferous Forests', 'Sierra Madre Occidental pine-oak forests');
  const desert = hit('Deserts & Xeric Shrublands', 'Chihuahuan desert');
  const row = classifySamples({
    summit: forest,
    crest: [forest, desert, desert, desert],
    around: [desert, desert, desert, desert, desert],
  });
  assert.equal(row.ecoregion, forest.ecoregion);
  assert.equal(row.biome, forest.biome);
  assert.equal(row.share, 0.25);
  assert.equal(row.surrounding[0].ecoregion, desert.ecoregion);
  assert.equal(row.surrounding[0].share, 1);
});

test('a crest of forest outvotes the basin only when the summit itself missed', () => {
  const forest = hit('Temperate Conifer Forests', 'Arizona Mountains forests');
  const basin = hit('Deserts & Xeric Shrublands', 'Colorado Plateau shrublands');
  const row = classifySamples({
    summit: null,
    crest: [forest, forest, forest, basin],
    around: [basin, basin, basin, basin],
  });
  assert.equal(row.ecoregion, forest.ecoregion);
  assert.equal(row.share, 0.75);
  assert.equal(row.surrounding[0].ecoregion, basin.ecoregion);
});

test('share ignores samples that missed the map', () => {
  const forest = hit('Temperate Conifer Forests', 'Northern Rockies conifer forests');
  const row = classifySamples({
    summit: forest,
    crest: [forest, forest, null, null],
    around: [null, null],
  });
  assert.equal(row.share, 1);
  assert.deepEqual(row.surrounding, []);
});

test('the ring is used when the summit and the crest both miss land', () => {
  const grass = hit('Temperate Grasslands, Savannas & Shrublands', 'Montana Valley and Foothill grasslands');
  const row = classifySamples({
    summit: null,
    crest: [null, null],
    around: [grass, grass, null],
  });
  assert.equal(row.ecoregion, grass.ecoregion);
  assert.equal(row.share, 1);
  assert.equal(classifySamples({ summit: null, crest: [], around: [] }), null);
});

test('the crest of a 7x7 stamp is the inner 3x3', () => {
  const { crest, around } = crestRingCells(7);
  assert.equal(crest.length, 9);
  assert.equal(around.length, 40);
  assert.equal(crest.length + around.length, 49);
});
