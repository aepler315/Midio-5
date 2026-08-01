import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getReducedFlash, setReducedFlash, capFlashAlpha, FLASH_CAP } from '../src/ui/Accessibility.js';
import { computeLight } from '../src/render/LightField.js';

test('getReducedFlash defaults to false when no persisted value exists (or storage is unavailable)', () => {
  // Node has no localStorage global; getReducedFlash must degrade to false
  // rather than throwing.
  assert.equal(getReducedFlash(), false);
});

test('setReducedFlash does not throw even with no persistent storage available', () => {
  assert.doesNotThrow(() => setReducedFlash(true));
  assert.doesNotThrow(() => setReducedFlash(false));
});

test('capFlashAlpha passes alpha through untouched when reducedFlash is off', () => {
  assert.equal(capFlashAlpha(0.9, false), 0.9);
  assert.equal(capFlashAlpha(1, false), 1);
  assert.equal(capFlashAlpha(0.1, false), 0.1);
});

test('capFlashAlpha caps at FLASH_CAP (0.4) when reducedFlash is on', () => {
  assert.equal(capFlashAlpha(0.9, true), FLASH_CAP);
  assert.equal(capFlashAlpha(1, true), FLASH_CAP);
  assert.equal(capFlashAlpha(0.7, true), FLASH_CAP);
});

test('capFlashAlpha never raises a value that was already below the cap', () => {
  assert.equal(capFlashAlpha(0.1, true), 0.1);
  assert.equal(capFlashAlpha(0.39, true), 0.39);
  assert.equal(capFlashAlpha(0, true), 0);
});

test('capFlashAlpha at exactly FLASH_CAP is a no-op either way', () => {
  assert.equal(capFlashAlpha(FLASH_CAP, true), FLASH_CAP);
  assert.equal(capFlashAlpha(FLASH_CAP, false), FLASH_CAP);
});

// Movement VII: the celestial light doesn't produce a single flash to cap,
// but reducedFlash still has to damp how much it swings frame to frame.
test('reduced-flash mode narrows the celestial light\'s intensity swing across the song', () => {
  const commonArgs = { canvasWidth: 1280, canvasHeight: 720 };
  const normalLow = computeLight({ ...commonArgs, budget: 0, reducedFlash: false }).intensity;
  const normalHigh = computeLight({ ...commonArgs, budget: 1, reducedFlash: false }).intensity;
  const reducedLow = computeLight({ ...commonArgs, budget: 0, reducedFlash: true }).intensity;
  const reducedHigh = computeLight({ ...commonArgs, budget: 1, reducedFlash: true }).intensity;
  assert.ok((reducedHigh - reducedLow) < (normalHigh - normalLow));
});
