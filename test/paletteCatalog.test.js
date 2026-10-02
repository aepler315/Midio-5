import test from 'node:test';
import assert from 'node:assert/strict';
import { RANGE32_COLORS, RANGE32_RAMPS } from '../src/render/PaletteCatalog.js';
import { compilePalette, quantizePalette, applyPalette } from '../src/render/PaletteQuantize.js';
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const linear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const luminance = hex => rgb(hex).map(v => linear(v / 255)).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
test('Range32 has 32 immutable unique colors and ordered role ramps', () => {
  assert.equal(new Set(RANGE32_COLORS).size, 32);
  assert.equal(RANGE32_COLORS.length, 32);
  assert.ok(Object.isFrozen(RANGE32_COLORS));
  assert.ok(RANGE32_COLORS.includes('#000000') && RANGE32_COLORS.includes('#ffffff'));
  for (const ramp of Object.values(RANGE32_RAMPS)) for (let i = 1; i < ramp.length; i++) assert.ok(luminance(ramp[i]) > luminance(ramp[i - 1]));
});
test('every palette swatch maps to itself with alpha unchanged for all dither strengths', () => {
  const compiled = compilePalette(RANGE32_COLORS);
  assert.equal(compiled, compilePalette(RANGE32_COLORS));
  for (const dither of [0, .35, 1]) {
    const data = new Uint8ClampedArray(RANGE32_COLORS.flatMap((hex, i) => [...rgb(hex), i * 8]));
    const expected = data.slice();
    quantizePalette({ data, width: 32, height: 1 }, compiled, { dither });
    assert.deepEqual(data, expected);
  }
});
test('arbitrary input produces repeatable palette members', () => {
  const compiled = compilePalette(RANGE32_COLORS);
  const input = new Uint8ClampedArray(32 * 32 * 4).map((_, i) => (i * 43) % 256);
  for (const dither of [0, .35, 1]) {
    const a = { width: 32, height: 32, data: input.slice() }, b = { ...a, data: input.slice() };
    quantizePalette(a, compiled, { dither }); quantizePalette(b, compiled, { dither });
    assert.deepEqual(a.data, b.data);
    const members = new Set(RANGE32_COLORS.map(hex => rgb(hex).join(',')));
    for (let i = 0; i < a.data.length; i += 4) { assert.ok(members.has([...a.data.slice(i, i + 3)].join(','))); assert.equal(a.data[i + 3], input[i + 3]); }
  }
});
test('oversized and empty frames do no readback work', () => {
  const ctx = { getImageData() { assert.fail('unbounded readback'); } };
  assert.equal(applyPalette(ctx, { width: 1920, height: 1080 }).reason, 'oversize');
  assert.equal(applyPalette(ctx, { width: 0, height: 180 }).reason, 'empty');
});
