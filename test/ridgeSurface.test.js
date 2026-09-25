import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateSurfaceBytes, buildRidgeSurface } from '../src/world/alpine/RidgeSurface.js';

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

test('flat scans keep the skyline and only add restrained panels', () => {
  const flat = fixture();
  flat.ridgeYs.fill(100);
  const original = flat.ridgeYs.slice();
  const surface = buildRidgeSurface(flat);
  assert.deepEqual(flat.ridgeYs, original);
  assert.ok(surface.facets.length > 0);
  assert.ok(surface.facets.every((f) => f.structural && Math.abs(f.intrinsicTone) <= 0.16));
  assert.ok(surface.stands.length > 0, 'forest can grow on a broad plateau');
  const dry = buildRidgeSurface(fixture(315, 'DESERT'));
  assert.equal(dry.stands.length, 0);
});

test('forest cover continues through a long strip instead of ending after early peaks', () => {
  const args = fixture();
  args.width = 8192;
  args.ridgeYs = Float32Array.from({ length: 2049 }, (_, i) => 120 - 30 * Math.sin(i * Math.PI / 250));
  const surface = buildRidgeSurface(args);
  const standSx = (s) => Math.max(...(s.vertices || []).map((v) => v.sx), s.sx || 0);
  assert.ok(surface.stands.some((s) => standSx(s) > 7000), 'late traversal should still have canopy');
  assert.ok(surface.byteLength < 1024 * 1024);
  assert.ok(aggregateSurfaceBytes([surface, surface, surface, surface, surface, surface, surface, surface]) < 1024 * 1024);
});

test('summit detection follows the source peak between former probe positions', () => {
  const ridgeYs = Float32Array.from({ length: 1025 }, (_, x) =>
    160 - 70 * Math.exp(-(((x - 201) / 24) ** 2)));
  const original = ridgeYs.slice();
  const surface = buildRidgeSurface({
    seed: 315, biomeKey: 'CANYON', layerKey: 'L3',
    width: 1024, ridgeYs, step: 1, bottomY: 240,
  });
  assert.deepEqual(Array.from(ridgeYs), Array.from(original));
  assert.equal(surface.version, 2);
  assert.ok(surface.facets.some((f) => f.vertices.some((v) =>
    Math.abs(v.sx - 201) <= 8 && v.depth01 === 0)));
});

test('a long slope and a plateau keep the skyline and gain broad panels', () => {
  const slope = Float32Array.from({ length: 400 }, (_, i) => 40 + i * 0.4);
  const before = slope.slice();
  const surface = buildRidgeSurface({
    seed: 7, biomeKey: 'STEPPE', layerKey: 'L4', width: 1600, ridgeYs: slope, step: 4, bottomY: 200,
  });
  assert.deepEqual(Array.from(slope), Array.from(before));
  assert.ok(surface.facets.some((f) => f.structural && Math.abs(f.intrinsicTone) < 0.2));
});

test('cover and face families do not share a random stream', () => {
  const rain = buildRidgeSurface(fixture(315, 'RAINFOREST'));
  const canyon = buildRidgeSurface(fixture(315, 'CANYON'));
  assert.deepEqual(rain.facets.map((f) => f.vertices), canyon.facets.map((f) => f.vertices));
  assert.notDeepEqual(rain.stands.map((s) => s.kind), canyon.stands.map((s) => s.kind));
});
