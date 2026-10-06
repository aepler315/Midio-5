import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import * as camera from '../src/world/alpine/RangeCamera.js';
import { RangeScene } from '../src/world/alpine/RangeScene.js';
import { RangePresentation } from '../src/world/alpine/RangePresentation.js';
import { buildRangeFrame, viewportState } from '../src/world/alpine/RangeFrame.js';
import { cameraPoseAt, cameraBasis } from '../src/world/terrain/SceneTravel.js';
import { mirrorCameraFor } from '../src/world/alpine/WaterMirror.js';
import catalog from '../src/world/terrain/sceneCatalogData.js';
import { LerpCache } from '../src/utils/color.js';
import { loadShippedTerrain } from '../tools/lib/range-exposure.mjs';
import { terrainHeightAt } from '../src/world/alpine/TerrainMesh.js';
import { fileURLToPath } from 'node:url';

const view = catalog.views.find(v => v.id === 'muncho-lake-south');
const vp = viewportState({ logicalWidth: 1408, logicalHeight: 848,
  nominalWidth: 1280, nominalHeight: 720, backingWidth: 1408, backingHeight: 848, overscanPx: 64 });
const frameAt = (progress01, extra = {}) => ({ performance: true, progress01,
  scenicViewport: vp, cameraMove: { yaw: .06, dolly: .16, crane: .035, truck: .025 }, ...extra });
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} != ${b}`));

test('performance camera keeps one direction and height while travelling inside the approved rail', () => {
  assert.equal(typeof camera.performanceCameraPose, 'function');
  const first = camera.performanceCameraPose(view, 0);
  const forward = cameraBasis(first).forward;
  for (let k = 0; k <= 20; k++) {
    const pose = camera.performanceCameraPose(view, k / 20);
    near(cameraBasis(pose).forward, forward);
    assert.equal(pose.eyeM[1], first.eyeM[1]);
    assert.equal(pose.targetM[1], first.targetM[1]);
    for (const axis of [0, 2]) {
      assert.ok(pose.eyeM[axis] >= Math.min(view.camera.eyeStartM[axis], view.camera.eyeEndM[axis]));
      assert.ok(pose.eyeM[axis] <= Math.max(view.camera.eyeStartM[axis], view.camera.eyeEndM[axis]));
    }
  }
  assert.notDeepEqual(first.eyeM, camera.performanceCameraPose(view, 1).eyeM);
  assert.deepEqual(camera.performanceCameraPose(view, -1), first);
  assert.deepEqual(camera.performanceCameraPose(view, 2), camera.performanceCameraPose(view, 1));
});

test('performance rail freezes with reduced motion and reconstructs after backward seek', () => {
  assert.equal(typeof camera.rangeRailPose, 'function');
  const start = camera.rangeRailPose(view, frameAt(0, { reducedMotion: true }));
  assert.deepEqual(start, camera.rangeRailPose(view, frameAt(1, { reducedMotion: true })));
  const at = u => camera.rangeRailPose(view, frameAt(u));
  const before = at(.37);
  at(.99); at(.02);
  assert.deepEqual(at(.37), before);
  assert.deepEqual(camera.rangeRailPose(view, frameAt(.37, { performance: false })), cameraPoseAt(view, .37));
});

function bareScene() {
  const scene = Object.create(RangeScene.prototype);
  Object.assign(scene, { THREE, prepared: new Map(), _movedPoses: new WeakMap(), camera: new THREE.PerspectiveCamera() });
  return scene;
}

test('terrain and sky share the lateral pose and ignore section orbit/dolly/crane', () => {
  assert.equal(typeof camera.performanceCameraPose, 'function');
  const scene = bareScene(), frame = frameAt(.72);
  const moved = scene.movedPose(view, frame);
  assert.deepEqual(moved.pose.eyeM, camera.performanceCameraPose(view, .72).eyeM);
  assert.deepEqual(moved.pose.targetM, camera.performanceCameraPose(view, .72).targetM);
  const presentation = Object.create(RangePresentation.prototype);
  presentation.scene = scene;
  near(Object.values(presentation._skyPan(view, null, frame)), [0, 0]);
  presentation.scene = {};
  near(Object.values(presentation._skyPan(view, null, frame)), [0, 0]);
  assert.strictEqual(scene.movedPose(view, frame).pose, moved.pose, 'one cached pose owns all passes');
});

test('reflection uses the rendered lateral camera and retains listener zoom', () => {
  assert.equal(typeof camera.performanceCameraPose, 'function');
  const scene = bareScene(), frame = frameAt(.72, { userCamera: { fx: .12, rx: .02, uy: 0 } });
  const pose = scene._setCamera(view, frame);
  assert.notDeepEqual(pose.eyeM, camera.performanceCameraPose(view, .72).eyeM);
  near(scene.camera.position.toArray(), pose.eyeM);
  near(new THREE.Vector3(0, 0, -1).applyQuaternion(scene.camera.quaternion).toArray(), cameraBasis(pose).forward);
  const mirror = new THREE.PerspectiveCamera(), level = 820;
  mirrorCameraFor(THREE, scene.camera, level, mirror);
  near(mirror.position.toArray(), [pose.eyeM[0], 2 * level - pose.eyeM[1], pose.eyeM[2]]);
  assert.deepEqual(mirror.projectionMatrix.elements, scene.camera.projectionMatrix.elements);
});

function simulation(performance) {
  const profile = { name: 'TAIGA', sky: ['#102030', '#304050', '#607080'] };
  return { presentation: { trioStage: performance }, songSeed: 42, stageW: 1280,
    rangeNarrative: { durationMs: 180000, sample: () => ({ sources: {
      midio: { activity: .6 }, broshi: { activity: .4 }, midasus: { activity: .5 } } }) },
    biomes: { tSec: 60, durationMs: 180000, _dayNightCycleMs: 240000,
      energyCurves: { globalEnergyNorm: () => .6 }, sections: [{ startMs: 0, relEnergy01: .6 }],
      currentBlend: { from: 'TAIGA', to: 'TAIGA', t: 1 }, world: {},
      _profile: () => profile, _rotated: c => c, lerpCache: new LerpCache(), _airColor: '#556677' } };
}

test('performance snapshot declares camera ownership and suppresses old actor owners without changing land or light', () => {
  const inputs = { frameId: 1, pose: { worldX: 1000, midioX: 400 }, scenicViewport: vp, groundViewport: vp };
  const landscape = buildRangeFrame({ ...inputs, sim: simulation(false) });
  const performance = buildRangeFrame({ ...inputs, sim: simulation(true) });
  assert.equal(performance.performance, true);
  assert.equal(landscape.performance, false);
  assert.deepEqual(performance.cameraMove, camera.NEUTRAL_MOVE);
  assert.equal(performance.actors, null);
  assert.ok(landscape.actors.presence > .99, 'the same source still owns scenery-only figures');
  assert.deepEqual(performance.music, landscape.music);
  assert.deepEqual(performance.light, landscape.light);
  assert.ok(Object.isFrozen(performance));
});

test('listener zoom stops above the real Muncho terrain from every lateral station', async () => {
  const data = await loadShippedTerrain(fileURLToPath(new URL('../src/assets/range/v2/', import.meta.url)), view);
  const scene = bareScene();
  scene.prepared.set(view.id, { data, waterLevelM: 820 });
  for (let i = 0; i <= 20; i++) {
    const frame = frameAt(i / 20, { userCamera: { fx: camera.USER_FX_MAX, rx: 0, uy: -.1 } });
    const pose = scene.movedPose(view, frame).pose;
    const ground = Math.max(820, terrainHeightAt(data, pose.eyeM[0], pose.eyeM[2]));
    assert.ok(pose.eyeM[1] - ground >= 49.99, `${i}: camera must clear the geographic surface`);
    assert.ok(pose.userScale >= 0 && pose.userScale <= 1);
  }
});
