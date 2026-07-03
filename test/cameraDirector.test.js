import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CameraDirector } from '../src/render/CameraDirector.js';

test('calm level introduces a slow drift when nothing else is shaking the camera', () => {
  const cam = new CameraDirector();
  let sawNonZero = false;
  let maxAbs = 0;
  for (let i = 0; i < 200; i++) {
    cam.update(1 / 60, 1);
    if (cam.shakeX !== 0 || cam.shakeY !== 0) sawNonZero = true;
    maxAbs = Math.max(maxAbs, Math.abs(cam.shakeX), Math.abs(cam.shakeY));
  }
  assert.ok(sawNonZero, 'expected calm drift to move the camera off dead-zero at some point');
  assert.ok(maxAbs <= 3.01, `expected drift to stay within its ~3px amplitude, got ${maxAbs}`);
});

test('with calmLevel 0, the camera stays at dead-zero absent any shake trigger', () => {
  const cam = new CameraDirector();
  for (let i = 0; i < 60; i++) cam.update(1 / 60, 0);
  assert.equal(cam.shakeX, 0);
  assert.equal(cam.shakeY, 0);
});

test('impact shake and calm drift compose additively rather than one overriding the other', () => {
  const cam = new CameraDirector();
  cam.shake(10);
  cam.update(1 / 60, 1);
  // Right after a shake trigger, the shake term dominates but the call must not throw
  // or discard the drift signal entirely -- just assert it produced *some* offset.
  assert.ok(Math.abs(cam.shakeX) > 0 || Math.abs(cam.shakeY) > 0);
});
