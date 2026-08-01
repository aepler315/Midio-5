import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nearestPaletteColor, pixelGridWidth, pixelGridHeight, RETRO_PALETTE, PIXEL_GRID_W,
} from '../src/render/RetroFilter.js';

test('nearestPaletteColor returns an exact palette entry unchanged', () => {
  for (const [r, g, b] of RETRO_PALETTE) {
    assert.deepEqual(nearestPaletteColor(r, g, b), [r, g, b]);
  }
});

test('nearestPaletteColor picks the closest color, not just the first one', () => {
  // Pure white (255,255,255) is in the palette; a color one step off must
  // still resolve to it rather than some unrelated hue.
  assert.deepEqual(nearestPaletteColor(250, 250, 250), [255, 255, 255]);
  assert.deepEqual(nearestPaletteColor(2, 2, 2), [0, 0, 0]);
});

test('nearestPaletteColor is deterministic and always returns a valid palette member', () => {
  const seen = new Set(RETRO_PALETTE.map((p) => p.join(',')));
  for (let r = 0; r <= 255; r += 37) {
    for (let g = 0; g <= 255; g += 53) {
      for (let b = 0; b <= 255; b += 61) {
        const a = nearestPaletteColor(r, g, b);
        const b2 = nearestPaletteColor(r, g, b);
        assert.deepEqual(a, b2, 'must be deterministic for the same input');
        assert.ok(seen.has(a.join(',')), `result ${a} must be a real palette member`);
      }
    }
  }
});

test('pixelGridWidth never exceeds the canvas width, never goes below the floor, and shrinks (or holds) as perf pressure rises', () => {
  assert.ok(pixelGridWidth(200) <= 200, 'a small canvas caps the grid at its own width');
  assert.equal(pixelGridWidth(2000), PIXEL_GRID_W, 'a large canvas caps at the native grid width');
  let prev = pixelGridWidth(1280, 0);
  for (let level = 1; level <= 4; level++) {
    const w = pixelGridWidth(1280, level);
    assert.ok(w <= prev, `grid width must not grow as perf level rises: ${w} > ${prev} at level=${level}`);
    assert.ok(w >= 80, 'must never drop below the readability floor');
    prev = w;
  }
});

test('pixelGridHeight preserves the canvas aspect ratio', () => {
  const gridW = 320;
  const h = pixelGridHeight(1280, 720, gridW);
  assert.equal(h, Math.round((320 * 720) / 1280));
  assert.ok(h > 0);
});
