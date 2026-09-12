// The low-resolution framebuffer Cathode actually draws into.
//
// This is the difference between Cathode and the existing '8bit' stage
// preset, which are easy to confuse. The preset shrinks the BACKING STORE
// and lets the normal painterly renderer draw into it: vector art
// rasterized small, then scaled up. Cathode instead AUTHORS at 320x180 --
// every rect lands on a whole pixel because every coordinate is a whole
// pixel -- and then scales up. Downsampled vector art has soft, drifting
// edges; authored pixel art has hard ones that stay put. Only the second
// reads as a different machine.
//
// 320x180 for the same reason StagePresets.js picked it: it divides
// 1280x720 by exactly 4 and 1920x1080 by exactly 6, so the upscale lands
// on whole pixels on the two commonest displays rather than shimmering
// between them.
//
// Independent of the stage preset on purpose. Cathode looks like Cathode
// at 4K; the preset stays what it has always been, a performance lever.

export const PIXEL_W = 320;
export const PIXEL_H = 180;

/** Ordered (Bayer) 4x4 dither matrix, the classic 0..15 arrangement.
 *  Ordered rather than error-diffused because it is stable frame to frame:
 *  Floyd-Steinberg re-decides every pixel from its neighbours, so a
 *  gradient that drifts one step crawls with noise. A fixed matrix makes
 *  the same pixel choose the same way every frame, which is what period
 *  hardware looked like and what stops a slow sky from boiling. */
export const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** The 0..1 dither threshold for a pixel. Pure; wraps on both axes. */
export function ditherThreshold(x, y) {
  const col = ((x % 4) + 4) % 4;
  const row = ((y % 4) + 4) % 4;
  return (BAYER_4X4[row][col] + 0.5) / 16;
}

/**
 * Map a continuous 0..1 level onto a discrete ramp index, dithering the
 * fractional part so a gradient crossing two ramp entries reads as a
 * stipple between them rather than a hard band. With a 4-color DMG ramp
 * this is the only thing standing between a sky and four flat stripes.
 *
 * Pure, and the single most test-worthy function here: level 0 must land
 * on index 0 and level 1 on the last index for EVERY pixel, or the
 * darkest and lightest bands pick up dither noise that has nowhere to go.
 */
export function rampIndexFor(level01, rampLen, x, y) {
  if (!(rampLen > 0)) return 0;
  const last = rampLen - 1;
  if (last === 0) return 0;
  const lvl = Math.max(0, Math.min(1, level01));
  const scaled = lvl * last;
  const base = Math.floor(scaled);
  const frac = scaled - base;
  // Saturate rather than dither at the very ends: a pure 0 or 1 has no
  // neighbour to stipple toward.
  if (base >= last) return last;
  return frac > ditherThreshold(x, y) ? base + 1 : base;
}

/**
 * An offscreen 320x180 canvas plus the handful of draw ops Cathode needs.
 * Every coordinate is in buffer space and is floored to a whole pixel on
 * the way in -- a half-pixel rect is the one thing that instantly breaks
 * the illusion, and it is far easier to forbid here than to remember at
 * ~40 call sites.
 */
export class PixelBuffer {
  constructor(w = PIXEL_W, h = PIXEL_H) {
    this.w = w;
    this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
  }

  clear(color) {
    const { ctx } = this;
    if (!ctx) return;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  rect(x, y, w, h, color) {
    const { ctx } = this;
    if (!ctx) return;
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor(x), Math.floor(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }

  px(x, y, color) {
    this.rect(x, y, 1, 1, color);
  }

  /** A full-width horizontal band, the workhorse for skies and floors. */
  band(y, h, color) {
    this.rect(0, y, this.w, h, color);
  }

  /**
   * Scale the buffer onto a destination context with nearest-neighbour
   * filtering. Saves and restores the smoothing flag rather than assuming
   * it: the destination is the shared stage canvas, and leaving smoothing
   * off would silently change how every later draw on it resamples.
   */
  blitTo(destCtx, dw, dh) {
    if (!destCtx) return;
    const prev = destCtx.imageSmoothingEnabled;
    destCtx.imageSmoothingEnabled = false;
    destCtx.drawImage(this.canvas, 0, 0, dw, dh);
    destCtx.imageSmoothingEnabled = prev;
  }

  dispose() {
    // Zero the backing store so the bitmap is collectable promptly; a
    // 320x180 canvas is small, but stopTimeline drops a renderer on every
    // song change and these would otherwise pile up for the session.
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.ctx = null;
  }
}
