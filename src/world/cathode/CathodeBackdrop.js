// Cathode's parallax skyline: two blocky silhouette layers between the sky
// and the ground grid.
//
// Deliberately BLOCKY, not the smooth ridged silhouettes the painterly
// worlds use (RidgeShape.js, SilhouetteGenerator.js) -- a chiptune skyline
// reads as columns of fixed-width steps (Kirby's Dream Land, the original
// Sonic's parallax hills), not a curve. So the noise underneath is sampled
// once per COLUMN (a fixed pixel pitch) and held flat across it, rather
// than once per pixel.
//
// Seeded per song (sim.songSeed) so two songs don't render an identical
// skyline, but otherwise pure and deterministic -- the same seed, width,
// and layer index always produce the same heights, which is what makes
// this testable without a canvas and stable frame to frame without storing
// per-pixel state.
import { ValueNoise1D } from '../../utils/noise.js';

/** One column's height noise, folded into [0, 1] and floored so silhouette
 *  edges land on whole pixels -- the thing that makes it read as built
 *  rather than drawn. `columnPx` quantizes x to a step's width before
 *  sampling, so every pixel within a step shares one height. */
export function layerColumnLevel(noise, x, columnPx) {
  const col = Math.floor(x / columnPx);
  // fbm returns roughly [-1, 1]; fold to [0, 1] before scaling by amplitude.
  return Math.max(0, Math.min(1, (noise.fbm(col * 0.6, 3) + 1) / 2));
}

/**
 * Row indices for a whole silhouette layer: `w` entries, each the topmost
 * row (in buffer space) that layer paints at that x. Everything from that
 * row down to `horizonRow` belongs to the silhouette; everything above it
 * is sky. Pure and stateless -- the noise field itself never moves;
 * `scrollPx` shifts which slice of it this frame reads, so the renderer
 * can hold one noise table per layer for the whole song and just change
 * the number it passes in here every frame.
 */
export function buildLayerHeights(noise, w, horizonRow, {
  columnPx = 16, ampPx = 20, baseRowsAboveHorizon = 6, scrollPx = 0,
} = {}) {
  const heights = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    const level = layerColumnLevel(noise, x + scrollPx, columnPx);
    const rise = baseRowsAboveHorizon + Math.round(level * ampPx);
    heights[x] = Math.max(0, horizonRow - rise);
  }
  return heights;
}

/** A layer's own noise source and scroll rate, keyed by index so two
 *  layers seeded from the same song never sample identically. Farther
 *  layers (higher index) move slower and sit taller -- standard parallax,
 *  expressed as data instead of per-layer special-casing at the call site. */
export function layerConfigFor(songSeed, index) {
  const seed = (Math.floor(songSeed) >>> 0) ^ (0x9e3779b9 * (index + 1));
  return {
    noise: new ValueNoise1D(seed >>> 0, 256),
    // Farther (higher index) = slower scroll, shorter columns (denser,
    // hazier detail), lower amplitude (recedes into the horizon).
    scrollPxPerSec: index === 0 ? 14 : 6,
    columnPx: index === 0 ? 14 : 22,
    ampPx: index === 0 ? 26 : 14,
    baseRowsAboveHorizon: index === 0 ? 4 : 10,
  };
}

/**
 * Collapse a heights array into horizontal runs of equal height, each as
 * `{ x, width, height }` (height = rows tall, from that row down to
 * `horizon`). Since `buildLayerHeights` is column-quantized, most runs
 * span a whole `columnPx` -- so a 320-wide layer draws as a couple dozen
 * rects instead of 320 one-pixel-wide ones. Pure, so the batching itself
 * is testable without a canvas in the loop.
 */
export function runsFromHeights(heights, horizonRow) {
  const runs = [];
  let i = 0;
  while (i < heights.length) {
    const top = heights[i];
    let j = i + 1;
    while (j < heights.length && heights[j] === top) j++;
    if (top < horizonRow) runs.push({ x: i, width: j - i, height: horizonRow - top });
    i = j;
  }
  return runs;
}

/** Deterministic per-layer color pick from the ramp: darker than the
 *  ground-facing horizon step, lighter than the sky's own darkest step, so
 *  two layers and the ground never collide on one flat color. Clamped to
 *  stay inside the ramp on a short (4-color) persona. */
export function layerRampIndex(rampLen, index) {
  // index 0 (nearest) sits just above the ground floor; farther layers step
  // toward the middle of the ramp.
  return Math.max(1, Math.min(rampLen - 2, 1 + index));
}
