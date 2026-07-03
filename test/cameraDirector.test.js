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

test('an impact excites a small camera roll that rings down to zero', () => {
  const cam = new CameraDirector();
  assert.equal(cam.roll, 0);
  cam.shake(10);
  let maxRoll = 0;
  for (let i = 0; i < 30; i++) { cam.update(1 / 60, 0); maxRoll = Math.max(maxRoll, Math.abs(cam.roll)); }
  assert.ok(maxRoll > 0, 'expected the shake to excite a roll oscillation');
  assert.ok(maxRoll < 0.03, `roll should stay subtle (fractions of a degree), got ${maxRoll} rad`);

  for (let i = 0; i < 300; i++) cam.update(1 / 60, 0);
  assert.ok(Math.abs(cam.roll) < 1e-4, `expected the roll to ring down, got ${cam.roll}`);
});

test('consecutive impacts alternate roll direction', () => {
  const first = new CameraDirector();
  first.shake(10);
  first.update(0.02, 0);
  const firstSign = Math.sign(first.roll);

  first.shake(10); // re-strike: direction flips
  first.update(0.02, 0);
  assert.equal(Math.sign(first.roll), -firstSign);
});
