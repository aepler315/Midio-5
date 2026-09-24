// The Range's ridge colours, front to back, as one explicit depth ramp.
//
// A single silhouette tint plus atmospheric washes makes pale biomes collapse
// into one slab. The ramp puts the distance relationship in the ridge bodies
// themselves, so The Range stays legible before any optional atmosphere.
import { clamp01 } from '../utils/math.js';
import { hexToRgb, rgbToHex, rgbToHsl, hslToRgb, hexLerp } from '../utils/color.js';

export const RAMP_DEPTH = { L5: 0, L4: 0.26, L3: 0.48, L2: 0.68 };
export const RAMP_MIN_STEP = 0.07;
const NEAR_BELOW_SKY = 0.4;
const NEAR_MIN_L = 0.07;
const NEAR_MAX_L = 0.3;

const hsl = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsl(r, g, b);
};
const fromHsl = (h, s, l) => {
  const c = hslToRgb(h, s, clamp01(l));
  return rgbToHex(c.r, c.g, c.b);
};

/** Returns { L2, L3, L4, L5 } from farthest to nearest ridge. */
export function depthRamp(silhouette, sky) {
  const body = hsl(silhouette);
  const air = hsl(sky);
  const nearL = Math.max(
    NEAR_MIN_L,
    Math.min(NEAR_MAX_L, Math.min(body.l, air.l - NEAR_BELOW_SKY)),
  );
  const near = fromHsl(body.h, body.s * 0.85, nearL);
  const out = {};
  let previousL = -Infinity;
  for (const key of ['L5', 'L4', 'L3', 'L2']) {
    let color = hexLerp(near, sky, RAMP_DEPTH[key]);
    const value = hsl(color);
    if (value.l < previousL + RAMP_MIN_STEP) {
      color = fromHsl(value.h, value.s, Math.min(0.94, previousL + RAMP_MIN_STEP));
    }
    previousL = hsl(color).l;
    out[key] = color;
  }
  return out;
}
