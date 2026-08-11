// A generated star catalogue standing in for "an incomprehensibly distant
// projection" of real sky, rather than scattered decorative dots. Pure
// generation, no canvas -- BiomeManager consumes the result once at load
// and caches it, exactly like the silhouette strips do, so density costs
// nothing per frame; only twinkle is live.
//
// Same "depth without display" brief as the ocean: none of this should
// read as a light show. What it buys is a field that's subtly RIGHT when
// someone stops and looks close -- faint stars vastly outnumbering bright
// ones (a real luminosity function), a color mix drawn from actual
// spectral-class frequencies and blackbody temperatures rather than random
// pastel, a galactic-plane band where the count genuinely rises, and
// sub-pixel stars contributing partial light instead of being rounded up
// or dropped -- the thing that makes a field read as "deep" rather than
// "speckled."
import { clamp01, mulberry32 } from '../utils/math.js';

// Real main-sequence spectral-class relative frequencies (roughly the
// actual solar-neighborhood stellar census) and their blackbody
// temperature ranges (Kelvin). O stars are vanishingly rare and M dwarfs
// dominate by a wide margin -- sampling from this table (rather than a
// flat/random hue) is what makes the color mix "subtly right."
export const SPECTRAL_CLASSES = [
  { cls: 'O', freq: 0.00003, tempLo: 30000, tempHi: 52000 },
  { cls: 'B', freq: 0.0013, tempLo: 10000, tempHi: 30000 },
  { cls: 'A', freq: 0.006, tempLo: 7500, tempHi: 10000 },
  { cls: 'F', freq: 0.03, tempLo: 6000, tempHi: 7500 },
  { cls: 'G', freq: 0.076, tempLo: 5200, tempHi: 6000 },
  { cls: 'K', freq: 0.121, tempLo: 3700, tempHi: 5200 },
  { cls: 'M', freq: 0.7657, tempLo: 2400, tempHi: 3700 },
];
const FREQ_TOTAL = SPECTRAL_CLASSES.reduce((s, c) => s + c.freq, 0);

/** Weighted pick of a spectral class + a temperature within its range. */
export function sampleSpectralClass(rand) {
  let r = rand() * FREQ_TOTAL;
  for (const c of SPECTRAL_CLASSES) {
    r -= c.freq;
    if (r <= 0) return { cls: c.cls, tempK: c.tempLo + rand() * (c.tempHi - c.tempLo) };
  }
  const last = SPECTRAL_CLASSES[SPECTRAL_CLASSES.length - 1];
  return { cls: last.cls, tempK: last.tempLo + rand() * (last.tempHi - last.tempLo) };
}

/**
 * Blackbody temperature (K) -> approximate sRGB, via Tanner Helland's
 * widely-used polynomial fit to Mitchell Charity's blackbody data. Good
 * enough for a visual approximation across the full stellar range without
 * needing a spectral integral. Returns {r,g,b} in 0..255.
 */
export function blackbodyRGB(tempK) {
  const T = Math.max(10, Math.min(400, tempK / 100));
  let r, g, b;
  if (T <= 66) {
    r = 255;
    g = 99.47 * Math.log(T) - 161.12;
  } else {
    r = 329.7 * Math.pow(T - 60, -0.133);
    g = 288.12 * Math.pow(T - 60, -0.0755);
  }
  if (T >= 66) b = 255;
  else if (T <= 19) b = 0;
  else b = 138.52 * Math.log(T - 10) - 305.04;
  return {
    r: Math.round(clamp01(r / 255) * 255),
    g: Math.round(clamp01(g / 255) * 255),
    b: Math.round(clamp01(b / 255) * 255),
  };
}

/** {r,g,b} (0..255) -> hue (0..360), for callers that want an HSL hue
 *  rather than an RGB triple (matches the existing starfield's own field). */
export function rgbToHue({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d < 1e-6) return 0; // achromatic -- caller treats hue<=0 as "no tint"
  let h;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

const MAG_MIN = -1.2; // a rare, genuinely brilliant star
const MAG_MAX = 6.5;  // naked-eye faint limit -- the sub-pixel-haze end

// Real star-count/magnitude relation for a roughly uniform density of
// stars in Euclidean space: N(<m), the number brighter than magnitude m,
// grows as 10^(k*m) with k ~ 0.6 (the classic magnitude-count slope).
// The luminosity function's own probability DENSITY is therefore also
// exponential in m, which is what makes faint stars vastly outnumber
// bright ones -- not a flat/uniform draw over the magnitude range (that
// would just proportion counts to interval WIDTH, not to real star
// density, and undersells how faint-dominated a real sky actually is).
const MAG_COUNT_SLOPE = 0.6;

/** Apparent magnitude, drawn via inverse-CDF from the exponential
 *  magnitude-count relation above, truncated to [MAG_MIN, MAG_MAX]. */
export function sampleMagnitude(rand) {
  const k = MAG_COUNT_SLOPE;
  const lo = Math.pow(10, k * MAG_MIN);
  const hi = Math.pow(10, k * MAG_MAX);
  const u = rand();
  return Math.log10(lo + u * (hi - lo)) / k;
}

/** The real astronomical flux relation: each 1.0 magnitude is a factor of
 *  2.512 (100^(1/5)) in brightness. Normalized so MAG_MIN -> 1. */
export function magnitudeToBrightness01(mag) {
  const rel = Math.pow(2.512, -(mag - MAG_MIN));
  return clamp01(rel);
}

/**
 * A star's nominal disc size in px if rendered at "true" brightness with
 * no minimum -- deliberately allowed to fall below 1px. Sub-pixel handling
 * (subPixelDraw below) is what turns that into visible haze instead of
 * either vanishing or getting rounded up to a fake full pixel.
 */
export function sizeForMagnitude(mag) {
  return 0.35 + 2.1 * magnitudeToBrightness01(mag);
}

/**
 * Sub-pixel rendering: a star whose nominal size is below one device pixel
 * doesn't disappear and doesn't get rounded up to a false full-brightness
 * pixel -- it's drawn AT one pixel but with its alpha scaled down by the
 * area ratio, so the total light emitted (size^2 * alpha, the physically
 * meaningful quantity for a point source smaller than the sampling grid)
 * is preserved. This is the single biggest lever on the "incomprehensibly
 * distant" read: a haze of unresolvable faint stars sitting under the
 * resolvable ones, rather than either disappearing or being rounded up.
 */
export function subPixelDraw(sizePx, alpha01) {
  if (sizePx >= 1) return { drawSize: sizePx, drawAlpha: alpha01 };
  const areaRatio = clamp01(sizePx * sizePx);
  return { drawSize: 1, drawAlpha: clamp01(alpha01 * areaRatio) };
}

/**
 * Twinkle amplitude (0..1 multiplier on top of steady brightness):
 * atmospheric scintillation is stronger for point sources (fainter stars,
 * more point-like) and stronger near the horizon (more air path) --
 * altitude01 is 0 at the horizon, 1 at the zenith, matching how the
 * catalogue's own y position (below) maps to "how high in the sky."
 */
export function twinkleAmplitude(mag, altitude01) {
  const pointSourceGain = clamp01((mag - MAG_MIN) / (MAG_MAX - MAG_MIN)); // fainter -> more
  const horizonGain = 1 - clamp01(altitude01);
  return 0.15 + 0.55 * pointSourceGain * (0.4 + 0.6 * horizonGain);
}

/**
 * Generate `count` stars across a width x height field. A galactic-plane
 * band (a fixed fraction of the height, density-weighted rather than a
 * hard cutout) carries an order-of-magnitude higher density than the rest
 * of the sky, same as the real Milky Way band against the general field.
 * Deterministic per seed.
 */
export function generateCatalogue(seed, count, width, height) {
  const rand = mulberry32((seed ^ 0x57a2c47) >>> 0 || 1);
  const bandY = height * 0.32;   // galactic-plane band center
  const bandWidth = height * 0.16;
  const BAND_DENSITY_MUL = 9; // order of magnitude, per the plan's brief
  const out = [];
  for (let i = 0; i < count; i++) {
    const x = rand() * width;
    // Mixture sample: most draws land in the band (weighted by
    // BAND_DENSITY_MUL against the field), the rest spread uniformly --
    // gives a visible density RIDGE rather than a hard-edged stripe.
    const inBand = rand() < BAND_DENSITY_MUL / (BAND_DENSITY_MUL + 1);
    const y = inBand
      ? clamp01((bandY + (rand() - 0.5) * bandWidth) / height) * height
      : rand() * height;

    const { cls, tempK } = sampleSpectralClass(rand);
    const mag = sampleMagnitude(rand);
    const rgb = blackbodyRGB(tempK);
    out.push({
      x, y,
      cls, tempK,
      mag,
      brightness: magnitudeToBrightness01(mag),
      sizePx: sizeForMagnitude(mag),
      hue: rgbToHue(rgb),
      rgb,
      phase: rand() * Math.PI * 2,
      // altitude01: this field has no real horizon, so "higher on screen"
      // (smaller y) stands in for "higher altitude" -- same convention the
      // twinkle-near-the-horizon effect needs, just borrowed from layout.
      altitude01: 1 - clamp01(y / height),
    });
  }
  return out;
}
