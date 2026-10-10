import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMeaningfulFrame, assertTemporalChange } from '../tools/lib/pixel-evidence.mjs';
test('pixel acceptance rejects a black frame even with palette-count success', () => {
  assert.throws(() => assertMeaningfulFrame({ colors: 1, litFraction: 0, mean: 0, opaque: true }), /blank/);
  assert.doesNotThrow(() => assertMeaningfulFrame({ colors: 24, litFraction: .6, mean: 70, opaque: true }));
});
test('temporal acceptance rejects a frozen controlled sequence, permits quiet repeated frames', () => {
  const a = Array(16).fill(0), b = Array(16).fill(200);
  assert.throws(() => assertTemporalChange([a, a, a]), /frozen/);
  assert.doesNotThrow(() => assertTemporalChange([a, a, b]));
});
