import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldDrawFrame } from '../src/render/FrameCadence.js';
test('title and playback draw cadence allow the initial frame and respect the selected cap', () => {
  assert.equal(shouldDrawFrame(0, null, 30), true);
  assert.equal(shouldDrawFrame(16.7, 0, 30), false);
  assert.equal(shouldDrawFrame(33.4, 0, 30), true);
  assert.equal(shouldDrawFrame(16.7, 0, 60), true);
});
