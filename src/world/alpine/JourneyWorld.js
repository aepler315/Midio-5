import { MOUNTAIN_DIMENSIONS, journeyMountainHeight, JOURNEY_MOUNTAIN_GLSL } from './JourneyMountains.js';
import { JOURNEY_ORBIT, JOURNEY_ORBIT_GLSL } from './JourneyOrbit.js';

// Intrinsic route metres: altitude is y and -z recedes across the ranges.
// World features are sampled at x + travelM. No tiled chunks, accumulated
// frame state or music-dependent phase can make a seek reveal a different land.

export const JOURNEY_VIEW = Object.freeze({
  id: 'moonlit-journey',
  name: 'Moonlit Journey',
  title: 'Journey around a mountain world',
  place: 'Imagined circular world',
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
const smooth = (a, b, value) => {
  const t = unit((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const cove = (q, center, width) => {
  const support = Math.max(0, 1 - ((q - center) / width) ** 2);
  return support * support;
};
/** Heard time is the entire travel clock. Live controls never change its
 * rate/phase, including after a large seek. Circular geography stays fixed. */
export function sampleJourneyState({ timeMs = 0, seed = 0, music = null, reducedMotion = false, circular = false } = {}) {
  const timeSec = reducedMotion ? 0 : Math.max(0, finite(timeMs)) / 1000;
  const strength = value => reducedMotion ? 0 : unit(value);
  return {
    circular: Boolean(circular),
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

/** The broad basin evolves on a kilometre-scale travel clock. Its two banks
 * discover independent coves and headlands rather than inflating with music.
 * The rounded closing envelope is shared with every terrain/contact receiver. */
export function journeyLakeShape(state = STILL) {
  // Circular metadata describes a complete belt, never a camera-local oval.
  if (state.circular) return { centerX: 0, halfWidthM: JOURNEY_ORBIT.circumferenceM / 2, centerZ: -310 };
  const t = state.timeSec, phase = state.seed * .013;
  return {
    centerX: 45 * Math.sin(t * .006 + phase * .8) + 12 * noise(state.travelM * .0001, phase * .2),
    halfWidthM: 550 + 35 * Math.sin(t * .009 + phase * .27) + 15 * noise(state.travelM * .0001, phase * .4),
    centerZ: -310 + 25 * Math.sin(t * .006 + phase * .5) + 12 * noise(state.travelM * .00015, phase * .3),
  };
}

export function journeyShorePair(x, state = STILL) {
  if (state.circular) {
    const angle = ((finite(x) + state.travelM) % JOURNEY_ORBIT.circumferenceM) / JOURNEY_ORBIT.radiusM;
    const phase = state.seed * .013;
    const bend = -310 + 45 * Math.sin(2 * angle + phase * .7) + 22 * Math.sin(5 * angle - phase * .3);
    const near = 405 + 58 * Math.sin(3 * angle + phase * .4)
      + 36 * Math.sin(7 * angle + phase * .8 + .55 * Math.sin(2 * angle + phase));
    const far = 455 + 62 * Math.sin(4 * angle - phase * .5)
      + 40 * Math.sin(9 * angle + phase * .3 + .65 * Math.sin(3 * angle - phase));
    return [bend + near, bend - far];
  }
  const lake = journeyLakeShape(state), phase = state.seed * .013;
  const q = (finite(x) - lake.centerX) / lake.halfWidthM;
  const envelope = Math.max(0, 1 - q * q);
  // Retain finite rounded tips and their exact dense-grid vertices.
  const round = (Math.sqrt(envelope + .045) - Math.sqrt(.045)) / (Math.sqrt(1.045) - Math.sqrt(.045));
  const worldX = finite(x) + state.travelM, geology = state.travelM * .00018;
  const bend = lake.centerZ + 45 * Math.sin(q * 2.1 + phase * .7) * round;
  const nearCoves = 160 * cove(q, -.47 + .09 * Math.sin(geology + phase), .22)
    + 150 * cove(q, .33 + .09 * Math.sin(geology * .7 + phase * .4), .27);
  const farCoves = 135 * cove(q, -.24 + .08 * Math.sin(geology * .8 + phase * .6), .25)
    + 165 * cove(q, .55 + .06 * Math.sin(geology * .6 + phase), .22);
  const nearDepth = 420 + 30 * Math.sin(q * 3.7 + phase * .39)
    + 18 * noise(worldX * .0007, phase * .3);
  const farDepth = 470 + 38 * Math.sin(q * 3.1 - phase * .4)
    + 22 * noise(worldX * .0006, phase * .5 + 3);
  return [bend + round * (nearDepth - nearCoves), bend - round * (farDepth - farCoves)];
}

export function journeyNearShore(x, state = STILL) { return journeyShorePair(x, state)[0]; }
export function journeyFarShore(x, state = STILL) { return journeyShorePair(x, state)[1]; }
export function journeyLakeDistance(x, z, state = STILL) {
  const [near, far] = journeyShorePair(x, state), lake = journeyLakeShape(state);
  if (state.circular) return Math.min(near - z, z - far);
  return Math.min(near - z, z - far, lake.halfWidthM - Math.abs(x - lake.centerX));
}

export function journeyGroundHeight(x, z, state = STILL) {
  const worldX = finite(x) + state.travelM, phase = state.seed * .013;
  const inland = Math.max(0, finite(z) - journeyNearShore(x, state));
  // A shallow contact shelf, then crossed low foreland shoulders. The apron
  // has its own depth relief instead of lifting a single flat strip.
  const shelf = 4 * smooth(0, 90, inland) + 8 * smooth(80, 240, inland);
  const rise = 23 * smooth(210, 650, inland);
  const angle = (worldX % JOURNEY_ORBIT.circumferenceM) / JOURNEY_ORBIT.radiusM;
  const detail = state.circular
    ? .5 * Math.sin(5 * angle + .61 * inland * .008 + phase)
      + .3 * Math.sin(11 * angle - 1.37 * inland * .008 + 1.8 + phase * 1.71)
      + .2 * Math.sin(19 * angle + 2.17 * inland * .008 + 4.4 + phase * 3.11)
    : noise(worldX * .003 + phase, inland * .008);
  const shoulder = (3 + 3 * detail)
    * smooth(70, 230, inland) * (1 - .3 * smooth(350, 650, inland));
  return shelf + rise + shoulder;
}

export function journeySurface(x, v, layer, state = STILL) {
  x = finite(x); v = unit(v);
  if (layer < .5) {
    // Preserve the dense contact shelf, then fan the same bounded grid out
    // behind every framed camera. A cubic tail joins with two continuous
    // derivatives and avoids exposing the old finite-apron edge on retreat.
    const tail = Math.max(0, (v - .3) / .7);
    const z = journeyNearShore(x, state) + 650 * v + (state.circular ? 450 : 6000) * tail * tail * tail;
    return [x, journeyGroundHeight(x, z, state), z];
  }
  const z = layer < 1.5 ? journeyFarShore(x, state) - MOUNTAIN_DIMENSIONS.firstDepth * v
    : MOUNTAIN_DIMENSIONS.rearStart - MOUNTAIN_DIMENSIONS.rearDepth * v;
  return [x, journeyMountainHeight(x, v, layer, state), z];
}

export const JOURNEY_SURFACE_GLSL = /* glsl */`
  ${JOURNEY_ORBIT_GLSL}
  uniform float uJourneyTime, uJourneyTravel, uJourneySeed;
  uniform float uJourneyEnergy, uJourneyBass, uJourneyMelody, uJourneyPulse;
  uniform float uJourneyBands[7];
  float journeyNoise(float x, float z) {
    return .5*sin(.89*x+.61*z)+.3*sin(1.71*x-1.37*z+1.8)+.2*sin(3.11*x+2.17*z+4.4);
  }
  float journeyCove(float q, float center, float width) {
    float offset=(q-center)/width;
    float support=max(0.0,1.0-offset*offset);
    return support*support;
  }
  vec3 journeyLakeShape() {
    if(uJourneyOrbit>.5)return vec3(0.0,${(JOURNEY_ORBIT.circumferenceM / 2).toFixed(12)},-310.0);
    float t=uJourneyTime, phase=uJourneySeed*.013;
    return vec3(45.0*sin(t*.006+phase*.8)+12.0*journeyNoise(uJourneyTravel*.0001,phase*.2),
      550.0+35.0*sin(t*.009+phase*.27)+15.0*journeyNoise(uJourneyTravel*.0001,phase*.4),
      -310.0+25.0*sin(t*.006+phase*.5)+12.0*journeyNoise(uJourneyTravel*.00015,phase*.3));
  }
  vec2 journeyShorePair(float x) {
    if(uJourneyOrbit>.5){
      float angle=(x+uJourneyTravel)/${JOURNEY_ORBIT.radiusM.toFixed(1)},phase=uJourneySeed*.013;
      float bend=-310.0+45.0*sin(2.0*angle+phase*.7)+22.0*sin(5.0*angle-phase*.3);
      float near=405.0+58.0*sin(3.0*angle+phase*.4)
        +36.0*sin(7.0*angle+phase*.8+.55*sin(2.0*angle+phase));
      float far=455.0+62.0*sin(4.0*angle-phase*.5)
        +40.0*sin(9.0*angle+phase*.3+.65*sin(3.0*angle-phase));
      return vec2(bend+near,bend-far);
    }
    vec3 lake=journeyLakeShape();
    float phase=uJourneySeed*.013, q=(x-lake.x)/lake.y;
    float envelope=max(0.0,1.0-q*q);
    float round=(sqrt(envelope+.045)-sqrt(.045))/(sqrt(1.045)-sqrt(.045));
    float worldX=x+uJourneyTravel, geology=uJourneyTravel*.00018;
    float bend=lake.z+45.0*sin(q*2.1+phase*.7)*round;
    float nearCoves=160.0*journeyCove(q,-.47+.09*sin(geology+phase),.22)
      +150.0*journeyCove(q,.33+.09*sin(geology*.7+phase*.4),.27);
    float farCoves=135.0*journeyCove(q,-.24+.08*sin(geology*.8+phase*.6),.25)
      +165.0*journeyCove(q,.55+.06*sin(geology*.6+phase),.22);
    float nearDepth=420.0+30.0*sin(q*3.7+phase*.39)+18.0*journeyNoise(worldX*.0007,phase*.3);
    float farDepth=470.0+38.0*sin(q*3.1-phase*.4)+22.0*journeyNoise(worldX*.0006,phase*.5+3.0);
    return vec2(bend+round*(nearDepth-nearCoves),bend-round*(farDepth-farCoves));
  }
  float journeyNearShore(float x) { return journeyShorePair(x).x; }
  float journeyFarShore(float x) { return journeyShorePair(x).y; }
  float journeyLakeDistance(vec2 xz) {
    vec2 shores=journeyShorePair(xz.x); vec3 lake=journeyLakeShape();
    if(uJourneyOrbit>.5)return min(shores.x-xz.y,xz.y-shores.y);
    return min(min(shores.x-xz.y,xz.y-shores.y),lake.y-abs(xz.x-lake.x));
  }
  float journeyGroundHeight(vec2 xz) {
    float worldX=xz.x+uJourneyTravel, phase=uJourneySeed*.013;
    float inland=max(0.0,xz.y-journeyNearShore(xz.x));
    float shelf=4.0*smoothstep(0.0,90.0,inland)+8.0*smoothstep(80.0,240.0,inland);
    float rise=23.0*smoothstep(210.0,650.0,inland);
    float angle=worldX/${JOURNEY_ORBIT.radiusM.toFixed(1)};
    float detail=uJourneyOrbit>.5
      ?.5*sin(5.0*angle+.61*inland*.008+phase)
        +.3*sin(11.0*angle-1.37*inland*.008+1.8+phase*1.71)
        +.2*sin(19.0*angle+2.17*inland*.008+4.4+phase*3.11)
      :journeyNoise(worldX*.003+phase,inland*.008);
    float shoulder=(3.0+3.0*detail)
      *smoothstep(70.0,230.0,inland)*(1.0-.3*smoothstep(350.0,650.0,inland));
    return shelf+rise+shoulder;
  }
  ${JOURNEY_MOUNTAIN_GLSL}
  vec3 journeySurface(vec2 grid, float layer) {
    float x=grid.x,v=clamp(grid.y,0.0,1.0);
    if(layer<.5){
      float tail=max(0.0,(v-.3)/.7);
      float z=journeyNearShore(x)+650.0*v+(uJourneyOrbit>.5?450.0:6000.0)*tail*tail*tail;
      return vec3(x,journeyGroundHeight(vec2(x,z)),z);
    }
    float z=layer<1.5?journeyFarShore(x)-${MOUNTAIN_DIMENSIONS.firstDepth.toFixed(1)}*v
      :${MOUNTAIN_DIMENSIONS.rearStart.toFixed(1)}-${MOUNTAIN_DIMENSIONS.rearDepth.toFixed(1)}*v;
    return vec3(x,journeyMountainHeight(vec2(x,v),layer),z);
  }
`;
