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

test('palette evidence rejects missing completed capture instead of reporting zero errors', async () => {
  const {inspectPixelFrame}=await import('../tools/lib/pixel-evidence.mjs');
  const previous=globalThis.window;
  globalThis.window={__SMW:{renderer:{getCaptureSource:()=>null}}};
  try { await assert.rejects(inspectPixelFrame({paletteId:'range32'}),/completed capture/); }
  finally {globalThis.window=previous;}
});
