import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawnWeatherKindFor } from '../src/world/BiomeManager.js';

test('the Range paints epic ember weather as driven wind', () => {
  assert.equal(drawnWeatherKindFor('alpine', 'embers'), 'wind');
});

test('every other Range weather kind, and every other world, paints as directed', () => {
  for (const kind of ['rain', 'snow', 'petals', 'sunshine', 'fog', 'wind']) assert.equal(drawnWeatherKindFor('alpine', kind), kind);
  for (const world of ['city', 'fathom', undefined]) assert.equal(drawnWeatherKindFor(world, 'embers'), 'embers');
});
