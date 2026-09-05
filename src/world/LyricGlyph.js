// Constellation glyph shapes: 5-8 normalized {x,y} dots connected
// sequentially by the ConstellationWeaver's edge system. Each shape
// suggests a recognizable form — abstract enough to be a discovery when
// you notice it, not a label stamped on the sky.
//
// Also contains a minimal single-stroke font for Midasus's sky writing:
// uppercase A-Z laid out as polyline paths she traces with her trail.

import { clamp } from '../utils/math.js';

// ── Constellation glyph shapes ─────────────────────────────────────────
// Each shape is an array of {x, y} in a 0-1 normalized square.
// Connected sequentially (dot 0→1→2→...) by the weaver's edge system.

export const GLYPH_SHAPES = {
  heart: [
    { x: 0.50, y: 0.23 }, { x: 0.36, y: 0.06 }, { x: 0.16, y: 0.10 },
    { x: 0.04, y: 0.30 }, { x: 0.08, y: 0.52 }, { x: 0.24, y: 0.72 },
    { x: 0.50, y: 0.95 }, { x: 0.76, y: 0.72 }, { x: 0.92, y: 0.52 },
    { x: 0.96, y: 0.30 }, { x: 0.84, y: 0.10 }, { x: 0.64, y: 0.06 },
    { x: 0.50, y: 0.23 },
  ],
  star: [
    { x: 0.50, y: 0.00 }, { x: 0.79, y: 0.90 }, { x: 0.02, y: 0.35 },
    { x: 0.98, y: 0.35 }, { x: 0.21, y: 0.90 },
  ],
  crown: [
    { x: 0.05, y: 0.90 }, { x: 0.05, y: 0.50 }, { x: 0.25, y: 0.10 },
    { x: 0.40, y: 0.45 }, { x: 0.50, y: 0.05 },
    { x: 0.60, y: 0.45 }, { x: 0.75, y: 0.10 },
    { x: 0.95, y: 0.50 },
  ],
  flame: [
    { x: 0.50, y: 0.02 }, { x: 0.62, y: 0.18 }, { x: 0.56, y: 0.32 },
    { x: 0.68, y: 0.46 }, { x: 0.72, y: 0.62 }, { x: 0.60, y: 0.82 },
    { x: 0.50, y: 0.97 }, { x: 0.40, y: 0.82 }, { x: 0.28, y: 0.64 },
    { x: 0.34, y: 0.48 }, { x: 0.26, y: 0.32 }, { x: 0.38, y: 0.16 },
    { x: 0.50, y: 0.02 },
  ],
  moon: [
    { x: 0.62, y: 0.04 }, { x: 0.82, y: 0.16 }, { x: 0.92, y: 0.36 },
    { x: 0.92, y: 0.64 }, { x: 0.82, y: 0.84 }, { x: 0.62, y: 0.96 },
    { x: 0.74, y: 0.82 }, { x: 0.80, y: 0.64 }, { x: 0.80, y: 0.36 },
    { x: 0.74, y: 0.18 }, { x: 0.62, y: 0.04 },
  ],
  diamond: [
    { x: 0.50, y: 0.00 }, { x: 0.85, y: 0.30 },
    { x: 0.50, y: 1.00 }, { x: 0.15, y: 0.30 },
    { x: 0.50, y: 0.00 }, { x: 0.50, y: 1.00 },
  ],
  lightning: [
    { x: 0.55, y: 0.00 }, { x: 0.30, y: 0.40 },
    { x: 0.58, y: 0.42 }, { x: 0.28, y: 0.95 },
    { x: 0.65, y: 0.50 }, { x: 0.42, y: 0.48 },
  ],
  skull: [
    { x: 0.50, y: 0.03 }, { x: 0.80, y: 0.14 }, { x: 0.90, y: 0.40 },
    { x: 0.78, y: 0.60 }, { x: 0.62, y: 0.80 }, { x: 0.50, y: 0.97 },
    { x: 0.38, y: 0.80 }, { x: 0.22, y: 0.60 }, { x: 0.10, y: 0.40 },
    { x: 0.20, y: 0.14 }, { x: 0.50, y: 0.03 },
  ],
  eye: [
    { x: 0.02, y: 0.50 }, { x: 0.25, y: 0.20 }, { x: 0.50, y: 0.12 },
    { x: 0.75, y: 0.20 }, { x: 0.98, y: 0.50 },
    { x: 0.75, y: 0.80 }, { x: 0.50, y: 0.88 }, { x: 0.25, y: 0.80 },
  ],
  sword: [
    { x: 0.50, y: 0.00 }, { x: 0.50, y: 0.62 },
    { x: 0.22, y: 0.68 }, { x: 0.78, y: 0.68 },
    { x: 0.50, y: 0.68 }, { x: 0.50, y: 0.95 },
  ],
  wave: [
    { x: 0.00, y: 0.50 }, { x: 0.15, y: 0.25 }, { x: 0.30, y: 0.50 },
    { x: 0.50, y: 0.75 }, { x: 0.70, y: 0.50 },
    { x: 0.85, y: 0.25 }, { x: 1.00, y: 0.50 },
  ],
  infinity: [
    { x: 0.50, y: 0.50 }, { x: 0.30, y: 0.20 }, { x: 0.08, y: 0.25 },
    { x: 0.08, y: 0.75 }, { x: 0.30, y: 0.80 },
    { x: 0.50, y: 0.50 }, { x: 0.70, y: 0.20 }, { x: 0.92, y: 0.25 },
  ],
  mountain: [
    { x: 0.00, y: 0.95 }, { x: 0.25, y: 0.40 }, { x: 0.42, y: 0.10 },
    { x: 0.58, y: 0.10 }, { x: 0.75, y: 0.40 }, { x: 1.00, y: 0.95 },
  ],
  cross: [
    { x: 0.50, y: 0.00 }, { x: 0.50, y: 1.00 },
    { x: 0.50, y: 0.35 }, { x: 0.15, y: 0.35 },
    { x: 0.85, y: 0.35 },
  ],
  ghost: [
    { x: 0.50, y: 0.05 }, { x: 0.82, y: 0.20 }, { x: 0.88, y: 0.50 },
    { x: 0.85, y: 0.80 }, { x: 0.70, y: 0.95 },
    { x: 0.50, y: 0.80 }, { x: 0.30, y: 0.95 }, { x: 0.15, y: 0.80 },
  ],
  wings: [
    { x: 0.50, y: 0.50 }, { x: 0.35, y: 0.30 }, { x: 0.12, y: 0.10 },
    { x: 0.02, y: 0.35 }, { x: 0.20, y: 0.65 },
    { x: 0.50, y: 0.50 }, { x: 0.80, y: 0.65 }, { x: 0.98, y: 0.35 },
  ],
  // Easter eggs
  leaf: [
    { x: 0.50, y: 0.02 }, { x: 0.72, y: 0.20 }, { x: 0.58, y: 0.28 },
    { x: 0.82, y: 0.48 }, { x: 0.62, y: 0.50 }, { x: 0.74, y: 0.74 },
    { x: 0.50, y: 0.60 }, { x: 0.50, y: 0.92 }, { x: 0.50, y: 0.60 },
    { x: 0.26, y: 0.74 }, { x: 0.38, y: 0.50 }, { x: 0.18, y: 0.48 },
    { x: 0.42, y: 0.28 }, { x: 0.28, y: 0.20 }, { x: 0.50, y: 0.02 },
  ],
  rocket: [
    { x: 0.50, y: 0.00 }, { x: 0.65, y: 0.25 }, { x: 0.65, y: 0.65 },
    { x: 0.82, y: 0.85 }, { x: 0.60, y: 0.75 },
    { x: 0.40, y: 0.75 }, { x: 0.18, y: 0.85 }, { x: 0.35, y: 0.65 },
  ],
  alien: [
    { x: 0.50, y: 0.15 }, { x: 0.80, y: 0.08 }, { x: 0.90, y: 0.35 },
    { x: 0.72, y: 0.55 }, { x: 0.50, y: 0.65 },
    { x: 0.28, y: 0.55 }, { x: 0.10, y: 0.35 }, { x: 0.20, y: 0.08 },
  ],
  serpent: [
    { x: 0.15, y: 0.15 }, { x: 0.30, y: 0.10 }, { x: 0.50, y: 0.25 },
    { x: 0.70, y: 0.45 }, { x: 0.85, y: 0.55 },
    { x: 0.65, y: 0.70 }, { x: 0.35, y: 0.80 }, { x: 0.20, y: 0.92 },
  ],
  trident: [
    { x: 0.50, y: 0.95 }, { x: 0.50, y: 0.35 }, { x: 0.50, y: 0.05 },
    { x: 0.50, y: 0.35 }, { x: 0.20, y: 0.10 },
    { x: 0.50, y: 0.35 }, { x: 0.80, y: 0.10 },
  ],
};

// ── Single-stroke font for sky writing ─────────────────────────────────
// Each letter: { width, strokes: [ [{x,y}, ...], ... ] }
// Coordinates in a cell where x∈[0,w] and y∈[0,1] (top=0, bottom=1).
// Multiple strokes = pen-up between them (the trail records a gap).

const _F = {
  A: { w: 0.8, s: [[[0, 1], [0.4, 0], [0.8, 1]], [[0.15, 0.6], [0.65, 0.6]]] },
  B: { w: 0.7, s: [[[0, 1], [0, 0], [0.5, 0], [0.7, 0.12], [0.7, 0.38], [0.5, 0.5], [0, 0.5]], [[0.5, 0.5], [0.7, 0.62], [0.7, 0.88], [0.5, 1], [0, 1]]] },
  C: { w: 0.7, s: [[[0.7, 0.15], [0.45, 0], [0.2, 0], [0, 0.2], [0, 0.8], [0.2, 1], [0.45, 1], [0.7, 0.85]]] },
  D: { w: 0.7, s: [[[0, 1], [0, 0], [0.4, 0], [0.7, 0.2], [0.7, 0.8], [0.4, 1], [0, 1]]] },
  E: { w: 0.65, s: [[[0.65, 0], [0, 0], [0, 1], [0.65, 1]], [[0, 0.5], [0.5, 0.5]]] },
  F: { w: 0.6, s: [[[0.6, 0], [0, 0], [0, 1]], [[0, 0.5], [0.45, 0.5]]] },
  G: { w: 0.75, s: [[[0.7, 0.15], [0.45, 0], [0.18, 0], [0, 0.2], [0, 0.8], [0.18, 1], [0.52, 1], [0.75, 0.82], [0.75, 0.5], [0.45, 0.5]]] },
  H: { w: 0.7, s: [[[0, 0], [0, 1]], [[0.7, 0], [0.7, 1]], [[0, 0.5], [0.7, 0.5]]] },
  I: { w: 0.15, s: [[[0.075, 0], [0.075, 1]]] },
  J: { w: 0.55, s: [[[0.55, 0], [0.55, 0.78], [0.38, 1], [0.18, 1], [0, 0.82]]] },
  K: { w: 0.7, s: [[[0, 0], [0, 1]], [[0.7, 0], [0, 0.5], [0.7, 1]]] },
  L: { w: 0.6, s: [[[0, 0], [0, 1], [0.6, 1]]] },
  M: { w: 0.9, s: [[[0, 1], [0, 0], [0.45, 0.45], [0.9, 0], [0.9, 1]]] },
  N: { w: 0.7, s: [[[0, 1], [0, 0], [0.7, 1], [0.7, 0]]] },
  O: { w: 0.75, s: [[[0.38, 0], [0.7, 0.15], [0.75, 0.5], [0.7, 0.85], [0.38, 1], [0.08, 0.85], [0, 0.5], [0.08, 0.15], [0.38, 0]]] },
  P: { w: 0.7, s: [[[0, 1], [0, 0], [0.5, 0], [0.7, 0.12], [0.7, 0.38], [0.5, 0.5], [0, 0.5]]] },
  Q: { w: 0.75, s: [[[0.38, 0], [0.7, 0.15], [0.75, 0.5], [0.7, 0.85], [0.38, 1], [0.08, 0.85], [0, 0.5], [0.08, 0.15], [0.38, 0]], [[0.52, 0.78], [0.78, 1.02]]] },
  R: { w: 0.7, s: [[[0, 1], [0, 0], [0.5, 0], [0.7, 0.12], [0.7, 0.38], [0.5, 0.5], [0, 0.5]], [[0.42, 0.5], [0.7, 1]]] },
  S: { w: 0.65, s: [[[0.62, 0.12], [0.45, 0], [0.2, 0], [0, 0.15], [0, 0.35], [0.2, 0.5], [0.45, 0.5], [0.65, 0.65], [0.65, 0.85], [0.45, 1], [0.2, 1], [0.03, 0.88]]] },
  T: { w: 0.7, s: [[[0, 0], [0.7, 0]], [[0.35, 0], [0.35, 1]]] },
  U: { w: 0.7, s: [[[0, 0], [0, 0.78], [0.15, 1], [0.55, 1], [0.7, 0.78], [0.7, 0]]] },
  V: { w: 0.8, s: [[[0, 0], [0.4, 1], [0.8, 0]]] },
  W: { w: 1.0, s: [[[0, 0], [0.22, 1], [0.5, 0.42], [0.78, 1], [1, 0]]] },
  X: { w: 0.7, s: [[[0, 0], [0.7, 1]], [[0.7, 0], [0, 1]]] },
  Y: { w: 0.7, s: [[[0, 0], [0.35, 0.5], [0.7, 0]], [[0.35, 0.5], [0.35, 1]]] },
  Z: { w: 0.7, s: [[[0, 0], [0.7, 0], [0, 1], [0.7, 1]]] },
  "'": { w: 0.12, s: [[[0.06, 0], [0.04, 0.12]]] },
  '!': { w: 0.12, s: [[[0.06, 0], [0.06, 0.65]], [[0.06, 0.85], [0.06, 0.92]]] },
};

const CHAR_GAP = 0.15;
const SPACE_W = 0.35;

/** Build a flat path array for sky-writing text. Each entry is {x, y, gap}
 *  where gap=true means pen-up (don't stroke from the previous point).
 *  Coordinates are in a roughly unit-scale space centered at origin. */
export function layoutTextPath(text) {
  if (!text) return [];
  const upper = text.toUpperCase();

  // Measure total width.
  let totalW = 0;
  for (const ch of upper) {
    if (ch === ' ') { totalW += SPACE_W; continue; }
    const def = _F[ch];
    if (!def) continue;
    totalW += def.w + CHAR_GAP;
  }
  if (totalW > CHAR_GAP) totalW -= CHAR_GAP;
  if (totalW <= 0) return [];

  // Normalize so the text spans roughly -1..1 in x.
  const scale = 2 / Math.max(totalW, 0.5);
  const charH = 0.55; // character height relative to width scale

  const path = [];
  let cx = -totalW / 2;

  for (const ch of upper) {
    if (ch === ' ') { cx += SPACE_W; continue; }
    const def = _F[ch];
    if (!def) continue;

    for (const stroke of def.s) {
      for (let i = 0; i < stroke.length; i++) {
        const pt = stroke[i];
        path.push({
          x: (cx + pt[0]) * scale,
          y: (pt[1] - 0.5) * charH * scale,
          gap: i === 0 && path.length > 0,
        });
      }
    }
    cx += def.w + CHAR_GAP;
  }

  return path;
}

/** Place glyph dots into a sky region. Returns an array of {x, y}
 *  pixel positions scattered around (cx, cy) at the given size, with
 *  clamping to stay within bounds. */
export function placeGlyph(glyphId, cx, cy, size, bounds) {
  const shape = GLYPH_SHAPES[glyphId];
  if (!shape) return null;
  return shape.map((d) => ({
    x: clamp(cx + (d.x - 0.5) * size, bounds.xMin, bounds.xMax),
    y: clamp(cy + (d.y - 0.5) * size * 0.85, bounds.yMin, bounds.yMax),
  }));
}
