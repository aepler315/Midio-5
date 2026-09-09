// Palette quantization for "8-bit intensive" (StagePresets.PALETTE_PRESET).
//
// Plain 8-bit mode gets its look from pixel SIZE alone -- a 320x180 buffer
// scaled up with nearest-neighbour. This adds the other half of what made
// 8-bit hardware look the way it did: a framebuffer that could not store
// more than 256 colors. "8-bit color" means exactly that, and the historical
// split is R3 G3 B2 -- eight red levels, eight green, four blue, blue last
// because the eye resolves it worst.
//
// This is the pass deliberately left out of plain 8-bit mode, and the reason
// is worth restating rather than rediscovering: real hardware got the banded
// look FREE from its framebuffer format, while Canvas 2D has to read the
// frame back, rewrite every pixel, and upload it again -- every frame. That
// readback is the expensive part (a GPU->CPU sync), not the arithmetic. It
// is only affordable at all because the buffer this runs on is 320x180, i.e.
// 57,600 pixels rather than a 1080p frame's two million. Hence the mode's
// own name: it buys the authentic look and is honest about costing for it.
//
// Ordered (Bayer) dithering is not a flourish here, it is what makes the
// mode usable. This game's frames are mostly large smooth gradients -- skies,
// haze, depth washes -- and those are precisely what naive quantization
// wrecks, turning a sunset into a half-dozen hard stripes. A 4x4 ordered
// dither trades that banding for a fine stipple, which is both closer to how
// period hardware and artists actually coped with small palettes, and much
// less objectionable in motion.

// Classic 4x4 Bayer matrix, values 0..15 in the recursive threshold order.
const BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

/** Build a [16 x 256] lookup: for each Bayer cell and each input byte, the
 *  quantized output byte. Doing the dither offset, the quantization and the
 *  expansion back to full range up front means the per-pixel cost at draw
 *  time is one array index per channel -- no arithmetic, no branches.
 *
 *  `levels` is how many distinct values the channel keeps (8 for a 3-bit
 *  channel, 4 for a 2-bit one). The output is expanded back across the full
 *  0..255 range rather than left truncated, so the brightest level is a true
 *  255 -- truncation alone would darken the whole frame by up to 31/255 and
 *  read as a wash rather than as a palette. */
function buildDitherLut(levels) {
  const lut = new Uint8Array(16 * 256);
  const step = 255 / (levels - 1); // distance between adjacent output levels
  const top = levels - 1;
  for (let cell = 0; cell < 16; cell++) {
    // floor(v/step + frac), with frac in [0,1) -- the classic ordered-dither
    // formulation, and floor rather than round for a specific reason: a value
    // that already sits exactly on a palette level has an integer v/step, so
    // adding any frac below 1 and flooring returns that same level. Pure
    // black and pure white therefore never dither, where a round()-based
    // offset would straddle their boundary and stipple them (white came out
    // as a mix of 219 and 255). For values BETWEEN levels the fraction of
    // cells that step up equals the distance to the upper level, which is
    // what makes the dither unbiased -- hence the +0.5, centering the 16
    // cells on 0.5 rather than leaving their mean at 15/32.
    const frac = (BAYER_4X4[cell] + 0.5) / 16;
    for (let v = 0; v < 256; v++) {
      const level = Math.floor(v / step + frac);
      const clamped = level < 0 ? 0 : level > top ? top : level;
      lut[cell * 256 + v] = Math.round(clamped * step);
    }
  }
  return lut;
}

// Built once at module load: ~8KB total, shared by every frame.
const LUT_3BIT = buildDitherLut(8); // red, green
const LUT_2BIT = buildDitherLut(4); // blue

/** Quantize an ImageData's pixels in place to the 256-color R3G3B2 palette
 *  with 4x4 ordered dithering. Exported for its own sake so the palette
 *  itself is testable without a canvas.
 *
 *  Alpha is left untouched, and that has a measurable consequence worth
 *  knowing rather than rediscovering. A canvas stores premultiplied color
 *  but hands getImageData/putImageData unpremultiplied bytes, so on pixels
 *  whose alpha is neither 0 nor 255 the round trip re-rounds what we wrote
 *  and nudges it off the palette. Where a frame is opaque -- which is the
 *  case that matters, since a song's frame opens with a sky gradient over
 *  every pixel -- the palette is exact. The title backdrop is the exception:
 *  it draws over a cleared canvas and is mostly partial alpha (measured: 251
 *  distinct alpha values, ~2% of pixels fully opaque), so there the palette
 *  reads as approximate -- still a heavy quantization, just not exactly 256
 *  colors. Forcing alpha to 255 would make it exact everywhere at the cost
 *  of painting the title's transparent background black instead of letting
 *  the page's own color show through, which is not a trade this mode should
 *  make on its own. */
export function quantizeImageData(imageData) {
  const { data, width, height } = imageData;
  for (let y = 0; y < height; y++) {
    // The dither cell's row offset is constant across a scanline.
    const rowCell = (y & 3) * 4;
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      const cell = (rowCell + (x & 3)) * 256;
      data[i] = LUT_3BIT[cell + data[i]];
      data[i + 1] = LUT_3BIT[cell + data[i + 1]];
      data[i + 2] = LUT_2BIT[cell + data[i + 2]];
    }
  }
  return imageData;
}

/** Read the composed frame back, quantize it, and write it out again.
 *  Never throws: a tainted or zero-sized canvas must degrade to "the frame
 *  simply is not quantized", never to a dead render loop. */
export function quantizeCanvas(ctx, canvas) {
  const w = canvas.width | 0, h = canvas.height | 0;
  if (w <= 0 || h <= 0) return false;
  try {
    const frame = ctx.getImageData(0, 0, w, h);
    quantizeImageData(frame);
    ctx.putImageData(frame, 0, 0);
    return true;
  } catch {
    return false; // e.g. a tainted canvas -- drop the effect, keep the frame
  }
}
