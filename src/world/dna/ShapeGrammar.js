// Shape grammar — instrumentation drives continuous production-rule
// weights instead of a fixed "if distorted guitar -> spiky" lookup.
// These weights don't generate new terrain geometry yet (that's a
// renderer-level project of its own — see docs/worlds.md); today they
// pick the closest-matching particle/fx/celestial enum values and a
// terrainEnergy scalar, so a song's instrumentation is legible in the
// one part of the render the DNA pipeline currently owns: the palette.
import { clamp01 } from '../../utils/math.js';

const PARTICLE_KINDS = [
  'fireflies', 'embers', 'snow', 'pollen', 'antigrav',
  'petals', 'rain', 'flaresparks', 'digitalrain', 'sand', 'bubbles', 'spores',
];

const FX_BY_TEMP = [
  [0.10, 'aurora'], [0.18, 'nebulaBloom'], [0.27, 'starTwinkle'],
  [0.36, 'bioluminescence'], [0.45, 'canopyDapple'], [0.55, 'godRays'],
  [0.64, 'mirage'], [0.72, 'petalPile'], [0.80, 'sunMotes'],
  [0.87, 'crystalGlint'], [0.94, 'prominence'], [1.01, 'lightning'],
];

/** Continuous production-rule weights, normalized to sum to 1. */
export function buildShapeGrammar(dna) {
  const fam = dna.familyShare || { organic: 0.34, geometric: 0.33, distorted: 0.33 };
  const w = {
    trunkBranch: 0.6 * fam.organic + 0.3 * (1 - dna.percussionDensity),
    verticalStack: 0.5 * fam.distorted + 0.4 * fam.geometric + 0.3 * dna.percussionDensity,
    spikeCluster: 0.6 * fam.distorted + 0.5 * dna.percussionDensity + 0.3 * dna.noteDensity,
    arch: 0.5 * fam.organic + 0.4 * dna.phrase + 0.2 * dna.harmonicComplexity,
    mound: 0.6 * (1 - dna.noteDensity) + 0.3 * (1 - dna.percussionDensity),
    geometricRegularity: 0.6 * fam.geometric + 0.3 * (1 - dna.registerSpread),
  };
  let sum = 0;
  for (const k in w) { w[k] = Math.max(0.01, w[k]); sum += w[k]; }
  for (const k in w) w[k] /= sum;
  return w;
}

function dominantFamily(grammar) {
  let best = 'trunkBranch', bestV = -1;
  for (const k in grammar) if (grammar[k] > bestV) { bestV = grammar[k]; best = k; }
  return best;
}

/** temperature 0..1: how hot/driving the song reads, independent of hue. */
export function computeTemperature(dna) {
  return clamp01(
    0.28 * dna.percussionDensity
    + 0.24 * dna.energyMean
    + 0.24 * dna.tempoHeat
    + 0.14 * dna.noteDensity
    + 0.10 * dna.dyn,
  );
}

export function pickFx(temperature) {
  for (const [hi, fx] of FX_BY_TEMP) if (temperature < hi) return fx;
  return 'lightning';
}

/** Particle kind: dominant shape-grammar family narrows the field, then
 *  temperature within that family picks the specific species — so two
 *  songs with the same instrumentation but different intensity still
 *  read as different, rather than collapsing onto one particle kind. */
export function pickParticleKind(grammar, temperature) {
  const dom = dominantFamily(grammar);
  const pools = {
    trunkBranch: ['pollen', 'fireflies', 'petals', 'spores'],
    mound: ['fireflies', 'pollen', 'snow', 'bubbles'],
    arch: ['petals', 'fireflies', 'spores', 'bubbles'],
    spikeCluster: ['embers', 'flaresparks', 'sand', 'digitalrain'],
    verticalStack: ['digitalrain', 'rain', 'flaresparks', 'antigrav'],
    geometricRegularity: ['digitalrain', 'antigrav', 'sand', 'rain'],
  };
  const pool = pools[dom] || PARTICLE_KINDS;
  const idx = Math.min(pool.length - 1, Math.floor(temperature * pool.length));
  return pool[idx];
}

export function pickCelestialKind(dna) {
  return (dna.meanPitch01 < 0.42 || dna.isMajor === false) && dna.energyMean < 0.55 ? 'moon' : 'sun';
}
