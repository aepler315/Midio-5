// Stage render presets: the size of the backing store the frame is
// rasterized into. The sim's own stage is always the logical 1280×720
// (Simulation canvasWidth/canvasHeight); only the buffer changes, and CSS
// upscales that buffer to fill the viewport.
//
// '8bit' is a MODE, not just another rung on this ladder. Every other
// preset changes one number — how many pixels get shaded. 8-bit changes
// three things at once, and only the combination is worth a menu entry:
//
//   1. Pixel count. 320×180 is 57,600 px against 1080p's 2,073,600 — a 36×
//      cut in rasterization, and every fill/composite/blit in the frame
//      scales with pixel count. This is the single biggest lever there is.
//      320×180 specifically (rather than something smaller still) because
//      it divides 1280×720 by exactly 4 and 1920×1080 by exactly 6, so the
//      upscale lands on whole pixels on the two commonest displays instead
//      of shimmering between them.
//   2. Draw-call count. Pixel count is only half the frame: the other half
//      is per-call overhead, which a smaller buffer does nothing about. So
//      8-bit also pins PerfGovernor to its cheapest rung (see its `retro`
//      flag) — every optional pass off, particles thinned, ridges blitted
//      in the widest columns. Without this a 320×180 frame is cheap enough
//      that the governor's own recovery would climb back to full quality
//      within a minute and undo the point of picking the mode.
//   3. Filtering. Nearest-neighbour on the way up (imageSmoothingEnabled
//      false, image-rendering: pixelated) is both cheaper than bilinear and
//      the thing that actually makes it read as 8-bit rather than as blur.
//
// What plain 8-bit deliberately leaves out is a palette-quantization pass.
// Real 8-bit hardware got its banded look for free from the framebuffer
// format; in Canvas 2D it costs a frame readback and a rewrite of every
// pixel, every frame — the kind of work this mode otherwise exists to
// remove. The chunky pixels carry the look on their own.
//
// '8bit-intensive' is that pass, offered as its own entry rather than
// folded into the cheap one. It keeps every saving plain 8-bit makes (same
// 320×180 buffer, same pinned governor, same nearest-neighbour) and adds
// the 256-color R3G3B2 palette on top — see PaletteQuantize.js. Two entries
// rather than one because they answer different questions: "my device
// cannot hold frame rate" and "I want it to look like a console". Someone
// on a genuinely weak machine should not have to buy the second to get the
// first, which is exactly what a single merged mode would force.

/** Preset key for 8-bit mode. A string, unlike every other key — the other
 *  presets are named by their height in pixels and these are not. */
export const RETRO_PRESET = '8bit';

/** Preset key for 8-bit intensive: everything RETRO_PRESET does, plus the
 *  per-frame palette quantization. */
export const PALETTE_PRESET = '8bit-intensive';

export const DEFAULT_STAGE_PRESET = 1080;

export const STAGE_PRESETS = {
  [RETRO_PRESET]: { w: 320, h: 180, retro: true },
  [PALETTE_PRESET]: { w: 320, h: 180, retro: true, palette: true },
  144: { w: 256, h: 144 },
  240: { w: 426, h: 240 },
  360: { w: 640, h: 360 },
  480: { w: 854, h: 480 },
  720: { w: 1280, h: 720 },
  1080: { w: 1920, h: 1080 },
  1440: { w: 2560, h: 1440 },
  2160: { w: 3840, h: 2160 },
};

/** Normalize an arbitrary value (a select's string value, a localStorage
 *  read, a URL param) to a real preset key, or null if it names nothing.
 *  Null rather than a default so callers can run their own fallback chain
 *  — the UI's value, then storage, then the house default — and tell the
 *  difference between "not set" and "set to something unknown". */
export function resolveStagePreset(value) {
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase();
  const n = Number(raw);
  // Named (non-numeric) presets resolve against the table by key, rather
  // than each being spelled out here -- adding a row above is then all it
  // takes to add a mode. Numeric ones keep resolving to numbers, since
  // that is what every existing caller and stored value expects.
  const key = Number.isFinite(n) ? n : raw;
  return Object.prototype.hasOwnProperty.call(STAGE_PRESETS, key) ? key : null;
}

/** Backing-store dimensions for a preset, falling back to the house default
 *  rather than throwing — a bad stored value must never break boot. */
export function stageDims(preset) {
  return STAGE_PRESETS[preset] || STAGE_PRESETS[DEFAULT_STAGE_PRESET];
}

/** Whether this preset is one of the 8-bit modes, i.e. whether the rest of
 *  the pipeline (governor floor, nearest-neighbour filtering) should engage.
 *  True for both the plain and the intensive variant. */
export function isRetroPreset(preset) {
  return !!STAGE_PRESETS[preset]?.retro;
}

/** Whether this preset additionally wants the per-frame palette pass. Only
 *  the intensive variant does; see PaletteQuantize.js for what it costs. */
export function isPalettePreset(preset) {
  return !!STAGE_PRESETS[preset]?.palette;
}
