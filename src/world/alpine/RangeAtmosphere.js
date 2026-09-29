// Range v2 valley atmosphere (plan §2 "Light, atmosphere", Task 13): mist
// that collects between landforms. Shared by the terrain and forest shaders
// (MIST_GLSL) with an exact JS twin (mistAmount) for tests and CPU queries.
//
// Model. An exponential height layer anchored at the view's valley floor
// (its hydro-flattened water level): density(y) = d0 * exp(-(y - base) / H),
// masked by a slowly drifting 2D noise so it lies in irregular banks rather
// than a uniform sheet or oval stamps. The optical depth is integrated along
// the ray from the camera to the shaded point, so a nearer ridge stops the
// ray before the mist behind it: closer objects occlude farther mist by
// construction. Drift is a pure function of heard time (pause holds it,
// seek reconstructs it). Distant atmospheric perspective stays separate
// (the shaders' air term, applied after the mist).

export const MIST_SAMPLES = 6;
export const MIST_NOISE_M = 900;

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
function fbm(x, y) {
  return 0.55 * vnoise(x, y) + 0.3 * vnoise(x * 2.03 + 17.1, y * 2.03 - 5.3) + 0.15 * vnoise(x * 4.1 - 3.7, y * 4.1 + 9.2);
}

/** Mist mask (0..1) at world (x, z) and heard time t. */
export function mistMask(x, z, tSec) {
  const n = fbm((x + tSec * 1.6) / MIST_NOISE_M, (z + tSec * 0.7) / MIST_NOISE_M);
  const t = Math.min(1, Math.max(0, (n - 0.35) / 0.4));
  return t * t * (3 - 2 * t);
}

/**
 * Mist opacity (0..1) between the camera `cam` and point `p` ([x, y, z] m).
 * params: { density (1/m at the base; 0 = off), baseM, heightM, tSec }.
 */
export function mistAmount(cam, p, { density = 0, baseM = 0, heightM = 220, tSec = 0 } = {}) {
  if (!(density > 0)) return 0;
  const dx = p[0] - cam[0], dy = p[1] - cam[1], dz = p[2] - cam[2];
  const L = Math.hypot(dx, dy, dz);
  let od = 0;
  for (let i = 0; i < MIST_SAMPLES; i++) {
    // Samples crowd toward the shaded point, where rays meet the valley air.
    const s = (i + 0.5) / MIST_SAMPLES;
    const t = 1 - (1 - s) * (1 - s);
    const w = 2 * (1 - s);
    const y = cam[1] + dy * t;
    const layer = Math.exp(-Math.max(0, y - baseM) / heightM);
    od += w * layer * mistMask(cam[0] + dx * t, cam[2] + dz * t, tSec);
  }
  od *= density * L / MIST_SAMPLES;
  return 1 - Math.exp(-od);
}

/** Per-view mist parameters from the material rules and frame state. */
export function mistParams({ rules = {}, waterLevelM = null, heightRange = [0, 1000], tSec = 0, calm01 = 0 } = {}) {
  const wet = Math.max(0, Math.min(1, rules.wetness ?? 0.5));
  const base = Number.isFinite(waterLevelM) ? waterLevelM : heightRange[0] + 0.08 * (heightRange[1] - heightRange[0]);
  return {
    // Wet ranges hold valley mist; calm passages let it settle thicker.
    density: 3.2e-4 * wet * (0.8 + 0.4 * Math.max(0, Math.min(1, calm01))),
    baseM: base,
    heightM: 160 + 160 * wet,
    tSec,
  };
}

export const MIST_GLSL = /* glsl */`
  uniform float uMistDensity;
  uniform float uMistBase;
  uniform float uMistHeight;
  uniform float uMistTime;
  uniform vec3 uMistColor;
  float mistHash(vec2 p) { return fract(sin(p.x * 127.1 + p.y * 311.7) * 43758.5453); }
  float mistVnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = mistHash(i), b = mistHash(i + vec2(1.0, 0.0)), c = mistHash(i + vec2(0.0, 1.0)), d = mistHash(i + vec2(1.0, 1.0));
    return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
  }
  float mistMask(vec2 xz) {
    vec2 p = (xz + vec2(uMistTime * 1.6, uMistTime * 0.7)) / ${MIST_NOISE_M.toFixed(1)};
    float n = 0.55 * mistVnoise(p) + 0.3 * mistVnoise(p * 2.03 + vec2(17.1, -5.3)) + 0.15 * mistVnoise(p * 4.1 + vec2(-3.7, 9.2));
    return smoothstep(0.35, 0.75, n);
  }
  float mistAmount(vec3 cam, vec3 p) {
    if (uMistDensity <= 0.0) return 0.0;
    vec3 d = p - cam;
    float L = length(d);
    float od = 0.0;
    for (int i = 0; i < ${MIST_SAMPLES}; i++) {
      float s = (float(i) + 0.5) / ${MIST_SAMPLES.toFixed(1)};
      float t = 1.0 - (1.0 - s) * (1.0 - s);
      float w = 2.0 * (1.0 - s);
      vec3 q = cam + d * t;
      od += w * exp(-max(0.0, q.y - uMistBase) / uMistHeight) * mistMask(q.xz);
    }
    od *= uMistDensity * L / ${MIST_SAMPLES.toFixed(1)};
    return 1.0 - exp(-od);
  }
`;

/** Local light from an emitter on the rock stage: intensity bounded, and
 *  softened (not removed) under reduced flash and with height. */
export function emitterStrength({ airbornePx = 0, reducedFlash = false } = {}) {
  const lift = Math.min(1, Math.max(0, airbornePx / 160));
  return (reducedFlash ? 0.12 : 0.22) * (1 - 0.6 * lift);
}
