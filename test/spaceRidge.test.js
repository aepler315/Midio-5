import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpaceRidge, projectWireframe, ICO_VERTS, ICO_EDGES } from '../src/world/SpaceRidge.js';

test('node band assignment: 24 nodes, treble-weighted, deterministic per seed', () => {
  const a = new SpaceRidge(5);
  const b = new SpaceRidge(5);
  const c = new SpaceRidge(99);
  assert.equal(a.nodes.length, 24);
  const trebleCount = a.nodes.filter((n) => n.band >= 4).length;
  assert.ok(trebleCount / a.nodes.length >= 0.55, `expected treble-heavy assignment, got ${trebleCount}/24`);
  assert.deepEqual(a.nodes.map((n) => n.band), b.nodes.map((n) => n.band), 'same seed -> same bands');
  assert.notDeepEqual(a.nodes.map((n) => n.band), c.nodes.map((n) => n.band));
  for (const n of a.nodes) assert.ok(n.band >= 0 && n.band <= 6);
});

test('levels stay in [0,1], finite, after many random-band updates', () => {
  const ridge = new SpaceRidge(3);
  let t = 0;
  for (let i = 0; i < 600; i++) {
    const bands = Array.from({ length: 7 }, () => Math.random());
    ridge.update(t, 0.016, bands);
    t += 16;
  }
  for (const n of ridge.nodes) {
    assert.ok(Number.isFinite(n.level));
    assert.ok(n.level >= 0 && n.level <= 1 + 1e-6);
  }
});

test('attack is faster than release (step response)', () => {
  const up = new SpaceRidge(1);
  const bandUp = [1, 1, 1, 1, 1, 1, 1];
  up.update(0, 0.02, bandUp);
  const levelAfterAttackStep = up.nodes[0].level;

  const down = new SpaceRidge(1);
  for (let i = 0; i < 50; i++) down.update(i * 16, 0.016, bandUp); // saturate to ~1
  const bandDown = [0, 0, 0, 0, 0, 0, 0];
  down.update(800, 0.02, bandDown);
  const levelAfterReleaseStep = down.nodes[0].level; // should still be near 1 (slow release)

  assert.ok(levelAfterAttackStep > 0.3, `attack should move quickly, got ${levelAfterAttackStep}`);
  assert.ok(levelAfterReleaseStep > 0.5, `release should move slowly, got ${levelAfterReleaseStep}`);
});

test('flashes fire on a big jump and drain within their life window', () => {
  const ridge = new SpaceRidge(2);
  ridge.update(0, 0.016, [0, 0, 0, 0, 0, 0, 0]);
  ridge.update(100, 0.1, [1, 1, 1, 1, 1, 1, 1]); // big jump (large dt) for every node
  assert.ok(ridge._flashes.length > 0, 'a big jump should register a flash');
  ridge.update(500, 0.016, [1, 1, 1, 1, 1, 1, 1]); // 400ms later, past FLASH_LIFE_MS=300
  assert.equal(ridge._flashes.length, 0, 'flashes should have drained');
});

test('projectWireframe: finite coordinates, edge count preserved, full rotation is near-identity', () => {
  const p0 = projectWireframe(ICO_VERTS, ICO_EDGES, 0, 0, 10);
  assert.equal(p0.edges.length, ICO_EDGES.length);
  for (const pt of p0.points) assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y));

  const pFull = projectWireframe(ICO_VERTS, ICO_EDGES, Math.PI * 2, Math.PI * 2, 10);
  for (let i = 0; i < p0.points.length; i++) {
    assert.ok(Math.abs(p0.points[i].x - pFull.points[i].x) < 1e-6);
    assert.ok(Math.abs(p0.points[i].y - pFull.points[i].y) < 1e-6);
  }
  assert.ok(ICO_EDGES.length >= 12, 'icosahedron should have a reasonable edge count');
});
