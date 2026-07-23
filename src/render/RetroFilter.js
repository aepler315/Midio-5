// A modernized 8-bit retro filter: the fully composed frame (everything
// the vector renderer already draws, unmodified) gets downsampled to a
// coarse pixel grid and its colors quantized to a limited retro palette,
// then drawn back upscaled with a faint scanline overlay -- pixelation +
// palette-limiting is the "nostalgia machine" read, achieved as a single
// post-process pass rather than a sprite-art rewrite. Same downsample-
// into-an-offscreen-canvas-buffer pattern as Renderer._drawBloom; the
// pure palette/grid math below is split out from the canvas-touching
// draw call in Renderer.js so it's directly unit-testable.
import { clamp01 } from '../utils/math.js';

// The frame's "native resolution" width it pixelates down to -- a classic
// 8-bit-console ballpark, scaled to the actual canvas aspect ratio.
export const PIXEL_GRID_W = 320;
export const SCANLINE_ALPHA = 0.08;
export const SCANLINE_PERIOD_PX = 4;

// A compact, saturated retro palette (NES/Game-Boy-Color-adjacent): a
// grayscale ramp plus a handful of hues spanning the wheel, few enough
// that quantizing to it always reads as "limited palette", never muddy.
export const RETRO_PALETTE = Object.freeze([
  [0, 0, 0], [17, 17, 34], [51, 51, 68], [85, 85, 102],
  [136, 136, 153], [187, 187, 204], [221, 221, 238], [255, 255, 255],
  [172, 50, 50], [224, 111, 66], [232, 178, 74], [140, 196, 90],
  [74, 168, 140], [77, 120, 204], [124, 90, 196], [201, 90, 168],
]);

/** Squared Euclidean RGB distance -- cheap, and monotone with the true
 *  distance, which is all nearest-color matching needs. */
function dist2(r, g, b, pr, pg, pb) {
  const dr = r - pr, dg = g - pg, db = b - pb;
  return dr * dr + dg * dg + db * db;
}

/** The closest color in `palette` (an array of [r,g,b] triples) to
 *  (r,g,b). Pure, deterministic; returns one of the palette's own
 *  triplets (never allocates a new one) so callers can identity-compare
 *  if they want to. */
export function nearestPaletteColor(r, g, b, palette = RETRO_PALETTE) {
  let best = palette[0], bestD = Infinity;
  for (const p of palette) {
    const d = dist2(r, g, b, p[0], p[1], p[2]);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/** How many horizontal "pixels" the frame quantizes to, given the real
 *  canvas width and (optionally) a PerfGovernor level: coarser
 *  pixelation under perf pressure is CHEAPER, not more expensive (a
 *  smaller grid means fewer quantized pixels), so this only ever shrinks
 *  the per-pixel loop, never grows it. Never below a floor that would
 *  make the frame unrecognizable. */
export function pixelGridWidth(canvasWidth, perfLevel = 0) {
  const base = Math.min(PIXEL_GRID_W, canvasWidth);
  return Math.max(80, Math.round(base * (1 - 0.12 * clamp01(perfLevel / 4))));
}

/** The matching grid height for a given grid width, preserving the
 *  canvas's own aspect ratio. */
export function pixelGridHeight(canvasWidth, canvasHeight, gridWidth) {
  return Math.max(1, Math.round((gridWidth * canvasHeight) / canvasWidth));
}
