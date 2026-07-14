import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contactShadow, SHADOW_FADE_HEIGHT_PX, SHADOW_WIDTH_FRAC, SHADOW_ASPECT,
  SHADOW_RX_MIN, SHADOW_RX_MAX, SHADOW_ALPHA_MAX,
} from '../src/world/ContactShadow.js';

test('grounded (heightAbove=0, and slightly negative) is the alpha/size ceiling', () => {
  for (const h of [0, -5, -0.01]) {
    const s = contactShadow(100, 480, h, 60);
    assert.equal(s.alpha, SHADOW_ALPHA_MAX);
    const expectedRx = Math.min(SHADOW_RX_MAX, Math.max(SHADOW_RX_MIN, 60 * SHADOW_WIDTH_FRAC));
    assert.ok(Math.abs(s.rx - expectedRx) < 1e-9, `h=${h}: rx ${s.rx} != ${expectedRx}`);
  }
});

test('fully faded at and beyond SHADOW_FADE_HEIGHT_PX', () => {
  for (const h of [SHADOW_FADE_HEIGHT_PX, SHADOW_FADE_HEIGHT_PX + 500]) {
    const s = contactShadow(100, 480, h, 60);
    assert.deepEqual(s, { cx: 100, cy: 480, rx: 0, ry: 0, alpha: 0 });
  }
});

test('alpha and rx are monotonically non-increasing as height rises, no discontinuity', () => {
  let prevAlpha = Infinity, prevRx = Infinity;
  for (let h = 0; h <= SHADOW_FADE_HEIGHT_PX + 20; h += 2) {
    const s = contactShadow(0, 0, h, 60);
    assert.ok(s.alpha <= prevAlpha + 1e-9, `alpha rose at h=${h}`);
    assert.ok(s.rx <= prevRx + 1e-9, `rx rose at h=${h}`);
    prevAlpha = s.alpha; prevRx = s.rx;
  }
});

test('ry/rx ratio is always exactly SHADOW_ASPECT regardless of height', () => {
  for (const h of [0, 20, 60, 100]) {
    const s = contactShadow(0, 0, h, 60);
    if (s.rx > 0) assert.ok(Math.abs(s.ry / s.rx - SHADOW_ASPECT) < 1e-9);
  }
});

test('width clamps both directions when grounded', () => {
  const tiny = contactShadow(0, 0, 0, 5);
  assert.equal(tiny.rx, SHADOW_RX_MIN);
  const huge = contactShadow(0, 0, 0, 500);
  assert.equal(huge.rx, SHADOW_RX_MAX);
});

test('cx/cy always equal the anchor exactly, independent of height/width', () => {
  for (const h of [0, 40, 130, 300]) {
    const s = contactShadow(321, 654, h, 80);
    assert.equal(s.cx, 321);
    assert.equal(s.cy, 654);
  }
});

test('non-finite inputs are treated as safe defaults, never throw or NaN', () => {
  const s1 = contactShadow(10, 20, NaN, 60);
  assert.ok(Number.isFinite(s1.alpha) && Number.isFinite(s1.rx));
  const s2 = contactShadow(10, 20, 0, undefined);
  assert.ok(Number.isFinite(s2.rx) && s2.rx === SHADOW_RX_MIN);
});
