import { JOURNEY_ORBIT } from './JourneyOrbit.js';

// Camera-local metres; the basin supplies each range's z origin. Relief is
// sampled in world x so seeks and reduced motion need no terrain history.
export const MOUNTAIN_DIMENSIONS = Object.freeze({
  firstDepth: 2300,
  rearStart: -3000,
  rearDepth: 4700,
  rearFootHeight: 70,
});

const STILL = Object.freeze({
  travelM: 0, seed: 0, energy: 0, bass: 0, melody: 0, pulse: 0,
  bands: Object.freeze([0, 0, 0, 0, 0, 0, 0]),
});
const finite = value => Number.isFinite(value) ? value : 0;
const unit = value => Math.max(0, Math.min(1, finite(value)));
const smooth = (a, b, value) => {
  const t = unit((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Three incommensurate waves form one bounded analytic octave. There are
// six octave samples per height, with no hashes, texture reads or iteration.
// Depth variation stays coarser than x but crosses the falls of the faces:
// gullies bend and interrupt, rather than drawing continuous parallel folds.
function noise(x, z) {
  return .5 * Math.sin(.92 * x + .38 * z)
    + .31 * Math.sin(1.73 * x - .71 * z + 1.4)
    + .19 * Math.sin(3.17 * x + 1.21 * z + 3.7);
}

// Integer longitude harmonics close in both height and derivatives. Each
// octave is warped by the previous periodic octave, retaining intersecting
// ridges and branching gullies instead of repeating a single skyline ribbon.
function circularNoise(angle, z, harmonic, warp) {
  return .5 * Math.sin(harmonic * angle + .38 * z + warp)
    + .31 * Math.sin((2 * harmonic + 1) * angle - .71 * z + 1.4 + 1.73 * warp)
    + .19 * Math.sin((3 * harmonic + 2) * angle + 1.21 * z + 3.7 + 3.17 * warp);
}

function bandStrength(position, state) {
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

/** A pair of eroded massifs, not extruded skyline ribbons. Broad uplift sets
 * unequal summit elevations; folded ridges warp branching spurs, which in
 * turn warp finer gullies. The rounded absolute values preserve continuous
 * normals while retaining narrow arêtes. Musical strength only expands local
 * shoulders in flat mode; circular geography stays fixed under music. */
export function journeyMountainHeight(x, v, layer, state = STILL) {
  const rear = layer >= 1.5;
  v = unit(v);
  const worldX = finite(x) + state.travelM, phase = state.seed * .013;
  const angle = (worldX % JOURNEY_ORBIT.circumferenceM) / JOURNEY_ORBIT.radiusM;
  const scale = rear ? .00079 : .0013;
  const macro = state.circular ? circularNoise(angle, layer * 4.7, 1, phase * .23)
    : noise(worldX * scale * .54 + phase * .23, layer * 4.7);
  const fold = state.circular ? circularNoise(angle, v * 1.85 + layer * 2.4, rear ? 1 : 2, phase * .61 + macro * .45)
    : noise(worldX * scale + phase * .61 + macro * .45, v * 1.85 + layer * 2.4);
  const branch = state.circular ? circularNoise(angle, v * 6.7 + macro * 1.3 + layer * 1.7, rear ? 4 : 7, phase * .37 + fold * .83)
    : noise(worldX * scale * 2.85 + phase * .37 + fold * .83, v * 6.7 + macro * 1.3 + layer * 1.7);
  const gully = state.circular ? circularNoise(angle, v * 23.9 + fold * .85, rear ? 10 : 17, phase * .19 + branch * 1.4)
    : noise(worldX * scale * 7.4 + phase * .19 + branch * 1.4, v * 23.9 + fold * .85);
  const fine = state.circular ? circularNoise(angle, v * 37.7 + branch * 1.15 + layer, rear ? 27 : 45, phase * .11 + gully * .65)
    : noise(worldX * scale * 19.1 + phase * .11 + gully * .65, v * 37.7 + branch * 1.15 + layer);

  const uplift = .5 + .5 * macro;
  const spine = 1.0002 - Math.sqrt(fold * fold + .0004);
  const spur = 1.0024 - Math.sqrt(branch * branch + .0048);
  const incision = 1.0008 - Math.sqrt(gully * gully + .0016);
  const crest = .48 + .11 * macro + .07 * fold + .04 * branch;
  const broad = smooth(0, crest, v) * (1 - smooth(crest, 1, v));
  // A rounded minimum of the two sides makes a narrow watershed rather than
  // the wide zero-slope cap of a smoothstep dome. Its algebraic form is zero
  // at either foot and has continuous derivatives, without a hard min/cusp.
  const front = v / crest, back = (1 - v) / (1 - crest);
  const crown = 2.08 * front * back
    / (front + back + Math.sqrt((front - back) * (front - back) + .0064 * front * back));
  const envelope = .2 * broad + .8 * crown;
  // The silhouette takes a maximum through depth. A longitude-only watershed
  // prevents that maximum from finding the same tall fold at every x, while
  // the depth-dependent spine still branches and cuts across the rock faces.
  const crag = state.circular ? circularNoise(angle, layer * 6.3, rear ? 5 : 8, phase * .29 + macro * .65) : 0;
  const summit = 1.00045 - Math.sqrt(crag * crag + .0009);
  const ridge = state.circular ? .25 * spine * spine * spine + .75 * summit * summit * summit
    : spine * spine * spine;
  const body = (rear ? 510 : 180) + (rear ? 740 : 250) * uplift
    + (rear ? 750 : 245) * ridge;
  const erosion = (rear ? 200 : 72) * ((.65 + .35 * spine) * spur * spur * spur - .48 * incision * incision)
    + (rear ? 64 : 25) * fine * (.35 + .65 * spine) * smooth(.18, .44, v);

  // Overlapping bands follow the geological field rather than fixed screen
  // columns. Reusing the octave samples keeps music free of extra noise work.
  const position = .5 + .32 * macro + .18 * branch;
  const bands = bandStrength(position, state);
  const shoulder = smooth(.12, .32, v) * (1 - .85 * smooth(.5, .8, v));
  const response = (rear ? 12 : 7) * state.energy * (.3 + .7 * uplift)
    + (rear ? 35 : 20) * state.bass * (.2 + .8 * spur * spur)
    + (rear ? 40 : 18) * state.melody * (.15 + .85 * incision * incision)
    + (rear ? 8 : 4) * state.pulse * spur
    + (rear ? 45 : 24) * bands * (.2 + .8 * spur * spur);
  // A second, intersecting foothill watershed has its own wandering depth
  // and lateral buttresses. It rises before the main face and exposes a gully
  // behind it, replacing the uninterrupted triangular front-range apron.
  const foothillDepth = .17 + .055 * (state.circular ? circularNoise(angle, 3.7, 4, phase * .4)
    : noise(worldX * .0021 + phase * .4, 3.7));
  const foothillOffset = (v - foothillDepth) / .115;
  const foothillSupport = Math.max(0, 1 - foothillOffset * foothillOffset);
  const foothill = (rear ? 0 : 150 + 95 * uplift + 45 * spur * spur)
    * foothillSupport * foothillSupport * foothillSupport
    * (.12 + .88 * smooth(-.5, .45, branch));
  const height = foothill + (rear ? MOUNTAIN_DIMENSIONS.rearFootHeight : 0)
    + envelope * envelope * (body + erosion + (state.circular ? 0 : shoulder * response));
  return height * (state.circular ? JOURNEY_ORBIT.reliefScale : 1);
}

// The host declares uJourney* uniforms before inserting this scalar twin.
// Keep helper names private to the mountain module to coexist with the basin.
export const JOURNEY_MOUNTAIN_GLSL = /* glsl */`
  float journeyMountainCircularNoise(float angle, float z, float harmonic, float warp) {
    return .5*sin(harmonic*angle+.38*z+warp)
      +.31*sin((2.0*harmonic+1.0)*angle-.71*z+1.4+1.73*warp)
      +.19*sin((3.0*harmonic+2.0)*angle+1.21*z+3.7+3.17*warp);
  }
  float journeyMountainNoise(float x, float z) {
    return 0.5 * sin(0.92 * x + 0.38 * z)
      + 0.31 * sin(1.73 * x - 0.71 * z + 1.4)
      + 0.19 * sin(3.17 * x + 1.21 * z + 3.7);
  }

  float journeyMountainBandStrength(float position) {
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

  float journeyMountainHeight(vec2 grid, float layer) {
    float rear = step(1.5, layer);
    float v = clamp(grid.y, 0.0, 1.0);
    float worldX = grid.x + uJourneyTravel, phase = uJourneySeed * 0.013;
    float angle = worldX / ${JOURNEY_ORBIT.radiusM.toFixed(1)};
    float scale = mix(0.0013, 0.00079, rear);
    float macro = uJourneyOrbit>.5?journeyMountainCircularNoise(angle,layer*4.7,1.0,phase*.23)
      :journeyMountainNoise(worldX * scale * 0.54 + phase * 0.23, layer * 4.7);
    float fold = uJourneyOrbit>.5?journeyMountainCircularNoise(angle,v*1.85+layer*2.4,mix(2.0,1.0,rear),phase*.61+macro*.45)
      :journeyMountainNoise(worldX * scale + phase * 0.61 + macro * 0.45, v * 1.85 + layer * 2.4);
    float branch = uJourneyOrbit>.5?journeyMountainCircularNoise(angle,v*6.7+macro*1.3+layer*1.7,mix(7.0,4.0,rear),phase*.37+fold*.83)
      :journeyMountainNoise(worldX * scale * 2.85 + phase * 0.37 + fold * 0.83, v * 6.7 + macro * 1.3 + layer * 1.7);
    float gully = uJourneyOrbit>.5?journeyMountainCircularNoise(angle,v*23.9+fold*.85,mix(17.0,10.0,rear),phase*.19+branch*1.4)
      :journeyMountainNoise(worldX * scale * 7.4 + phase * 0.19 + branch * 1.4, v * 23.9 + fold * 0.85);
    float fine = uJourneyOrbit>.5?journeyMountainCircularNoise(angle,v*37.7+branch*1.15+layer,mix(45.0,27.0,rear),phase*.11+gully*.65)
      :journeyMountainNoise(worldX * scale * 19.1 + phase * 0.11 + gully * 0.65, v * 37.7 + branch * 1.15 + layer);

    float uplift = 0.5 + 0.5 * macro;
    float spine = 1.0002 - sqrt(fold * fold + 0.0004);
    float spur = 1.0024 - sqrt(branch * branch + 0.0048);
    float incision = 1.0008 - sqrt(gully * gully + 0.0016);
    float crest = 0.48 + 0.11 * macro + 0.07 * fold + 0.04 * branch;
    float broad = smoothstep(0.0, crest, v) * (1.0 - smoothstep(crest, 1.0, v));
    float front = v / crest, back = (1.0 - v) / (1.0 - crest);
    float crown = 2.08 * front * back
      / (front + back + sqrt((front - back) * (front - back) + 0.0064 * front * back));
    float envelope = 0.2 * broad + 0.8 * crown;
    float crag = uJourneyOrbit>.5?journeyMountainCircularNoise(angle,layer*6.3,mix(8.0,5.0,rear),phase*.29+macro*.65):0.0;
    float summit = 1.00045-sqrt(crag*crag+.0009);
    float ridge = uJourneyOrbit>.5?.25*spine*spine*spine+.75*summit*summit*summit:spine*spine*spine;
    float body = mix(180.0, 510.0, rear) + mix(250.0, 740.0, rear) * uplift
      + mix(245.0, 750.0, rear) * ridge;
    float erosion = mix(72.0, 200.0, rear) * ((0.65 + 0.35 * spine) * spur * spur * spur - 0.48 * incision * incision)
      + mix(25.0, 64.0, rear) * fine * (0.35 + 0.65 * spine) * smoothstep(0.18, 0.44, v);

    float position = 0.5 + 0.32 * macro + 0.18 * branch;
    float bands = journeyMountainBandStrength(position);
    float shoulder = smoothstep(0.12, 0.32, v) * (1.0 - 0.85 * smoothstep(0.5, 0.8, v));
    float response = mix(7.0, 12.0, rear) * uJourneyEnergy * (0.3 + 0.7 * uplift)
      + mix(20.0, 35.0, rear) * uJourneyBass * (0.2 + 0.8 * spur * spur)
      + mix(18.0, 40.0, rear) * uJourneyMelody * (0.15 + 0.85 * incision * incision)
      + mix(4.0, 8.0, rear) * uJourneyPulse * spur
      + mix(24.0, 45.0, rear) * bands * (0.2 + 0.8 * spur * spur);
    float foothillDepth = .17 + .055 * (uJourneyOrbit>.5?journeyMountainCircularNoise(angle,3.7,4.0,phase*.4)
      :journeyMountainNoise(worldX * .0021 + phase * .4,3.7));
    float foothillOffset = (v - foothillDepth) / 0.115;
    float foothillSupport = max(0.0, 1.0 - foothillOffset * foothillOffset);
    float foothill = (1.0 - rear) * (150.0 + 95.0 * uplift + 45.0 * spur * spur)
      * foothillSupport * foothillSupport * foothillSupport
      * (0.12 + 0.88 * smoothstep(-0.5, 0.45, branch));
    float height = foothill + ${MOUNTAIN_DIMENSIONS.rearFootHeight}.0 * rear
      + envelope * envelope * (body + erosion + (uJourneyOrbit>.5?0.0:shoulder * response));
    return height * (uJourneyOrbit>.5?${JOURNEY_ORBIT.reliefScale.toFixed(2)}:1.0);
  }
`;
