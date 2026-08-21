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
 * The galactic plane, as it actually presents: a broad band tilted across
 * the sky, not a horizontal stripe through the middle. Exported so the
 * painted milky wash (BiomeManager._drawStarfield) can sit on exactly the
 * same axis the star density does -- previously the wash was pinned at
 * 0.14 of the canvas height while the density ridge sat at 0.32, so the
 * two cues disagreed about where the galaxy even was.
 *
 * `halfFrac` is deliberately wide and the falloff below is soft: a real
 * plane thins out gradually into the general field, and a narrow band at
 * high density is exactly what reads as "the stars are only in the middle."
 */
export const GALACTIC_BAND = {
  centerFrac: 0.45, // band center at mid-screen-x, as a fraction of field height
  halfFrac: 0.32,   // half-thickness -- the band spans 64% of the field,
                     // centered further down than before so it no longer
                     // reads as a stripe hugging the top of the sky
  tiltFrac: 0.22,   // rise from left edge to right edge, as a fraction of height
};

/** Band center height at horizontal position `xFrac` (0..1 across the field). */
export function galacticBandCenterY(xFrac, height) {
  const { centerFrac, tiltFrac } = GALACTIC_BAND;
  return (centerFrac + (xFrac - 0.5) * tiltFrac) * height;
}

// How much denser the plane is than the general field, PER UNIT AREA.
// The mixture weight below converts this to a probability using the band's
// own area fraction -- the previous code used D/(D+1) directly, which is
// only correct if the band covers half the sky. At the old D=9 that meant
// 90% of every star landed in a stripe 16% of the height tall (measured:
// 72% of the field inside a single eighth of the frame, against ~1.4% in
// each of the bands below it). The sky above and below was empty and the
// whole field read as a belt across the middle rather than as a sky.
//
/**
 * Generate `count` stars across a width x height field. `height` is the
 * SKY region (horizon to zenith), not necessarily the whole canvas -- the
 * caller passes the part of the frame that isn't behind terrain, so
 * altitude01 means what it says and no star is generated only to be
 * occluded by a mountain.
 *
 * Star POSITIONS are uniform across the whole field -- an earlier version
 * biased a fraction of stars toward the galactic plane (GALACTIC_BAND),
 * but even a "gentle" bias measurably concentrated density (a peak-to-edge
 * ratio upward of 7:1 at the values that were supposed to be conservative)
 * and read as a band confined to the middle of the sky, the exact
 * complaint this was meant to fix. The "this is a galaxy, not a random
 * field" cue now comes entirely from the separately-painted milky wash and
 * dust lanes (_drawStarfield, generateDustLanes) and from deep-sky objects
 * clustering on the plane (generateDeepSky) -- neither of which touches
 * where individual stars actually sit. Deterministic per seed.
 */
export function generateCatalogue(seed, count, width, height) {
  const rand = mulberry32((seed ^ 0x57a2c47) >>> 0 || 1);
  const out = [];
  for (let i = 0; i < count; i++) {
    const x = rand() * width;
    const y = rand() * height;

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

// --- Atmospheric extinction ------------------------------------------------
// The one cue the field was still missing at the bottom of the sky: real
// starlight has to cross more air the lower it sits, so low stars are both
// DIMMER and REDDER than the same star overhead. Twinkle already varied with
// altitude (twinkleAmplitude); brightness and color did not, which is why the
// field read as uniformly bright right down to the ridgeline -- a flat wall
// of stars rather than a sky fading into its own horizon haze.

/** Relative air path at a given altitude (1 at the zenith, rising toward the
 *  horizon). The plane-parallel 1/sin(alt) form, capped where that
 *  approximation blows up. */
export function airmass(altitude01) {
  const altRad = clamp01(altitude01) * (Math.PI / 2);
  return Math.min(38, 1 / Math.max(Math.sin(altRad), 1 / 38));
}

const EXTINCTION_K = 0.11;     // magnitudes of light lost per unit air path
const EXTINCTION_FLOOR = 0.12; // horizon stars thin out, but never vanish entirely

/** Fraction of a star's light that survives the air path: 1 at the zenith,
 *  falling toward EXTINCTION_FLOOR at the horizon. */
export function extinction01(altitude01) {
  const dm = EXTINCTION_K * (airmass(altitude01) - 1);
  return Math.max(EXTINCTION_FLOOR, Math.pow(10, -0.4 * dm));
}

/** How far toward "horizon red" a star at this altitude should be pushed
 *  (0 overhead, →1 at the horizon). Blue light scatters out of the beam
 *  first, so what survives a long air path is the warm end -- the same
 *  physics that makes a setting sun orange. */
export function reddening01(altitude01) {
  return clamp01(1 - extinction01(altitude01));
}

// --- Dust lanes ------------------------------------------------------------
// The painted milky wash is one smooth gradient, which is the single most
// "computer-generated" thing about the night sky: the real plane is shot
// through with dark nebulae that occlude the glow behind them (the Great
// Rift). These are the occluders -- soft dark ellipses strung ALONG the
// plane's own axis, so the band gains structure instead of being a airbrush
// stripe.

/** Dark dust clouds lying along the galactic plane. Returned in field
 *  coordinates like the stars, with `alpha` as an occlusion strength. */
export function generateDustLanes(seed, count, width, height) {
  const rand = mulberry32((seed ^ 0x0d057) >>> 0 || 1);
  const out = [];
  for (let i = 0; i < count; i++) {
    const xFrac = rand();
    // Clouds hug the plane much more tightly than the stars do -- the rift
    // is a feature OF the band, not of the general sky.
    const off = ((rand() + rand()) - 1) * height * GALACTIC_BAND.halfFrac * 0.5;
    out.push({
      x: xFrac * width,
      y: galacticBandCenterY(xFrac, height) + off,
      // Long and thin, and lying along the plane's own tilt rather than flat.
      rx: width * (0.06 + rand() * 0.13),
      ry: height * (0.018 + rand() * 0.05),
      rot: Math.atan2(GALACTIC_BAND.tiltFrac * height, width) + (rand() - 0.5) * 0.5,
      alpha: 0.20 + rand() * 0.38,
      phase: rand() * Math.PI * 2,
    });
  }
  return out;
}

// --- Deep-sky objects ------------------------------------------------------
// A handful of faint non-stellar smudges. The astronomy that makes this read
// as a real sky rather than set dressing is WHERE each kind is allowed to
// live: open clusters and emission nebulae belong to our own galaxy's disc
// and therefore sit ON the plane, while external galaxies are hidden behind
// that same dust everywhere near it -- the zone of avoidance -- so they only
// ever appear well off the band.
export const DEEP_SKY_KINDS = ['cluster', 'nebula', 'galaxy'];

/** Faint deep-sky objects in field coordinates. Each carries the geometry
 *  and tint the renderer needs; none of them twinkle (they are resolved
 *  extended sources, not point sources). */
export function generateDeepSky(seed, count, width, height) {
  const rand = mulberry32((seed ^ 0xdee5) >>> 0 || 1);
  const half = height * GALACTIC_BAND.halfFrac;
  const out = [];
  for (let i = 0; i < count; i++) {
    // Cycle the kinds so a small count still gets one of each.
    const kind = DEEP_SKY_KINDS[i % DEEP_SKY_KINDS.length];
    const xFrac = rand();
    const centerY = galacticBandCenterY(xFrac, height);
    let y;
    if (kind === 'galaxy') {
      // Zone of avoidance: pushed clear of the band, either side.
      const side = rand() < 0.5 ? -1 : 1;
      y = centerY + side * half * (1.15 + rand() * 0.9);
    } else {
      y = centerY + ((rand() + rand()) - 1) * half * 0.6;
    }
    const r = height * (kind === 'cluster' ? 0.020 + rand() * 0.022
      : kind === 'nebula' ? 0.030 + rand() * 0.045
        : 0.016 + rand() * 0.022);
    out.push({
      kind,
      x: xFrac * width,
      y: clamp01(y / height) * height,
      r,
      // Galaxies are the only ones that read as flattened discs.
      squash: kind === 'galaxy' ? 0.30 + rand() * 0.22 : 0.72 + rand() * 0.28,
      rot: rand() * Math.PI,
      // Emission nebulae run hydrogen-red; clusters are hot young blue;
      // distant galaxies average out to an old, dim yellow-white.
      hue: kind === 'nebula' ? 340 + rand() * 30
        : kind === 'cluster' ? 205 + rand() * 30
          : 40 + rand() * 20,
      alpha: 0.05 + rand() * 0.07,
      phase: rand() * Math.PI * 2,
    });
  }
  return out;
}

// --- Planets ---------------------------------------------------------------
// Planets are what sell a sky as a sky rather than a starfield: they are
// noticeably brighter than anything around them, they are obviously COLORED,
// and -- because they present a resolved disc instead of a point -- they do
// not twinkle. They also share one line across the sky, the ecliptic, which
// is nothing like the galactic plane's tilt, so their alignment reads as a
// second, independent structure overlaid on the first.
const ECLIPTIC = { centerFrac: 0.52, tiltFrac: -0.30 };

/** Ecliptic height at horizontal position `xFrac`. */
export function eclipticY(xFrac, height) {
  return (ECLIPTIC.centerFrac + (xFrac - 0.5) * ECLIPTIC.tiltFrac) * height;
}

const PLANET_PALETTE = [
  { name: 'rust', hue: 14, sat: 62, bright: 0.72, size: 1.5 },
  { name: 'cream', hue: 42, sat: 34, bright: 1.00, size: 2.1 },
  { name: 'gold', hue: 50, sat: 46, bright: 0.80, size: 1.7 },
  { name: 'pearl', hue: 48, sat: 12, bright: 0.95, size: 1.9 },
  { name: 'ice', hue: 186, sat: 40, bright: 0.55, size: 1.3 },
];

/** Bright, steady, colored points strung along the ecliptic. */
export function generatePlanets(seed, count, width, height) {
  const rand = mulberry32((seed ^ 0x91a7e7) >>> 0 || 1);
  const out = [];
  const picks = PLANET_PALETTE.slice();
  for (let i = 0; i < count && picks.length > 0; i++) {
    const p = picks.splice(Math.floor(rand() * picks.length), 1)[0];
    const xFrac = (i + 0.5 + (rand() - 0.5) * 0.7) / Math.max(1, count);
    const y = eclipticY(xFrac, height) + (rand() - 0.5) * height * 0.05;
    out.push({
      ...p,
      x: clamp01(xFrac) * width,
      y: clamp01(y / height) * height,
      altitude01: 1 - clamp01(y / height),
      phase: rand() * Math.PI * 2,
    });
  }
  return out;
}
