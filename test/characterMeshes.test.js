import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shardMesh, MIDIO_BODY, MIDIO_EYE, MIDIO_MESH,
  BROSHI_BODY, BROSHI_HEAD, BROSHI_JAW, BROSHI_TAIL, MIDASUS_MESH,
} from '../src/render/meshes.js';

function rimRadii(mesh) {
  const hub = mesh.vertices[0];
  return mesh.vertices.slice(1).map((v) => Math.hypot(v.x - hub.x, v.y - hub.y));
}

function coefficientOfVariation(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

test('every mesh has valid edge indices and a hub at vertex 0', () => {
  for (const mesh of [MIDIO_BODY, MIDIO_EYE, MIDIO_MESH, BROSHI_BODY, BROSHI_HEAD, BROSHI_JAW, BROSHI_TAIL, MIDASUS_MESH]) {
    for (const [i, j] of mesh.edges) {
      assert.ok(i >= 0 && i < mesh.vertices.length);
      assert.ok(j >= 0 && j < mesh.vertices.length);
      assert.notEqual(i, j);
    }
  }
  // The displaceable bodies anchor modal vibration at vertex 0: every rim
  // vertex must sit clearly away from it so radial displacement is defined.
  for (const mesh of [MIDIO_BODY, BROSHI_BODY, MIDASUS_MESH]) {
    for (const r of rimRadii(mesh)) assert.ok(r > 4, `rim vertex too close to hub: ${r}`);
  }
});

test('the glyphs are irregular shards, not wheels: rim radius variation is high', () => {
  // A perfect circle has coefficient of variation 0; the old cartoon
  // wheels were exactly that. The new silhouettes must stay jagged.
  assert.ok(coefficientOfVariation(rimRadii(MIDIO_BODY)) > 0.12,
    `Midio reads too round: cv=${coefficientOfVariation(rimRadii(MIDIO_BODY)).toFixed(3)}`);
  assert.ok(coefficientOfVariation(rimRadii(BROSHI_BODY)) > 0.25,
    `Broshi reads too round: cv=${coefficientOfVariation(rimRadii(BROSHI_BODY)).toFixed(3)}`);
});

test('Midio keeps his physics footprint: 23px half-width, feet on the ground line', () => {
  let minY = Infinity, maxY = -Infinity;
  for (const v of MIDIO_BODY.vertices) {
    assert.ok(Math.abs(v.x) <= 23 + 1e-9, `vertex escapes the collision body at x=${v.x}`);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  assert.ok(Math.abs(maxY) < 1e-9, 'feet must rest exactly on y=0');
  assert.ok(minY < -50, 'the crown spike must give him real height');
});

test('the core sits centered on the blink axis the renderer scales around', () => {
  // Renderer scales MIDIO_EYE vertices toward MIDIO_EYE_CY = -31; the
  // core's own vertical center must match or the flicker drifts.
  const ys = MIDIO_EYE.vertices.map((v) => v.y);
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  assert.ok(Math.abs(centerY - -31) < 1.6, `core center y=${centerY}, blink axis is -31`);
});

test('Broshi jaw and tail stay 2-vertex lines (the draw code rebuilds them by index)', () => {
  assert.equal(BROSHI_JAW.vertices.length, 2);
  assert.deepEqual(BROSHI_JAW.edges, [[0, 1]]);
  assert.equal(BROSHI_TAIL.vertices.length, 2);
  assert.deepEqual(BROSHI_TAIL.edges, [[0, 1]]);
});

test('shardMesh builds ring + sparse spokes + braces with correct indexing', () => {
  const m = shardMesh({ x: 0, y: 0 }, [
    { x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }, { x: 0, y: -10 },
  ], { spokeEvery: 2, braces: [[0, 2]] });
  assert.equal(m.vertices.length, 5);
  // 4 ring edges + 2 spokes (rim 0 and 2) + 1 brace.
  assert.equal(m.edges.length, 7);
  for (const [i, j] of m.edges) assert.ok(i < 5 && j < 5);
});

test('Midasus is a hexagram: two closed triangles sharing no edges', () => {
  const tris = [MIDASUS_MESH.edges.slice(0, 3), MIDASUS_MESH.edges.slice(3, 6)];
  for (const tri of tris) {
    const verts = new Set(tri.flat());
    assert.equal(verts.size, 3, 'each triangle must close over exactly 3 vertices');
  }
  const [setA, setB] = tris.map((tri) => new Set(tri.flat()));
  for (const v of setA) assert.ok(!setB.has(v), 'the triangles must interlock, not touch');
});
