import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainStripCache, stripSetBytes } from '../src/world/terrain/TerrainStripCache.js';

const strip = (width, height) => ({ width, height });

test('strip byte accounting includes every owned RGBA surface', () => {
  assert.equal(stripSetBytes({ L2: strip(10, 20), L3: strip(4, 5) }), (200 + 20) * 4);
});

test('cache evicts least-recent unpinned palettes by accounted bytes', () => {
  const cache = new TerrainStripCache({ maxBytes: 1_000 });
  cache.set('a', { L2: strip(10, 10) }); // 400
  cache.set('b', { L2: strip(10, 10) }); // 400
  cache.get('a');
  cache.set('c', { L2: strip(10, 10) }); // evicts b
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('c'), true);
  assert.equal(cache.bytes, 800);
});

test('current and incoming palettes survive transition eviction', () => {
  const cache = new TerrainStripCache({ maxBytes: 800 });
  cache.set('old', { L2: strip(10, 10) });
  cache.setPins(['from', 'to']);
  cache.set('from', { L2: strip(10, 10) });
  cache.set('to', { L2: strip(10, 10) });
  assert.equal(cache.has('old'), false);
  assert.equal(cache.has('from'), true);
  assert.equal(cache.has('to'), true);
});

test('clear releases every owned palette', () => {
  const cache = new TerrainStripCache({ maxBytes: 1_000 });
  const surface = strip(10, 10);
  surface.getContext = () => ({});
  cache.set('a', { L2: surface });
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.bytes, 0);
  assert.equal(surface.width, 0);
  assert.equal(surface.height, 0);
});

test('reserve evicts before the next palette allocation', () => {
  const cache = new TerrainStripCache({ maxBytes: 1_000 });
  cache.set('old', { L2: strip(10, 10) });
  cache.set('current', { L2: strip(10, 10) });
  cache.setPins(['current']);
  assert.equal(cache.reserve(400), true);
  assert.equal(cache.has('old'), false);
  assert.equal(cache.bytes + 400 <= cache.maxBytes, true);
});
