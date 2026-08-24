// Atmospheric scattering for the 2D stage.
//
// Two-term model (Rayleigh molecules + Mie aerosols), sampled into a
// handful of gradients rather than integrated per pixel. The physics that
// actually reads on a painted sky, and that the previous dawn/dusk full-
// rect washes were missing:
//
//   1. Path length. More air toward the horizon (airmass) → more in-scatter
//      AND more extinction of the sun's own beam. Zenith is deep blue at
//      noon; the horizon is pale; a setting sun goes orange because the
//      blue has already been scattered out of the line of sight.
//   2. Asymmetry. Real air is far brighter looking toward the light than
//      away from it (forward scatter). A vertical gradient alone is a tint;
//      a radial from the sun is what makes the sky look lit.
//   3. Twilight. The sun a few degrees below the horizon still lights the
//      upper air. A hard night cut at alt=0 is why a flat color slap at
//      the handoff never looked like a sky.
//
// Intensity is deliberately modest: this sits ON the biome's own sky
// gradient, it doesn't replace it. Biomes keep their identity; scattering
// is the light in the air.
import { clamp01, lerp, smoothstep } from '../utils/math.js';
import { airmass } from './StarCatalogue.js';

// Optical depth at zenith for a nominal clear atmosphere.
const TAU_R = 0.22; // Rayleigh (molecules) — the blue
const TAU_M = 0.09; // Mie (aerosols) — the haze, not fog

// Relative channel weights. Rayleigh ~ λ^-4 against a D65-ish sun;
// Mie is almost grey with a warm dust lean; sunset is what's left of
// the beam after the blue has been scattered out; twilight is the
// Chappuis ozone band that turns the zenith purple at blue hour.
const RAYLEIGH = [0.28, 0.52, 1.00];
const MIE = [1.00, 0.88, 0.70];
const SUNSET = [1.00, 0.40, 0.14];
const TWILIGHT = [0.40, 0.30, 0.78];
const NIGHT = [0.10, 0.14, 0.28];
const SODIUM = [1.00, 0.72, 0.38]; // city light-pollution Mie

const CIVIL_TWILIGHT = 0.12; // how far below the horizon the air still glows

/**
 * How much the sun still lights the air. 1 at zenith, a warm remainder
 * right at the horizon, then a short civil-twilight tail below it.
 * `sunAlt` is signed: 0 at the horizon, +1 at zenith, −1 at nadir.
 */
export function sunIrradiance(sunAlt) {
  if (!(Number.isFinite(sunAlt))) return 0;
  if (sunAlt >= 0) return 0.38 + 0.62 * smoothstep(0, 0.55, sunAlt);
  return 0.38 * clamp01(1 + sunAlt / CIVIL_TWILIGHT);
}

/**
 * Shaft (crepuscular-ray) envelope. Peaks just after sunrise / before
 * sunset, when the path through the air is long but the sun is still up.
 * Zero at zenith (no long path) and at/below the horizon (no shafts).
 */
export function shaftEnvelope(sunAlt) {
  if (!(sunAlt > 0.02) || sunAlt > 0.48) return 0;
  return Math.sin(Math.PI * (sunAlt - 0.02) / 0.46);
}

function rgb01(r, g, b, a) {
  return {
    r: Math.round(clamp01(r) * 255),
    g: Math.round(clamp01(g) * 255),
    b: Math.round(clamp01(b) * 255),
    a: clamp01(a),
  };
}

/** One view direction through the air column. viewAlt 1 = zenith, 0 = horizon. */
function sampleView(viewAlt, sunAlt, irr, haze) {
  const mView = airmass(Math.max(0.012, viewAlt));
  // Colour of the illuminating sunlight is the sun's OWN path, not the
  // look direction. A high sun still lights the horizon with white-blue
  // light (pale sky); only a low sun has already lost its blue, so the
  // same horizon goes orange. Mixing those two was why an earlier version
  // painted dusk the same colour as noon.
  const mSun = sunAlt >= 0
    ? airmass(Math.max(0.012, sunAlt))
    : airmass(0.012) * (1 + Math.abs(sunAlt) * 3);
  const rIn = 1 - Math.exp(-TAU_R * mView);
  const mIn = 1 - Math.exp(-TAU_M * mView * haze);
  const sunRed = clamp01((mSun - 1.15) / 12);
  const r = irr * (RAYLEIGH[0] * rIn * (1 - sunRed) + SUNSET[0] * rIn * sunRed + MIE[0] * mIn * 0.55);
  const g = irr * (RAYLEIGH[1] * rIn * (1 - sunRed) + SUNSET[1] * rIn * sunRed + MIE[1] * mIn * 0.55);
  const b = irr * (RAYLEIGH[2] * rIn * (1 - sunRed) + SUNSET[2] * rIn * sunRed + MIE[2] * mIn * 0.55);
  // Peak channel used as a normalizer so noon doesn't blow out to white
  // and twilight doesn't collapse to black — we want hue, then a separate
  // alpha for how much of the biome sky this is allowed to cover.
  const peak = Math.max(r, g, b, 1e-6);
  return { r: r / peak, g: g / peak, b: b / peak, scatter: rIn * 0.65 + mIn * 0.35, sunRed, mView };
}

/**
 * The scattering field for one frame. Pure; BiomeManager paints it with
 * a vertical Rayleigh gradient, a radial Mie glow on the light, and a
 * short horizon limb. `city` leans the night horizon toward sodium Mie
 * (light pollution) instead of leaving it as empty airglow.
 *
 * @param {object} o
 * @param {number} o.sunAlt   signed altitude, −1..1 (DayNight.sunScreenFrac.altSigned)
 * @param {number} [o.night]  0..1 night mix
 * @param {number} [o.hazeMul] biome personality haze dial, default 1
 * @param {boolean} [o.city]
 */
export function scatterSky({ sunAlt = 1, night = 0, hazeMul = 1, city = false } = {}) {
  const irr = sunIrradiance(sunAlt);
  const night01 = clamp01(night);
  const haze = Math.max(0.35, Number.isFinite(hazeMul) ? hazeMul : 1);
  const day = clamp01(1 - night01);

  const zen = sampleView(1, sunAlt, irr, haze);
  const hor = sampleView(0.04, sunAlt, irr, haze);

  // Blue hour: as the sun nears the horizon the zenith pulls toward the
  // Chappuis purple instead of staying a paler noon-blue.
  const blueHour = smoothstep(0.32, 0.0, Math.max(0, sunAlt)) * Math.max(day, irr);
  const zr = lerp(zen.r, TWILIGHT[0], blueHour * 0.55);
  const zg = lerp(zen.g, TWILIGHT[1], blueHour * 0.55);
  const zb = lerp(zen.b, TWILIGHT[2], blueHour * 0.55);

  // Night collapses the Rayleigh toward residual airglow so stars stay
  // the event, not a milky veil.
  const nr = lerp(zr, NIGHT[0], night01);
  const ng = lerp(zg, NIGHT[1], night01);
  const nb = lerp(zb, NIGHT[2], night01);

  let hr = hor.r, hg = hor.g, hb = hor.b;
  if (city) {
    hr = lerp(hr, SODIUM[0], 0.40);
    hg = lerp(hg, SODIUM[1], 0.40);
    hb = lerp(hb, SODIUM[2], 0.40);
  }

  // Overlay alphas: modest. Noon zenith ~0.20, dusk horizon ~0.34, night ~0.05.
  const zenithA = (0.10 + 0.20 * zen.scatter) * (0.22 + 0.78 * day) * (city ? 0.55 : 1);
  const horizonA = (0.12 + 0.26 * hor.scatter * day + 0.10 * night01 * (city ? 1.3 : 0.45))
    * (0.85 + 0.15 * haze);

  // Mie corona: larger and warmer at low sun, cooler and smaller at night
  // when the moon is the light. Night must not inherit sunset-orange just
  // because the (unseen) sun is below the horizon.
  const low = clamp01(1 - Math.max(0, sunAlt));
  const mieA = (0.08 + 0.24 * irr * (0.4 + 0.6 * low) * day + 0.06 * night01)
    * (city ? 0.55 : 1) * (0.75 + 0.25 * haze);
  let mieR = lerp(MIE[0], SUNSET[0], low * 0.7 * day);
  let mieG = lerp(MIE[1], SUNSET[1], low * 0.7 * day);
  let mieB = lerp(MIE[2], SUNSET[2], low * 0.7 * day);
  mieR = lerp(mieR, 0.72, night01);
  mieG = lerp(mieG, 0.84, night01);
  mieB = lerp(mieB, 1.00, night01);

  const limbA = (0.05 + 0.20 * low * irr * day + 0.07 * night01 * (city ? 1 : 0.15)) * (0.8 + 0.2 * haze);

  return {
    sunAlt,
    irr,
    zenith: rgb01(nr, ng, nb, zenithA),
    horizon: rgb01(hr, hg, hb, clamp01(horizonA)),
    mie: rgb01(
      city ? lerp(mieR, 0.72, 0.4) : mieR,
      city ? lerp(mieG, 0.82, 0.4) : mieG,
      city ? lerp(mieB, 1.00, 0.4) : mieB,
      clamp01(mieA),
    ),
    mieRadiusFrac: 0.34 + 0.36 * low,           // of canvas hypotenuse
    sunGlowRadiusFrac: 0.55 + 0.30 * low,       // directional sky brightening
    sunGlowA: clamp01((0.07 + 0.18 * irr * (0.45 + 0.55 * low)) * day),
    limb: rgb01(hr, hg, hb, clamp01(limbA)),
    limbHeightFrac: 0.28 + 0.08 * low,          // how far up the limb climbs
    shaft: shaftEnvelope(sunAlt) * irr * day,
  };
}

/** Warmth (R/B) of the horizon in-scatter — what aerial-perspective haze
 *  should pull toward, instead of a fixed peach. Higher at low sun. */
export function horizonWarmth(field) {
  if (!field?.horizon) return 0;
  const { r, b } = field.horizon;
  return (r + 1) / (b + 1);
}
