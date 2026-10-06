// An imagined moonlit valley in camera-local metres: y is up and -z recedes.
// World features are sampled at x + travelM. No tiled chunks, accumulated
// frame state or music-dependent phase can make a seek reveal a different land.

export const JOURNEY_VIEW = Object.freeze({
  id: 'moonlit-journey',
  name: 'Moonlit Journey',
  title: 'An imagined moonlit valley',
  place: 'Imagined valley',
  camera: Object.freeze({
    eyeStartM: Object.freeze([0, 245, 820]),
    eyeEndM: Object.freeze([0, 245, 820]),
    targetStartM: Object.freeze([0, 230, -1200]),
    targetEndM: Object.freeze([0, 230, -1200]),
    fovYDeg: 44,
  }),
  composition: Object.freeze({ foreground: 'none', nearLedgeMaxFrac: 0 }),
});

// Shared dimensional constants are interpolated into the GLSL twin below.
// The two ranges' low foothills overlap in depth; their crests are separate.
const DIMENSIONS = Object.freeze({
  nearShore: 170,
  farShore: -700,
  bankDepth: 650,
  firstDepth: 1350,
  rearStart: -1850,
  rearDepth: 1800,
  rearFootHeight: 45,
});

const finite = value => Number.isFinite(value) ? value : 0;
const unit = value => Math.max(0, Math.min(1, finite(value)));
const smooth = (a, b, value) => {
  const t = unit((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Heard time is the entire travel clock. Live controls only affect height,
 * never the rate/phase of the world, including after a large seek. */
export function sampleJourneyState({ timeMs = 0, seed = 0, music = null, reducedMotion = false } = {}) {
  const timeSec = reducedMotion ? 0 : Math.max(0, finite(timeMs)) / 1000;
  const strength = value => reducedMotion ? 0 : unit(value);
  return {
    timeSec,
    travelM: 38 * timeSec + 24 * Math.sin(timeSec * .025),
    // Keep the phase small enough for ordinary highp shader arithmetic.
    seed: ((finite(seed) % 4096) + 4096) % 4096,
    energy: strength(music?.energy01),
    bass: strength(music?.bass01),
    melody: strength(music?.melody01),
    pulse: strength(music?.pulse01),
    bands: Array.from({ length: 7 }, (_, i) => strength(music?.bands?.[i])),
  };
}

const STILL = sampleJourneyState();

// Bounded, analytic two-dimensional noise. Three incommensurate waves keep
// both positions and slopes continuous without a float-sensitive hash/fract.
function noise(x, z) {
  return .5 * Math.sin(.89 * x + .61 * z)
    + .3 * Math.sin(1.71 * x - 1.37 * z + 1.8)
    + .2 * Math.sin(3.11 * x + 2.17 * z + 4.4);
}

function ridge(x, z) {
  const n = noise(x, z);
  // A softened absolute value makes distinct arêtes without a cusp in the
  // analytical surface normal. Its small radius keeps the silhouette crisp.
  return 1.0008 - Math.sqrt(n * n + .0016);
}

export function journeyNearShore(x, state = STILL) {
  const worldX = finite(x) + state.travelM, phase = state.seed * .013;
  return DIMENSIONS.nearShore + 42 * noise(worldX * .00165 + phase, 1.7)
    + 18 * Math.sin(worldX * .00071 - phase * .37 + state.timeSec * .017);
}

export function journeyFarShore(x, state = STILL) {
  const worldX = finite(x) + state.travelM, phase = state.seed * .013;
  return DIMENSIONS.farShore + 86 * noise(worldX * .0012 + phase * .73, 3.2)
    + 34 * Math.sin(worldX * .00083 + phase * .41 + state.timeSec * .011 + 1.1);
}

/** Water and actor contact share this exact zero at the near shoreline.
 * A bank 35m inland is only a few metres high; even remote foreground ground
 * stays below 36m. Its gentle depth variation makes a broad rolling bank. */
export function journeyGroundHeight(x, z, state = STILL) {
  const worldX = finite(x) + state.travelM, phase = state.seed * .013;
  const inland = Math.max(0, finite(z) - journeyNearShore(x, state));
  return inland / (inland + 225)
    * (30 + 6 * noise(worldX * .0032 + phase, finite(z) * .00018));
}

// Bands overlap through a broad 2D field, so their response follows mountain
// shoulders instead of seven screen-space columns. Weights are C1 at edges.
function bandStrength(worldX, z, state) {
  const phase = state.seed * .013;
  const position = .5 + .5 * noise(worldX * .00095 + phase * .33, z * .0011 + phase * .2);
  let weighted = 0, total = 0;
  for (let i = 0; i < 7; i++) {
    const distance = 3 * (position - i / 6);
    const support = Math.max(0, 1 - distance * distance);
    const weight = support * support;
    weighted += state.bands[i] * weight;
    total += weight;
  }
  return weighted / total;
}

/** A true (x,z) heightfield for each layer. v samples depth through broad
 * foothills, a wandering crest and a receding slope; x stays render-local. */
export function journeySurface(x, v, layer, state = STILL) {
  x = finite(x);
  v = unit(v);
  if (layer < .5) {
    const z = journeyNearShore(x, state) + DIMENSIONS.bankDepth * v;
    return [x, journeyGroundHeight(x, z, state), z];
  }
  const worldX = x + state.travelM, phase = state.seed * .013;
  const shoulder = smooth(.18, .5, v) * (1 - .7 * smooth(.55, .9, v));
  if (layer < 1.5) {
    const z = journeyFarShore(x, state) - DIMENSIONS.firstDepth * v;
    const crest = .51 + .11 * noise(worldX * .0014 + phase * .54, 4.2);
    const envelope = smooth(0, crest, v) * (1 - .86 * smooth(crest, 1, v));
    const spine = ridge(worldX * .0034 + phase * .71, 2.7);
    const relief = .5 + .5 * noise(worldX * .0013 - phase * .39, 4.9);
    const spurs = ridge(worldX * .0062 + phase * .6, z * .0038);
    const height = 205 + 195 * spine * (.65 + .35 * relief) + 30 * spurs
      + 22 * state.energy + 12 * state.bass * shoulder + 8 * state.pulse * spurs;
    return [x, envelope * envelope * height, z];
  }
  const z = DIMENSIONS.rearStart + 45 * noise(worldX * .0013 + phase * .8, 4.3)
    - DIMENSIONS.rearDepth * v;
  const crest = .48 + .085 * noise(worldX * .0009 + phase * .49, 7.3);
  const envelope = smooth(0, crest, v) * (1 - .86 * smooth(crest, 1, v));
  // The dominant spine fixes real passes between summits. Broad modulation
  // gives each summit its own elevation; subordinate 2D spurs carve faces
  // rather than letting every x find another equally tall crest farther back.
  const spine = ridge(worldX * .0021 + phase * .63, 4.1);
  const relief = .5 + .5 * noise(worldX * .00077 - phase * .28, 8.7);
  const spurs = ridge(worldX * .0044 + phase * .23, z * .0023 - phase * .5);
  const height = 360 + 500 * spine * (.55 + .45 * relief) + 35 * spurs
    + 36 * state.energy + 26 * state.melody * shoulder
    + 34 * bandStrength(worldX, z, state) + 10 * state.pulse * spurs;
  return [x, DIMENSIONS.rearFootHeight + envelope * envelope * height, z];
}

const glslNumber = value => Number.isInteger(value) ? `${value}.0` : `${value}`;

// Numerical twin of the CPU helpers. Include the same text in terrain,
// water clipping, normals and reflection shaders to preserve contact edges.
export const JOURNEY_SURFACE_GLSL = /* glsl */`
  uniform float uJourneyTime;
  uniform float uJourneyTravel;
  uniform float uJourneySeed;
  uniform float uJourneyEnergy;
  uniform float uJourneyBass;
  uniform float uJourneyMelody;
  uniform float uJourneyPulse;
  uniform float uJourneyBands[7];

  float journeyNoise(float x, float z) {
    return 0.5 * sin(0.89 * x + 0.61 * z)
      + 0.3 * sin(1.71 * x - 1.37 * z + 1.8)
      + 0.2 * sin(3.11 * x + 2.17 * z + 4.4);
  }

  float journeyRidge(float x, float z) {
    float n = journeyNoise(x, z);
    return 1.0008 - sqrt(n * n + 0.0016);
  }

  float journeyNearShore(float x) {
    float worldX = x + uJourneyTravel, phase = uJourneySeed * 0.013;
    return ${glslNumber(DIMENSIONS.nearShore)} + 42.0 * journeyNoise(worldX * 0.00165 + phase, 1.7)
      + 18.0 * sin(worldX * 0.00071 - phase * 0.37 + uJourneyTime * 0.017);
  }

  float journeyFarShore(float x) {
    float worldX = x + uJourneyTravel, phase = uJourneySeed * 0.013;
    return ${glslNumber(DIMENSIONS.farShore)} + 86.0 * journeyNoise(worldX * 0.0012 + phase * 0.73, 3.2)
      + 34.0 * sin(worldX * 0.00083 + phase * 0.41 + uJourneyTime * 0.011 + 1.1);
  }

  float journeyGroundHeight(vec2 xz) {
    float worldX = xz.x + uJourneyTravel, phase = uJourneySeed * 0.013;
    float inland = max(0.0, xz.y - journeyNearShore(xz.x));
    return inland / (inland + 225.0)
      * (30.0 + 6.0 * journeyNoise(worldX * 0.0032 + phase, xz.y * 0.00018));
  }

  float journeyBandStrength(float worldX, float z) {
    float phase = uJourneySeed * 0.013;
    float position = 0.5 + 0.5 * journeyNoise(worldX * 0.00095 + phase * 0.33, z * 0.0011 + phase * 0.2);
    float weighted = 0.0, total = 0.0;
    for (int i = 0; i < 7; i++) {
      float distance = 3.0 * (position - float(i) / 6.0);
      float support = max(0.0, 1.0 - distance * distance);
      float weight = support * support;
      weighted += uJourneyBands[i] * weight;
      total += weight;
    }
    return weighted / total;
  }

  vec3 journeySurface(vec2 grid, float layer) {
    float x = grid.x, v = clamp(grid.y, 0.0, 1.0);
    if (layer < 0.5) {
      float z = journeyNearShore(x) + ${glslNumber(DIMENSIONS.bankDepth)} * v;
      return vec3(x, journeyGroundHeight(vec2(x, z)), z);
    }
    float worldX = x + uJourneyTravel, phase = uJourneySeed * 0.013;
    float shoulder = smoothstep(0.18, 0.5, v) * (1.0 - 0.7 * smoothstep(0.55, 0.9, v));
    if (layer < 1.5) {
      float z = journeyFarShore(x) - ${glslNumber(DIMENSIONS.firstDepth)} * v;
      float crest = 0.51 + 0.11 * journeyNoise(worldX * 0.0014 + phase * 0.54, 4.2);
      float envelope = smoothstep(0.0, crest, v) * (1.0 - 0.86 * smoothstep(crest, 1.0, v));
      float spine = journeyRidge(worldX * 0.0034 + phase * 0.71, 2.7);
      float relief = 0.5 + 0.5 * journeyNoise(worldX * 0.0013 - phase * 0.39, 4.9);
      float spurs = journeyRidge(worldX * 0.0062 + phase * 0.6, z * 0.0038);
      float height = 205.0 + 195.0 * spine * (0.65 + 0.35 * relief) + 30.0 * spurs
        + 22.0 * uJourneyEnergy + 12.0 * uJourneyBass * shoulder + 8.0 * uJourneyPulse * spurs;
      return vec3(x, envelope * envelope * height, z);
    }
    float z = ${glslNumber(DIMENSIONS.rearStart)} + 45.0 * journeyNoise(worldX * 0.0013 + phase * 0.8, 4.3)
      - ${glslNumber(DIMENSIONS.rearDepth)} * v;
    float crest = 0.48 + 0.085 * journeyNoise(worldX * 0.0009 + phase * 0.49, 7.3);
    float envelope = smoothstep(0.0, crest, v) * (1.0 - 0.86 * smoothstep(crest, 1.0, v));
    float spine = journeyRidge(worldX * 0.0021 + phase * 0.63, 4.1);
    float relief = 0.5 + 0.5 * journeyNoise(worldX * 0.00077 - phase * 0.28, 8.7);
    float spurs = journeyRidge(worldX * 0.0044 + phase * 0.23, z * 0.0023 - phase * 0.5);
    float height = 360.0 + 500.0 * spine * (0.55 + 0.45 * relief) + 35.0 * spurs
      + 36.0 * uJourneyEnergy + 26.0 * uJourneyMelody * shoulder
      + 34.0 * journeyBandStrength(worldX, z) + 10.0 * uJourneyPulse * spurs;
    return vec3(x, ${glslNumber(DIMENSIONS.rearFootHeight)} + envelope * envelope * height, z);
  }
`;
