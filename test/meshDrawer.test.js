import { test } from 'node:test';
import assert from 'node:assert/strict';
import { radialMesh, mergeMeshes } from '../src/render/meshes.js';
import { computeRestLengths, applyTransform, drawMeshEdges, drawMeshPart } from '../src/render/MeshDrawer.js';

function mockCtx() {
  const calls = { stroke: 0, moveTo: [], lineTo: [] };
  return {
    calls,
    strokeStyle: null,
    lineWidth: null,
    beginPath() {},
    moveTo(x, y) { calls.moveTo.push([x, y]); },
    lineTo(x, y) { calls.lineTo.push([x, y]); },
    stroke() { calls.stroke++; },
  };
}

test('radialMesh produces one center + n rim vertices and 2n edges', () => {
  const m = radialMesh(10, 10, 8);
  assert.equal(m.vertices.length, 9);
  assert.equal(m.edges.length, 16); // 8 spokes + 8 rim
});

test('mergeMeshes offsets edge indices so each sub-mesh stays internally consistent', () => {
  const a = radialMesh(5, 5, 4);
  const b = radialMesh(3, 3, 3);
  const { mesh, offsets } = mergeMeshes([a, b]);
  assert.equal(offsets[0], 0);
  assert.equal(offsets[1], a.vertices.length);
  assert.equal(mesh.vertices.length, a.vertices.length + b.vertices.length);
  // every edge index must reference a valid merged vertex
  for (const [i, j] of mesh.edges) {
    assert.ok(i >= 0 && i < mesh.vertices.length);
    assert.ok(j >= 0 && j < mesh.vertices.length);
  }
});

test('computeRestLengths matches direct distance calculation', () => {
  const mesh = { vertices: [{ x: 0, y: 0 }, { x: 3, y: 4 }], edges: [[0, 1]] };
  const lengths = computeRestLengths(mesh);
  assert.equal(lengths[0], 5);
});

test('applyTransform: pure translation moves a point by (tx,ty)', () => {
  const p = applyTransform({ x: 1, y: 2 }, { tx: 10, ty: 20 });
  assert.equal(p.x, 11);
  assert.equal(p.y, 22);
});

test('applyTransform: scale is applied before rotation/translation (matches canvas composition order)', () => {
  // Scale x2 then rotate 90deg (pi/2): (1,0) -> scaled (2,0) -> rotated (0,2) -> translated.
  const p = applyTransform({ x: 1, y: 0 }, { tx: 5, ty: 5, rot: Math.PI / 2, scaleX: 2, scaleY: 2 });
  assert.ok(Math.abs(p.x - 5) < 1e-9);
  assert.ok(Math.abs(p.y - 7) < 1e-9);
});

test('applyTransform: rigid rotation preserves edge length (no false deformation glow from rotation alone)', () => {
  const mesh = { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }], edges: [[0, 1]] };
  const rest = computeRestLengths(mesh);
  const pts = mesh.vertices.map((v) => applyTransform(v, { rot: 0.7 }));
  const len = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  assert.ok(Math.abs(len - rest[0]) < 1e-9);
});

test('drawMeshEdges strokes exactly one segment per edge when there is no deformation glow', () => {
  const mesh = radialMesh(10, 10, 6);
  const rest = computeRestLengths(mesh);
  const points = mesh.vertices; // identity transform -> zero deformation
  const ctx = mockCtx();
  drawMeshEdges(ctx, mesh, rest, points, 40);
  assert.equal(ctx.calls.stroke, mesh.edges.length);
});

test('drawMeshEdges adds an extra glow stroke pass for edges that have visibly deformed', () => {
  const mesh = { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }], edges: [[0, 1]] };
  const rest = computeRestLengths(mesh); // 10
  const stretched = [{ x: 0, y: 0 }, { x: 30, y: 0 }]; // 3x length -> big deformation
  const ctx = mockCtx();
  drawMeshEdges(ctx, mesh, rest, stretched, 40);
  assert.equal(ctx.calls.stroke, 2); // glow pass + main pass
});

test('drawMeshPart end-to-end: a squashed mesh (scaleY<1) produces visible per-edge deformation', () => {
  const mesh = radialMesh(20, 20, 8);
  const rest = computeRestLengths(mesh);
  const ctx = mockCtx();
  const points = drawMeshPart(ctx, mesh, rest, { tx: 100, ty: 100, scaleX: 1.3, scaleY: 0.7 }, 40);
  assert.equal(points.length, mesh.vertices.length);
  assert.ok(ctx.calls.stroke > mesh.edges.length, 'squash/stretch should trigger at least one glow pass');
});

// --- displaceMeshRadial (resonance geometry) ---
import { displaceMeshRadial } from '../src/render/MeshDrawer.js';
import { ModalRing } from '../src/render/oscillators.js';

test('displaceMeshRadial returns the mesh untouched when the field is silent', () => {
  const mesh = radialMesh(10, 10, 6);
  const ring = new ModalRing({ seed: 3 }); // never excited -> energy 0
  assert.equal(displaceMeshRadial(mesh, 0, 0, ring), mesh);
  assert.equal(displaceMeshRadial(mesh, 0, 0, null), mesh);
});

test('displaceMeshRadial moves rim vertices radially but never the hub', () => {
  const mesh = radialMesh(10, 10, 6, 0, -20);
  const ring = new ModalRing({ seed: 3 });
  ring.excite(4);
  const out = displaceMeshRadial(mesh, 0, -20, ring);
  assert.notEqual(out, mesh);

  // Hub (vertex 0, at the center) must be untouched.
  assert.deepEqual(out.vertices[0], mesh.vertices[0]);

  let anyMoved = false;
  for (let i = 1; i < mesh.vertices.length; i++) {
    const orig = mesh.vertices[i], moved = out.vertices[i];
    // Displacement must be purely radial: the angle from the hub is preserved.
    const angOrig = Math.atan2(orig.y + 20, orig.x);
    const angMoved = Math.atan2(moved.y + 20, moved.x);
    assert.ok(Math.abs(angOrig - angMoved) < 1e-9, 'vertex angle about the hub must not change');
    if (Math.hypot(moved.x - orig.x, moved.y - orig.y) > 0.01) anyMoved = true;
  }
  assert.ok(anyMoved, 'an excited field should visibly displace at least one rim vertex');
});

test('displaceMeshRadial keeps displacement bounded by the field energy', () => {
  const mesh = radialMesh(12, 12, 8);
  const ring = new ModalRing({ seed: 3 });
  ring.excite(6);
  const out = displaceMeshRadial(mesh, 0, 0, ring);
  for (let i = 1; i < mesh.vertices.length; i++) {
    const orig = mesh.vertices[i], moved = out.vertices[i];
    const shift = Math.hypot(moved.x - orig.x, moved.y - orig.y);
    assert.ok(shift <= ring.energy + 1e-9);
  }
});
