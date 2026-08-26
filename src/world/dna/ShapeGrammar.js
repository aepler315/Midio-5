// Shape grammar — instrumentation drives continuous production-rule
// weights instead of a fixed "if distorted guitar -> spiky" lookup.
// They pick the closest-matching particle/fx/celestial enum values, a
// terrainEnergy scalar, and (via deriveTerrainParams below) continuous
// nudges to the alpine ridgeline's own shape parameters -- so a song's
// instrumentation is legible in both the palette and the skyline it
// generates, not just a fixed massif/range/crags cutout per depth.
import { clamp, clamp01 } from '../../utils/math.js';

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

/**
 * Continuous nudges to ALPINE_CHARACTERS' shape params (SilhouetteGenerator
 * applyTerrainMods), derived from the shape-grammar weights. Every category
 * averages 1/6 across a normalized grammar, so each bias is centered on
 * that baseline rather than on zero -- a song that's exactly "average" in a
 * category leaves that character untouched.
 *
 *  - spike/vertical-stack heavy songs pinch flanks toward a spire (higher
 *    shoulder/spire exponents, more spireMix, more notch/teeth grain) and
 *    pull peaks apart (less apron fill, so they read as separate spikes
 *    rather than a joined range).
 *  - trunk-branch/mound heavy songs do the opposite: fuller domed flanks,
 *    smoother edges, more connective apron so neighbours merge into one
 *    body of high ground.
 *  - arch heavy songs widen the apron spread further still (broad saddles
 *    between summits) without pinching the flanks.
 *  - geometricRegularity narrows how far off-centre summits sit, so a
 *    regular song's range reads more evenly spaced.
 */
export function deriveTerrainParams(grammar) {
  const g = grammar || {};
  const spiky = (g.spikeCluster || 0) + (g.verticalStack || 0); // baseline ~1/3
  const organic = (g.trunkBranch || 0) + (g.mound || 0); // baseline ~1/3
  const archy = g.arch || 0; // baseline ~1/6
  const regular = g.geometricRegularity || 0; // baseline ~1/6

  const spikeBias = clamp(spiky - 1 / 3, -1 / 3, 1 / 3) * 3; // -1..1
  const organicBias = clamp(organic - 1 / 3, -1 / 3, 1 / 3) * 3; // -1..1
  const archBias = clamp(archy - 1 / 6, -1 / 6, 1 / 6) * 6; // -1..1
  const regularBias = clamp(regular - 1 / 6, -1 / 6, 1 / 6) * 6; // -1..1

  return {
    shoulderMul: 1 + 0.35 * spikeBias - 0.30 * organicBias,
    spireMul: 1 + 0.35 * spikeBias - 0.20 * organicBias,
    spireMixAdd: 0.08 * spikeBias - 0.06 * organicBias,
    notchAdd: 0.05 * spikeBias - 0.04 * organicBias + 0.03 * archBias,
    teethAdd: 0.05 * spikeBias - 0.03 * organicBias,
    apronGainAdd: -0.08 * spikeBias + 0.10 * organicBias + 0.04 * archBias,
    apronSpreadAdd: -0.3 * spikeBias + 0.4 * organicBias + 0.5 * archBias,
    apronCapAdd: -0.04 * spikeBias + 0.06 * organicBias,
    asymMul: 1 + 0.3 * spikeBias - 0.35 * regularBias,
  };
}
