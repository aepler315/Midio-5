import { MOUNTAIN_DIMENSIONS, journeyMountainHeight, JOURNEY_MOUNTAIN_GLSL } from './JourneyMountains.js';

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

const finite = value => Number.isFinite(value) ? value : 0;
const unit = value => Math.max(0, Math.min(1, finite(value)));
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

/** A bounded lake has its own evolving center, breadth and coves. The
 * mountain field still advects through it, so its margins discover new
 * foothills while the whole basin stays in the traveling composition. */
export function journeyLakeShape(state = STILL) {
  const t = state.timeSec, phase = state.seed * .013;
  return {
    centerX: 62 * Math.sin(t * .055 + phase * .8) + 18 * Math.sin(t * .13 + phase * .17),
    halfWidthM: 550 + 55 * Math.sin(t * .071 + phase * .27) + 35 * Math.sin(t * .113 + phase * .41) + 15 * state.energy,
    centerZ: -290 + 48 * Math.sin(t * .062 + phase * .5) + 22 * noise(state.travelM * .002, 5),
  };
}

export function journeyShorePair(x, state = STILL) {
  const lake = journeyLakeShape(state), t = state.timeSec, phase = state.seed * .013;
  const q = (finite(x) - lake.centerX) / lake.halfWidthM;
  const envelope = Math.max(0, 1 - q * q);
  // Rounded ends with a finite derivative, so a moving tip never snaps.
  const round = (Math.sqrt(envelope + .045) - Math.sqrt(.045)) / (Math.sqrt(1.045) - Math.sqrt(.045));
  const worldX = finite(x) + state.travelM;
  const bend = lake.centerZ + 60 * Math.sin(q * 2.7 + t * .08 + phase * .7) * round;
  const nearCove = Math.max(0, 1 - ((q - .30 - .12 * Math.sin(t * .11)) / .29) ** 2) ** 2;
  const farCove = Math.max(0, 1 - ((q + .28 - .10 * Math.sin(t * .09 + 1)) / .32) ** 2) ** 2;
  const nearDepth = (450 + 35 * Math.sin(t * .049 + phase * .39))
    * (.94 + .10 * Math.sin(q * 4.3 + phase + t * .085));
  const farDepth = (470 + 45 * Math.sin(t * .045 + phase * 1.1))
    * (.96 + .12 * Math.sin(q * 4.8 - phase * .4 - t * .063));
  return [bend + round * (nearDepth - 145 * nearCove + 26 * noise(worldX * .005, t * .025)),
    bend - round * (farDepth - 135 * farCove + 30 * noise(worldX * .004, t * .02 + 3))];
}

export function journeyNearShore(x, state = STILL) { return journeyShorePair(x, state)[0]; }
export function journeyFarShore(x, state = STILL) { return journeyShorePair(x, state)[1]; }
export function journeyLakeDistance(x, z, state = STILL) {
  const [near, far] = journeyShorePair(x, state), lake = journeyLakeShape(state);
  return Math.min(near - z, z - far, lake.halfWidthM - Math.abs(x - lake.centerX));
}

export function journeyGroundHeight(x, z, state = STILL) {
  const worldX = finite(x) + state.travelM, phase = state.seed * .013;
  const inland = Math.max(0, finite(z) - journeyNearShore(x, state));
  return inland / (inland + 225)
    * (30 + 6 * noise(worldX * .0032 + phase, finite(z) * .00018));
}

export function journeySurface(x, v, layer, state = STILL) {
  x = finite(x); v = unit(v);
  if (layer < .5) {
    const z = journeyNearShore(x, state) + 650 * v;
    return [x, journeyGroundHeight(x, z, state), z];
  }
  const z = layer < 1.5 ? journeyFarShore(x, state) - MOUNTAIN_DIMENSIONS.firstDepth * v
    : MOUNTAIN_DIMENSIONS.rearStart - MOUNTAIN_DIMENSIONS.rearDepth * v;
  return [x, journeyMountainHeight(x, v, layer, state), z];
}

export const JOURNEY_SURFACE_GLSL = /* glsl */`
  uniform float uJourneyTime, uJourneyTravel, uJourneySeed;
  uniform float uJourneyEnergy, uJourneyBass, uJourneyMelody, uJourneyPulse;
  uniform float uJourneyBands[7];
  float journeyNoise(float x, float z) {
    return .5*sin(.89*x+.61*z)+.3*sin(1.71*x-1.37*z+1.8)+.2*sin(3.11*x+2.17*z+4.4);
  }
  vec3 journeyLakeShape() {
    float t=uJourneyTime, phase=uJourneySeed*.013;
    return vec3(62.0*sin(t*.055+phase*.8)+18.0*sin(t*.13+phase*.17),
      550.0+55.0*sin(t*.071+phase*.27)+35.0*sin(t*.113+phase*.41)+15.0*uJourneyEnergy,
      -290.0+48.0*sin(t*.062+phase*.5)+22.0*journeyNoise(uJourneyTravel*.002,5.0));
  }
  vec2 journeyShorePair(float x) {
    vec3 lake=journeyLakeShape();
    float t=uJourneyTime, phase=uJourneySeed*.013, q=(x-lake.x)/lake.y;
    float envelope=max(0.0,1.0-q*q);
    float round=(sqrt(envelope+.045)-sqrt(.045))/(sqrt(1.045)-sqrt(.045));
    float worldX=x+uJourneyTravel;
    float bend=lake.z+60.0*sin(q*2.7+t*.08+phase*.7)*round;
    float nq=(q-.30-.12*sin(t*.11))/.29,fq=(q+.28-.10*sin(t*.09+1.0))/.32;
    float ns=max(0.0,1.0-nq*nq),fs=max(0.0,1.0-fq*fq);
    float nearCove=ns*ns,farCove=fs*fs;
    float nearDepth=(450.0+35.0*sin(t*.049+phase*.39))*(.94+.10*sin(q*4.3+phase+t*.085));
    float farDepth=(470.0+45.0*sin(t*.045+phase*1.1))*(.96+.12*sin(q*4.8-phase*.4-t*.063));
    return vec2(bend+round*(nearDepth-145.0*nearCove+26.0*journeyNoise(worldX*.005,t*.025)),
      bend-round*(farDepth-135.0*farCove+30.0*journeyNoise(worldX*.004,t*.02+3.0)));
  }
  float journeyNearShore(float x) { return journeyShorePair(x).x; }
  float journeyFarShore(float x) { return journeyShorePair(x).y; }
  float journeyLakeDistance(vec2 xz) {
    vec2 shores=journeyShorePair(xz.x); vec3 lake=journeyLakeShape();
    return min(min(shores.x-xz.y,xz.y-shores.y),lake.y-abs(xz.x-lake.x));
  }
  float journeyGroundHeight(vec2 xz) {
    float worldX=xz.x+uJourneyTravel, phase=uJourneySeed*.013;
    float inland=max(0.0,xz.y-journeyNearShore(xz.x));
    return inland/(inland+225.0)*(30.0+6.0*journeyNoise(worldX*.0032+phase,xz.y*.00018));
  }
  ${JOURNEY_MOUNTAIN_GLSL}
  vec3 journeySurface(vec2 grid, float layer) {
    float x=grid.x,v=clamp(grid.y,0.0,1.0);
    if(layer<.5){float z=journeyNearShore(x)+650.0*v;return vec3(x,journeyGroundHeight(vec2(x,z)),z);}
    float z=layer<1.5?journeyFarShore(x)-${MOUNTAIN_DIMENSIONS.firstDepth.toFixed(1)}*v
      :${MOUNTAIN_DIMENSIONS.rearStart.toFixed(1)}-${MOUNTAIN_DIMENSIONS.rearDepth.toFixed(1)}*v;
    return vec3(x,journeyMountainHeight(vec2(x,v),layer),z);
  }
`;
