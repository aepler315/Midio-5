import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeShadow, drawContactShadow } from '../src/render/ContactShadow.js';

function mockCtx() {
  const calls = { createRadialGradient: 0 };
  return {
    calls,
    save() {}, restore() {}, beginPath() {}, fill() {}, ellipse() {},
    createRadialGradient(...args) {
      for (const a of args) assert.ok(Number.isFinite(a), `createRadialGradient received a non-finite arg: ${args}`);
      calls.createRadialGradient++;
      return { addColorStop() {} };
    },
  };
}

const light = { x: 400, y: 100, intensity: 1 };

test('shadow offsets away from the light, to the opposite side of the subject', () => {
  const rightOfLight = computeShadow({ x: 900, groundY: 600, heightAboveGround: 80, width: 40, light });
  assert.ok(rightOfLight.x > 900, 'subject right of the light should cast its shadow further right');

  const leftOfLight = computeShadow({ x: 100, groundY: 600, heightAboveGround: 80, width: 40, light });
  assert.ok(leftOfLight.x < 100, 'subject left of the light should cast its shadow further left');
});

test('alpha decreases and radius increases monotonically with height', () => {
  const heights = [0, 40, 80, 160, 240];
  const shadows = heights.map((h) => computeShadow({ x: 900, groundY: 600, heightAboveGround: h, width: 40, light }));
  for (let i = 1; i < shadows.length; i++) {
    assert.ok(shadows[i].alpha <= shadows[i - 1].alpha, `alpha should not increase at height ${heights[i]}`);
    assert.ok(shadows[i].radiusX >= shadows[i - 1].radiusX, `radius should not shrink at height ${heights[i]}`);
  }
});

test('alpha is 0 when the light has no intensity', () => {
  const darkLight = { x: 400, y: 100, intensity: 0 };
  const s = computeShadow({ x: 900, groundY: 600, heightAboveGround: 20, width: 40, light: darkLight });
  assert.equal(s.alpha, 0);
});

test('alpha is 0 when no light is passed at all (perf-gated / non-biome fallback)', () => {
  const s = computeShadow({ x: 900, groundY: 600, heightAboveGround: 20, width: 40, light: null });
  assert.equal(s.alpha, 0);
});

test('a grounded subject (height 0) sits directly beneath it, un-offset', () => {
  const s = computeShadow({ x: 900, groundY: 600, heightAboveGround: 0, width: 40, light });
  assert.equal(s.x, 900);
  assert.equal(s.y, 600);
});

test('drawContactShadow never calls createRadialGradient with a non-finite argument, even when the subject position is undefined (e.g. its first frame, before its own update() has run)', () => {
  const ctx = mockCtx();
  assert.doesNotThrow(() => {
    drawContactShadow(ctx, { x: undefined, groundY: undefined, heightAboveGround: undefined, width: 40, light });
  });
  assert.equal(ctx.calls.createRadialGradient, 0, 'should skip drawing entirely rather than pass NaN through');
});
