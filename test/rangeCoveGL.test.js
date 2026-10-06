import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import { sceneUniforms } from '../src/world/alpine/TerrainMaterial.js';
import { CoveGL, COVE_GPU_BYTES, COVE_VERT, COVE_FRAG, COVE_DEPTH_FRAG } from '../src/world/alpine/CoveGL.js';

function layout({ maximal = false } = {}) {
  return {
    id: 'test-cove', band: 'mid', waterLevelM: 825,
    anchors: { midio: [-700, 825, -6220], broshi: [-520, 825.05, -6080], midasus: [-380, 889, -5940] },
    heights: { midio: 28, broshi: 35, midasus: 22 }, ground: { midio: 825, broshi: 825.05, midasus: 831 },
    right: [-1, 0, 0], forward: [0, 0, 1],
    dressing: {
      rocks: Array.from({ length: maximal ? 12 : 2 }, (_, i) => ({ positionM: [-515 + i * 5, 825.2, -6090], radiusM: 7, heightM: 5 })),
      reeds: Array.from({ length: maximal ? 8 : 2 }, (_, i) => ({ positionM: [-705 + i * 7, 825, -6234], heightM: 8, spreadM: 6 })),
      pine: { positionM: [-397, 831, -5983], heightM: 70, widthM: 36 },
    },
  };
}

function pose(l, { lean = 0, turn = 0 } = {}) {
  return {
    timeMs: 1234, reducedMotion: false, reducedFlash: false,
    actors: Object.entries(l.anchors).map(([id, positionM]) => ({ id, positionM: [...positionM],
      heightM: l.heights[id], leanRad: lean, turnRad: turn, tailAngle: .1, jawOpen: .2, glow: .3,
      babies: id === 'midasus' ? [0, 1, 2].map(i => ({ positionM: [-375 + i * 5, 890 + i * 3, -5950 + i], heightM: 3, rotationRad: .2 })) : undefined,
    })),
    waterResponse: { bass: .2, rhythm: .3, melody: .4, wake: .1 },
  };
}

test('the whole cove fits its reservation using the shipped runtime and shared geometry', () => {
  const cove = new CoveGL(THREE, sceneUniforms(THREE, {}), layout({ maximal: true }));
  try {
    assert.ok(cove.gpuBytes > 10000);
    assert.ok(cove.gpuBytes <= COVE_GPU_BYTES);
    let bytes = 0;
    for (const geometry of cove.geometries) {
      assert.ok(geometry.attributes.position.count > 0);
      for (const attribute of Object.values(geometry.attributes)) {
        assert.ok(attribute.array.every(Number.isFinite), 'no corrupt vertices or normals');
        bytes += attribute.array.byteLength;
      }
    }
    assert.equal(cove.gpuBytes, bytes);
    assert.equal(cove.actors.midasus.babies[0].mesh.geometry, cove.actors.midasus.babies[2].mesh.geometry,
      'companions share one buffer allocation');
    assert.equal(cove.group.children.length, 6 + 12 + 8 + 1 + 1);
  } finally { cove.dispose(); }
});

test('every opaque cove surface participates in global and travel depth with identical transforms', () => {
  const shared = sceneUniforms(THREE, {}), cove = new CoveGL(THREE, shared, layout());
  try {
    for (const record of [...Object.values(cove.actors), ...cove.actors.midasus.babies, ...cove.dressing]) {
      assert.equal(record.depth.length, 2);
      assert.notEqual(record.depth[0], record.depth[1]);
      for (const depth of record.depth) {
        assert.equal(depth.geometry, record.mesh.geometry);
        assert.equal(depth.material.uniforms, record.mesh.material.uniforms);
        assert.equal(depth.material.colorWrite, false);
        assert.equal(depth.material.depthWrite, true);
        assert.equal(depth.material.side, THREE.DoubleSide);
      }
      assert.equal(record.mesh.material.depthWrite, false);
      assert.equal(record.mesh.material.depthFunc, THREE.LessEqualDepth);
      assert.equal(record.uniforms.uClipBelow, shared.uClipBelow);
      assert.equal(record.uniforms.uCameraPos, shared.uCameraPos);
      assert.equal(record.uniforms.uExposure, shared.uExposure);
    }
    assert.equal(cove.depthGroup.children.length, cove.group.children.length - 1, 'soft contact shadow never cuts a hole in another partition');
    assert.equal(cove.bandDepthGroup.children.length, cove.depthGroup.children.length);
    assert.equal(cove.contact.mesh.material.transparent, true);
  } finally { cove.dispose(); }
});

test('inhabitants keep world roots and basis through gestures and backwards updates', () => {
  const l = layout(), cove = new CoveGL(THREE, sceneUniforms(THREE, {}), l);
  try {
    const first = pose(l), moved = pose(l, { lean: .025, turn: .08 });
    moved.timeMs = 10000;
    cove.update(first);
    const root = cove.actors.broshi.uniforms.uRoot.value.toArray();
    cove.update(moved);
    assert.deepEqual(cove.actors.broshi.uniforms.uRoot.value.toArray(), root);
    assert.equal(cove.actors.broshi.uniforms.uLean.value, .025);
    assert.equal(cove.actors.broshi.uniforms.uGrounded.value, 1);
    assert.equal(cove.actors.midio.uniforms.uGrounded.value, 0, 'waterline follows the lake instead of deforming dry ground');
    assert.deepEqual(cove.actors.midio.uniforms.uRoot.value.toArray(), l.anchors.midio);
    for (const record of cove.dressing) assert.equal(record.uniforms.uGrounded.value, 1);
    cove.update(first);
    assert.equal(cove.snapshot, first);
    assert.equal(cove.actors.broshi.uniforms.uLean.value, 0);
    assert.deepEqual(cove.actors.broshi.uniforms.uRight.value.toArray(), l.right);
    assert.deepEqual(cove.actors.broshi.uniforms.uForward.value.toArray(), l.forward);
    assert.deepEqual(cove.actors.midasus.babies[1].uniforms.uRoot.value.toArray(), first.actors[2].babies[1].positionM);
    const positions = cove.actors.midio.mesh.geometry.attributes.position.array;
    const ys = Array.from({ length: positions.length / 3 }, (_, i) => positions[i * 3 + 1]);
    assert.ok(Math.min(...ys) < -.23 && Math.max(...ys) > .75, 'Midio crosses the real water plane');
  } finally { cove.dispose(); }
});

test('missing actors and companions stop writing depth, without stale poses after a seek', () => {
  const l = layout(), cove = new CoveGL(THREE, sceneUniforms(THREE, {}), l);
  try {
    cove.update(pose(l));
    assert.equal(cove.actors.midasus.babies[2].mesh.visible, true);
    cove.update({ actors: [] });
    for (const record of [...Object.values(cove.actors), ...cove.actors.midasus.babies]) {
      assert.equal(record.mesh.visible, false);
      assert.ok(record.depth.every(mesh => mesh.visible === false));
    }
    cove.update(pose(l));
    assert.equal(cove.actors.midio.mesh.visible, true);
    assert.ok(cove.actors.midio.depth.every(mesh => mesh.visible));
  } finally { cove.dispose(); }
});

test('color and depth share mirror clipping, and grounded roots use the terrain field', () => {
  assert.match(COVE_VERT, /root\.y \+= uGrounded \* deformAt\(uRoot\)/);
  for (const shader of [COVE_FRAG, COVE_DEPTH_FRAG]) assert.match(shader, /if \(vWorld\.y < uClipBelow\) discard/);
  assert.match(COVE_FRAG, /mistAmount\(uCameraPos, vWorld\)/);
  assert.match(COVE_FRAG, /lit \* uExposure/);
  assert.doesNotMatch(COVE_VERT, /viewMatrix\[[0-9]|cameraPosition/);
});

test('disposal retires each owned buffer and material once, leaving shared resources intact', () => {
  const shared = sceneUniforms(THREE, {}), cove = new CoveGL(THREE, shared, layout());
  const counts = new Map();
  const owned = [...cove.geometries, ...cove.materials];
  for (const resource of owned) resource.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) || 0) + 1));
  const parent = new THREE.Group(); parent.add(cove.group, cove.depthGroup, cove.bandDepthGroup);
  cove.dispose(); cove.dispose(); cove.update(pose(layout()));
  assert.equal(counts.size, owned.length);
  assert.ok([...counts.values()].every(n => n === 1));
  assert.equal(parent.children.length, 0);
  assert.equal(cove.snapshot, null);
  assert.ok(shared.uCameraPos.value.isVector3);
  assert.ok(shared.uClipBelow.value < -1e8);
});

test('Broshi head articulation moves solid faces, luminous edges, and both depth passes together', () => {
  const l = layout(), cove = new CoveGL(THREE, sceneUniforms(THREE, {}), l);
  try {
    const snapshot = pose(l);
    snapshot.actors.find(a => a.id === 'broshi').headAngle = .25;
    cove.update(snapshot);
    const broshi = cove.actors.broshi;
    assert.equal(broshi.mesh.material.uniforms.uHead.value, .25);
    assert.ok([...broshi.mesh.geometry.attributes.aJoint.array].filter(j => j === 3).length > 30);
    assert.ok(broshi.depth.every(mesh => mesh.material.uniforms.uHead === broshi.mesh.material.uniforms.uHead));
  } finally { cove.dispose(); }
});
