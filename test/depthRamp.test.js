import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToRgb, rgbToHsl } from '../src/utils/color.js';
import { depthRamp, RAMP_MIN_STEP } from '../src/world/DepthRamp.js';

const lightness = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsl(r, g, b).l;
};

test('the range ramp gives every ridge a distinct, ordered lightness', () => {
  for (const [body, sky] of [
    ['#2a3a2f', '#9fb7c9'],
    ['#d9dfdf', '#c9d8e8'],
    ['#1b1028', '#0a0612'],
    ['#6e5a3a', '#e9b872'],
  ]) {
    const ramp = depthRamp(body, sky);
    const ordered = ['L5', 'L4', 'L3', 'L2'].map((key) => lightness(ramp[key]));
    for (let i = 1; i < ordered.length; i++) {
      assert.ok(ordered[i] - ordered[i - 1] >= RAMP_MIN_STEP - 0.006,
        `${body}/${sky}: ${ordered.join(', ')}`);
    }
  }
});

test('the closest range stays visibly below a bright sky', () => {
  const ramp = depthRamp('#e8ecef', '#c9d8e8');
  assert.ok(lightness(ramp.L5) <= 0.3);
  assert.ok(lightness(ramp.L2) < lightness('#c9d8e8'));
});
