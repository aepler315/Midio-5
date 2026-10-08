// Range v2 valley atmosphere (plan §2 "Light, atmosphere", Task 13): mist
// that collects between landforms. Shared by the terrain and forest shaders
// (MIST_GLSL) with an exact JS twin (mistAmount) for tests and CPU queries.
//
// Model. An exponential height layer anchored at the view's valley floor
// (its hydro-flattened water level): density(y) = d0 * exp(-(y - base) / H),
// masked by a 2D noise so it lies in irregular banks rather than a uniform
// sheet or oval stamps. Each of the noise's three octaves drifts on its own
// heading and speed, with a slow sway, so banks thin, merge and re-form as
// they go instead of sliding past as one rigid sheet. The optical depth is integrated along
// the ray from the camera to the shaded point, so a nearer ridge stops the
// ray before the mist behind it: closer objects occlude farther mist by
// construction. Drift is a pure function of heard time (pause holds it,
// seek reconstructs it). Distant atmospheric perspective stays separate
// (the shaders' air term, applied after the mist).
//
// Cloud sea. In quiet passages (CloudSea.js) the layer fills toward a flat
// top between the valley floor and the eye: below the top the density is
// even and the banks close up, so the valley floods with cloud and the
// peaks stand above it. Its colour is read where the view ray meets the
// top, so billows lie on that plane in perspective.

export const MIST_SAMPLES = 6;
export const MIST_NOISE_M = 900;
/** Per-octave drift (m), largest banks first: [vx, vz] m/s of steady wind,
 *  then a sway of [ax, az] m with periods [px, pz] s and phases. Different
 *  headings per octave make the banks change shape while they move. */
export const MIST_DRIFT = Object.freeze([
  Object.freeze({ v: [1.3, 0.6], a: [160, 120], p: [97, 71], ph: [0, 1.1] }),
  Object.freeze({ v: [2.2, -0.5], a: [110, 140], p: [53, 61], ph: [0.4, 2.3] }),
  Object.freeze({ v: [0.4, 2.1], a: [70, 60], p: [37, 29], ph: [1.7, 0.6] }),
]);
/** Cloud sea: density (1/m) when full, its top as a fraction of the way
 *  from the valley floor to the eye, the soft edge of that top (m), and
 *  the size of the billows on it (m). */
export const SEA_DENSITY = 1.5e-3;
export const SEA_TOP_FROM = 0.04;
export const SEA_TOP_TO = 0.65;
export const SEA_TOP_SOFT_BELOW_M = 60;
export const SEA_TOP_SOFT_ABOVE_M = 30;
export const SEA_BILLOW_M = 520;

const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function hash21(x, y) {
  // Same arithmetic as the GLSL hash (fract of a sine), in float64; the
  // twin agrees with the shader to shader precision, which tests allow for.
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash21(ix, iy), b = hash21(ix + 1, iy), c = hash21(ix, iy + 1), d = hash21(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
/** Each octave's drift offset (m) at heard time t: [[x, z] x 3]. The
 *  shaders receive these as uMistDrift, so both sides read one value. */
export function mistDrift(tSec) {
  const t = Number.isFinite(tSec) ? tSec : 0;
  return MIST_DRIFT.map(({ v, a, p, ph }) => [
    v[0] * t + a[0] * Math.sin(t / p[0] + ph[0]),
    v[1] * t + a[1] * Math.sin(t / p[1] + ph[1]),
  ]);
}

function maskAt(x, z, d) {
  const M = MIST_NOISE_M;
  const n = 0.55 * vnoise((x + d[0][0]) / M, (z + d[0][1]) / M)
    + 0.3 * vnoise((x + d[1][0]) / M * 2.03 + 17.1, (z + d[1][1]) / M * 2.03 - 5.3)
    + 0.15 * vnoise((x + d[2][0]) / M * 4.1 - 3.7, (z + d[2][1]) / M * 4.1 + 9.2);
  const t = Math.min(1, Math.max(0, (n - 0.35) / 0.4));
  return t * t * (3 - 2 * t);
}

/** Mist mask (0..1) at world (x, z) and heard time t. */
export function mistMask(x, z, tSec) {
  return maskAt(x, z, mistDrift(tSec));
}

/**
 * Mist opacity (0..1) between the camera `cam` and point `p` ([x, y, z] m).
 * params: { density (1/m at the base; 0 = off), baseM, heightM, tSec }.
 */
export function mistAmount(cam, p, { density = 0, baseM = 0, heightM = 220, tSec = 0, steps = MIST_SAMPLES, topM = 1e9, fill = 0 } = {}) {
  if (!(density > 0)) return 0;
  const n = Math.max(1, Math.min(MIST_SAMPLES, Math.round(steps)));
  const dx = p[0] - cam[0], dy = p[1] - cam[1], dz = p[2] - cam[2];
  const L = Math.hypot(dx, dy, dz);
  const drift = mistDrift(tSec);
  let od = 0;
  for (let i = 0; i < n; i++) {
    // Samples crowd toward the shaded point, where rays meet the valley air.
    const s = (i + 0.5) / n;
    const t = 1 - (1 - s) * (1 - s);
    const w = 2 * (1 - s);
    const y = cam[1] + dy * t;
    const x = cam[0] + dx * t, z = cam[2] + dz * t;
    const layer = mix(Math.exp(-Math.max(0, y - baseM) / heightM), 1 - smoothstep(topM - SEA_TOP_SOFT_BELOW_M, topM + SEA_TOP_SOFT_ABOVE_M, y), fill);
    let mask = maskAt(x, z, drift);
    if (fill > 0) mask = mix(mask, 0.6 + 0.4 * maskAt(x * 0.5, z * 0.5, drift), fill);
    od += w * layer * mask;
  }
  od *= density * L / n;
  return 1 - Math.exp(-od);
}

/**
 * Per-view mist parameters from the material rules and frame state.
 * `sea01` is how full the cloud sea is (CloudSea.js); its top rises from
 * just above the valley floor (SEA_TOP_FROM) to SEA_TOP_TO of the way to
 * the eye at `cameraY`, so it wells up out of the valley rather than
 * appearing as a sheet at mid-height, and the camera always looks down on
 * it. Its density blends from the valley mist's toward SEA_DENSITY on the
 * same curve, with no step where the sea takes over.
 */
export function mistParams({ rules = {}, waterLevelM = null, heightRange = [0, 1000], tSec = 0, calm01 = 0, sea01 = 0, cameraY = null } = {}) {
  const wet = Math.max(0, Math.min(1, rules.wetness ?? 0.5));
  const base = Number.isFinite(waterLevelM) ? waterLevelM : heightRange[0] + 0.08 * (heightRange[1] - heightRange[0]);
  const sea = Number.isFinite(cameraY) && cameraY > base ? Math.max(0, Math.min(1, sea01)) : 0;
  // Wet ranges hold valley mist; calm passages let it settle thicker.
  const density = 3.2e-4 * wet * (0.8 + 0.4 * Math.max(0, Math.min(1, calm01)));
  return {
    density: mix(density, Math.max(density, SEA_DENSITY), sea),
    baseM: base,
    heightM: 160 + 160 * wet,
    tSec,
    topM: sea > 0 ? base + (cameraY - base) * (SEA_TOP_FROM + (SEA_TOP_TO - SEA_TOP_FROM) * sea) : 1e9,
    fill: sea,
  };
}

export const MIST_GLSL = /* glsl */`
  uniform float uMistDensity;
  uniform float uMistSteps; // 1..MIST_SAMPLES: the quality ladder's fog sampling
  uniform float uMistBase;
  uniform float uMistHeight;
  uniform float uMistTime;
  uniform vec2 uMistDrift[3]; // mistDrift(heard time): each octave's offset (m)
  uniform vec3 uMistColor;
  uniform float uMistTop;  // the cloud sea's top (m); far above when none
  uniform float uMistFill; // 0..1 how full the cloud sea is
  float mistHash(vec2 p) { return fract(sin(p.x * 127.1 + p.y * 311.7) * 43758.5453); }
  float mistVnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = mistHash(i), b = mistHash(i + vec2(1.0, 0.0)), c = mistHash(i + vec2(0.0, 1.0)), d = mistHash(i + vec2(1.0, 1.0));
    return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
  }
  float mistMask(vec2 xz) {
    float n = 0.55 * mistVnoise((xz + uMistDrift[0]) / ${MIST_NOISE_M.toFixed(1)})
      + 0.3 * mistVnoise((xz + uMistDrift[1]) / ${MIST_NOISE_M.toFixed(1)} * 2.03 + vec2(17.1, -5.3))
      + 0.15 * mistVnoise((xz + uMistDrift[2]) / ${MIST_NOISE_M.toFixed(1)} * 4.1 + vec2(-3.7, 9.2));
    return smoothstep(0.35, 0.75, n);
  }
  float mistAmount(vec3 cam, vec3 p) {
    if (uMistDensity <= 0.0) return 0.0;
    vec3 d = p - cam;
    float L = length(d);
    float od = 0.0;
    float n = clamp(floor(uMistSteps + 0.5), 1.0, ${MIST_SAMPLES.toFixed(1)});
    for (int i = 0; i < ${MIST_SAMPLES}; i++) {
      if (float(i) >= n) break;
      float s = (float(i) + 0.5) / n;
      float t = 1.0 - (1.0 - s) * (1.0 - s);
      float w = 2.0 * (1.0 - s);
      vec3 q = cam + d * t;
      float layer = mix(exp(-max(0.0, q.y - uMistBase) / uMistHeight),
        1.0 - smoothstep(uMistTop - ${SEA_TOP_SOFT_BELOW_M.toFixed(1)}, uMistTop + ${SEA_TOP_SOFT_ABOVE_M.toFixed(1)}, q.y), uMistFill);
      // The cloud sea's wider banks cost a second mask; only pay for it
      // while the sea is up.
      float mask = mistMask(q.xz);
      if (uMistFill > 0.0) mask = mix(mask, 0.6 + 0.4 * mistMask(q.xz * 0.5), uMistFill);
      od += w * layer * mask;
    }
    od *= uMistDensity * L / n;
    return 1.0 - exp(-od);
  }
  // The mist's colour: under a cloud sea, read where the view ray meets its
  // top, with brighter crowns and shaded troughs.
  vec3 mistColorAt(vec3 cam, vec3 p) {
    // A point above the top is seen without crossing it: plain haze.
    if (uMistFill <= 0.0 || cam.y <= uMistTop || p.y >= uMistTop) return uMistColor;
    vec3 hit = cam + (p - cam) * clamp((cam.y - uMistTop) / (cam.y - p.y), 0.0, 1.0);
    // The billows ride the mist's own octave drifts, so they roll and
    // reshape rather than scroll as one sheet.
    float b = 0.55 * mistVnoise((hit.xz + 1.8 * uMistDrift[0]) / ${SEA_BILLOW_M.toFixed(1)})
      + 0.3 * mistVnoise((hit.xz + 1.8 * uMistDrift[1]) / ${SEA_BILLOW_M.toFixed(1)} * 2.3 + vec2(5.1, 1.7))
      + 0.15 * mistVnoise((hit.xz + 1.8 * uMistDrift[2]) / ${SEA_BILLOW_M.toFixed(1)} * 5.1 + vec2(-2.3, 8.4));
    vec3 color=uMistColor * mix(1.0, 0.5 + 0.9 * b * b, uMistFill);
    float giant=giantCloud(hit);
    // Billowing crowns and shaded troughs form the figure on the cloud
    // plane. The real ray/terrain intersection supplies its occlusion.
    vec3 crown=max(uMistColor,vec3(.09,.13,.19))*(.85+b*.95);
    return mix(color*(1.0-max(uGiantPeak[2],uGiantPeak[0]*uMidioCloud)*.25),crown,giant*.9);
  }
`;

/** Local light from an emitter on the rock stage: intensity bounded, and
 *  softened (not removed) under reduced flash and with height. */
export function emitterStrength({ airbornePx = 0, reducedFlash = false } = {}) {
  const lift = Math.min(1, Math.max(0, airbornePx / 160));
  return (reducedFlash ? 0.12 : 0.22) * (1 - 0.6 * lift);
}
