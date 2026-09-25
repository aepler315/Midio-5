import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRidgeSurface } from '../src/world/alpine/RidgeSurface.js';

const fixture = (seed = 315, biomeKey = 'RAINFOREST') => ({
  seed, biomeKey, layerKey: 'L3', width: 1024, step: 4, bottomY: 240,
  ridgeYs: Float32Array.from({ length: 257 }, (_, i) => 105 - 42 * Math.sin(i * Math.PI / 256) - 12 * Math.sin(5 * i * Math.PI / 256)),
});

test('features stay deterministic, bounded and attached to source strip geometry', () => {
  const args = fixture(), source = args.ridgeYs.slice();
  const a = buildRidgeSurface(args), b = buildRidgeSurface(args);
  assert.deepEqual(a, b);
  assert.deepEqual(args.ridgeYs, source);
  assert.ok(a.byteLength > 0 && a.byteLength < 1024 * 1024);
  assert.ok(a.facets.length > 0);
  for (const f of a.facets) for (const v of f.vertices) {
    assert.ok(v.sx >= 0 && v.sx <= args.width);
    assert.ok(v.depth01 >= 0 && v.depth01 <= 1);
  }
  assert.notDeepEqual(buildRidgeSurface(fixture(42)), a);
});

test('flat scans do not invent summits and dry biomes do not grow forests', () => {
  const flat = fixture(); flat.ridgeYs.fill(100);
  assert.equal(buildRidgeSurface(flat).facets.length, 0);
  assert.ok(buildRidgeSurface(flat).stands.length > 0, 'forest can grow on a broad plateau');
  const dry = buildRidgeSurface(fixture(315, 'DESERT'));
  assert.equal(dry.stands.length, 0);
});

test('forest cover continues through a long strip instead of ending after early peaks', () => {
  const args = fixture();
  args.width = 8192;
  args.ridgeYs = Float32Array.from({ length: 2049 }, (_, i) => 120 - 30 * Math.sin(i * Math.PI / 250));
  const surface = buildRidgeSurface(args);
  assert.ok(surface.stands.some(s => s.sx > 7000), 'late traversal should still have canopy');
  assert.ok(surface.byteLength < 1024 * 1024);
});
