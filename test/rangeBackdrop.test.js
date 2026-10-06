import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/range/three-range.module.js';
import { backdropBounds, backdropWeight } from '../src/world/alpine/WaterMirror.js';
import { rangeHabitatCameraPose } from '../src/world/alpine/RangeHabitat.js';
import { scenicProjection } from '../src/world/alpine/RangeFrame.js';
import { RangeScene } from '../src/world/alpine/RangeScene.js';
import { sceneUniforms, SCENE_FRAG } from '../src/world/alpine/TerrainMaterial.js';

const viewport = { logicalWidth: 1408, logicalHeight: 848, nominalWidth: 1280, nominalHeight: 720, overscanPx: 64 };
const transform = { a: .5, d: .5, e: -32, f: -32 };
const expected = [64 / 1408, 64 / 848, 1 - 64 / 1408, 1 - 64 / 848];
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-12, `${a} != ${b}`));

test('backdrop validity excludes the transparent scenic overscan gutters', () => {
  const bounds = backdropBounds(viewport, transform, { width: 640, height: 360 });
  near(bounds, expected);
  assert.equal(backdropWeight([.5, .95], bounds), 0);
  assert.equal(backdropWeight([.5, .5], bounds), 1);
  assert.equal(backdropWeight([.02, .5], bounds), 0);
});

test('portrait output excludes opaque letterboxing as well as overscan', () => {
  const canvas = { width: 360, height: 640 }, scale = 360 / 1280;
  const portrait = { a: scale, d: scale, e: -64 * scale, f: (640 - 720 * scale) / 2 - 64 * scale };
  const bounds = backdropBounds(viewport, portrait, canvas);
  near(bounds, expected);
  assert.equal(backdropWeight([.5, .95], bounds, 1), 0, 'opaque black output bars are not valid sky');
  assert.equal(backdropWeight([.5, .05], bounds, 1), 0);
  const moved = backdropBounds(viewport, { ...transform, e: -22 }, { width: 640, height: 360 });
  near(moved, [22 / 704, expected[1], 662 / 704, expected[3]]);
});

test('the exact cove reflection cutoff at rows 246/247 fades into sky continuously', () => {
  const pose = rangeHabitatCameraPose({ id: 'muncho-lake-south' }, .02);
  const projection = scenicProjection(pose.fovYDeg, viewport);
  const camera = new THREE.PerspectiveCamera(projection.fovYDeg, projection.aspect, 20, 150000);
  camera.position.set(...pose.eyeM); camera.lookAt(...pose.targetM);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const uvAt = y => {
    const ray = new THREE.Vector3(0, 1 - 2 * (y * 2 + 64) / 848, .5).unproject(camera).sub(camera.position).normalize();
    const up = new THREE.Vector3(ray.x, Math.abs(ray.y), ray.z).normalize();
    const projected = camera.position.clone().addScaledVector(up, 60000).project(camera);
    return [(projected.x + 1) / 2, (projected.y + 1) / 2];
  };
  assert.ok(uvAt(246)[1] < expected[3]);
  assert.ok(uvAt(247)[1] > expected[3]);
  const weights = [230, 235, 240, 245, 246, 247, 248].map(y => backdropWeight(uvAt(y), expected));
  assert.ok(weights[0] > .9);
  assert.ok(weights.every((w, i) => i === 0 || w <= weights[i - 1]));
  assert.ok(weights[4] < .01, 'the last valid row contributes under 1%, avoiding the former abrupt black line');
  assert.equal(weights[5], 0);
  assert.equal(weights[6], 0);
});

test('missing, transparent and off-canvas backdrops have finite zero weight', () => {
  for (const bounds of [backdropBounds(null, null, null),
    backdropBounds(viewport, { ...transform, e: 1000 }, { width: 640, height: 360 }),
    backdropBounds(viewport, { ...transform, a: 0 }, { width: 640, height: 360 })]) {
    assert.deepEqual(bounds, [0, 0, 0, 0]);
    assert.equal(backdropWeight([.5, .5], bounds), 0);
  }
  assert.equal(backdropWeight([.5, .5], expected, 0), 0);
  assert.equal(backdropWeight([.5, .5], expected, .4), .4);
  assert.equal(backdropWeight([NaN, .5], expected), 0);
  const uniforms = sceneUniforms(THREE, {});
  assert.deepEqual(uniforms.uBackdropBounds.value.toArray(), [0, 0, 0, 0]);
  assert.equal(uniforms.uBackdropAmount.value, 0);
  assert.match(SCENE_FRAG, /captured\.a \* uBackdropAmount/);
  assert.match(SCENE_FRAG, /backdropUv - uBackdropBounds\.xy/);
  assert.match(SCENE_FRAG, /mix\(reflectedSky, capturedSky, capturedWeight\)/);
  assert.match(SCENE_FRAG, /max\(captured\.a, 0\.00001\)/);
});

test('capture and mirror binding carry picture validity for the same frame only', () => {
  const copied = [];
  const backdrop = { width: 352, height: 212, epoch: 0, texture: new THREE.Texture(),
    ctx: { clearRect() {}, drawImage(...args) { copied.push(args); } }, frame: -1 };
  const scene = Object.assign(Object.create(RangeScene.prototype), {
    THREE, size: { width: 704, height: 424 }, contextEpoch: 0,
    prepared: new Map([['cove', { mirrorLevelM: 825 }]]), backdrop,
  });
  const frame = { frameId: 12, qualityLevel: 0, scenicViewport: viewport };
  assert.equal(scene.captureBackdrop({ canvas: { width: 640, height: 360 }, getTransform: () => transform },
    { width: 1408, height: 848 }, frame), true);
  near(backdrop.bounds, expected);
  assert.equal(backdrop.frame, 12);
  assert.equal(copied.length, 1);
  const uniforms = sceneUniforms(THREE, {}), camera = new THREE.PerspectiveCamera(35, 16 / 9, 20, 150000);
  camera.position.set(0, 970, 0); camera.lookAt(0, 825, 1000); camera.updateMatrixWorld();
  const mirror = { target: { texture: new THREE.Texture() }, matrix: new THREE.Matrix4(), frame: -1 };
  Object.assign(scene, { camera, mirrorCamera: new THREE.PerspectiveCamera(), stats: {}, _ensureMirror: () => mirror,
    renderer: { setRenderTarget() {}, setClearColor() {}, clear() {}, render() {} } });
  const p = { uniforms, mirrorLevelM: 825, depthScene: {}, scenes: { far: {}, mid: {}, near: {} } };
  scene._prepareMirror(p, frame, 'A', 'cove');
  near(uniforms.uBackdropBounds.value.toArray(), expected);
  assert.equal(uniforms.uBackdropAmount.value, 1);
  scene._prepareMirror(p, { ...frame, frameId: 13 }, 'A', 'cove');
  assert.deepEqual(uniforms.uBackdropBounds.value.toArray(), [0, 0, 0, 0]);
  assert.equal(uniforms.uBackdropAmount.value, 0);
});

test('a newly allocated backdrop uploads premultiplied pixels for the reflection shader', () => {
  const originalCanvas = globalThis.OffscreenCanvas;
  class CaptureCanvas {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return { clearRect() {}, drawImage() {} }; }
  }
  const scene = Object.assign(Object.create(RangeScene.prototype), {
    THREE, size: { width: 704, height: 424 }, contextEpoch: 0,
    prepared: new Map([['cove', { mirrorLevelM: 825 }]]), backdrop: null,
  });
  globalThis.OffscreenCanvas = CaptureCanvas;
  try {
    assert.equal(scene.captureBackdrop({ canvas: { width: 640, height: 360 }, getTransform: () => transform },
      { width: 1408, height: 848 }, { frameId: 1, qualityLevel: 0, scenicViewport: viewport }), true);
    assert.equal(scene.backdrop.texture.premultiplyAlpha, true,
      'the shader divides sampled RGB by alpha, so upload must premultiply once');
    assert.equal(scene.backdrop.texture.image, scene.backdrop.canvas);
    assert.equal(scene.backdrop.frame, 1);
  } finally {
    scene.releaseBackdrop();
    if (originalCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originalCanvas;
  }
});
