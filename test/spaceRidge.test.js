import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SpaceRidge, projectWireframe, ICO_VERTS, ICO_EDGES, N_NODES, nodeXFrac,
  tidalOffset, TIDAL_AMPLITUDE_FRAC,
} from '../src/world/SpaceRidge.js';

test('node band assignment: 30 nodes (+3 joints each edge), treble-weighted, deterministic', () => {
  const a = new SpaceRidge(5);
  const b = new SpaceRidge(5);
  const c = new SpaceRidge(99);
  assert.equal(N_NODES, 30);
  assert.equal(a.nodes.length, 30);
  const trebleCount = a.nodes.filter((n) => n.band >= 4).length;
  assert.ok(trebleCount / a.nodes.length >= 0.55, `expected treble-heavy assignment, got ${trebleCount}/26`);
  assert.deepEqual(a.nodes.map((n) => n.band), b.nodes.map((n) => n.band), 'same seed -> same bands');
  assert.notDeepEqual(a.nodes.map((n) => n.band), c.nodes.map((n) => n.band));
  for (const n of a.nodes) assert.ok(n.band >= 0 && n.band <= 6);
});

test('nodeXFrac extends three joints past each screen edge', () => {
  assert.ok(nodeXFrac(0) < 0, 'leftmost joint sits past the left edge');
  assert.ok(nodeXFrac(N_NODES - 1) > 1, 'rightmost joint sits past the right edge');
  assert.ok(Math.abs(nodeXFrac(3)) < 0.08, 'first on-screen-ish joint near 0');
  assert.ok(Math.abs(nodeXFrac(N_NODES - 4) - 1) < 0.08, 'last on-screen-ish joint near 1');
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

test('draw() no longer takes a worldX -- the structure never scrolls with the world', () => {
  // Regression for "ends 6-7 joints short after a few minutes": the old
  // draw(ctx, canvas, worldX, ...) translated every sample by worldX*PARALLAX.
  // The signature itself is now the guarantee -- draw() has no worldX
  // parameter at all, so nothing can reintroduce that drift.
  assert.equal(SpaceRidge.prototype.draw.length, 4, 'draw(ctx, canvas, color, tSec, reducedFlash=false) -- no worldX');
});

test('tidalOffset stays within its amplitude bound across a long time sweep', () => {
  const canvasHeight = 720;
  const bound = TIDAL_AMPLITUDE_FRAC * canvasHeight;
  for (let tSec = 0; tSec < 6000; tSec += 7.3) {
    const off = tidalOffset(tSec, canvasHeight);
    assert.ok(Number.isFinite(off));
    assert.ok(Math.abs(off) <= bound + 1e-9, `tidal offset ${off} exceeded bound ${bound} at t=${tSec}`);
  }
});

test('a node under sustained band energy eases its depth (z) toward 1; a quiet node stays near 0', () => {
  const ridge = new SpaceRidge(11);
  const loudBand = ridge.nodes[0].band;
  const bands = new Array(7).fill(0);
  bands[loudBand] = 1;
  let t = 0;
  for (let i = 0; i < 300; i++) { ridge.update(t, 0.016, bands); t += 16; }
  assert.ok(ridge.nodes[0].z > 0.7, `expected node under sustained energy to push toward z=1, got ${ridge.nodes[0].z}`);

  const quiet = new SpaceRidge(11);
  let t2 = 0;
  for (let i = 0; i < 300; i++) { quiet.update(t2, 0.016, new Array(7).fill(0)); t2 += 16; }
  assert.ok(quiet.nodes[0].z < 0.05, `expected a silent node to stay near z=0, got ${quiet.nodes[0].z}`);
});
