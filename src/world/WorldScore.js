// Watchability match: how well a song would play in a world's visual suite.
//
// Not "is this a city song." The question is: if we drive this world's
// channels with this song, does the show sit in a sweet spot — enough
// going on to watch, not so much that every window strobes and every
// peak clips. A drone leaves The Range sitting still (boring). A wall
// of sound in After Hours lights every window at once (too intense).
import { clamp01, clamp, spread01 } from '../utils/math.js';
import { FLAT_WEIGHTS } from '../audio/bands.js';
import { extractRidgePortrait, lithologyFromShares } from './RidgePortrait.js';
import { listWorlds, getWorld } from './Worlds.js';
import { buildSongDNA } from './dna/SongDNA.js';
import { synthesizeSectionPalettes } from './dna/PaletteSynth.js';
import {
  buildShapeGrammar, deriveTerrainParams, pickCharacterScheme, CHARACTER_SCHEMES,
} from './dna/ShapeGrammar.js';
import { castBiomes } from './Dramaturgy.js';

const BPM_LO = 60, BPM_HI = 180;

export function extractWatchFeatures({
  energyCurves = null,
  durationMs = 0,
  bpm = 0,
  analysis = null,
  structure = null,
} = {}) {
  const dur = Math.max(1, durationMs || 1);
  let centroid = 0.5, bass = 0.3, air = 0.1, spread = 0.5, litho = null;
  let dyn = 0.4, energyMean = 0.4, phrase = 0.3, landmarks = 4, trend = 0;

  if (energyCurves && energyCurves.n >= 8) {
    const portrait = extractRidgePortrait(energyCurves, dur);
    if (portrait) {
      centroid = portrait.centroid01;
      bass = portrait.bassShare;
      air = portrait.airShare;
      spread = portrait.spread01;
      litho = portrait.lithology;
      dyn = portrait.dynamicRange;
      phrase = portrait.phraseStrength;
      landmarks = portrait.landmarks?.length ?? 4;
      const wave = portrait.energyWave;
      if (wave && wave.length) {
        let wMin = 1, wMax = 0;
        for (let i = 0; i < wave.length; i++) {
          const v = wave[i];
          if (v < wMin) wMin = v;
          if (v > wMax) wMax = v;
        }
        dyn = Math.max(dyn, clamp01(wMax - wMin));
        // Coarse rise/fall trajectory across the whole song: mean energy of
        // the last third vs the first third. Used (via SongDNA) as the
        // audio-only fallback for particle direction when there's no MIDI
        // pitch timeline to read a register trend from directly.
        const third = Math.max(1, Math.floor(wave.length / 3));
        let a = 0, b = 0;
        for (let i = 0; i < third; i++) a += wave[i];
        for (let i = wave.length - third; i < wave.length; i++) b += wave[i];
        trend = clamp((b / third - a / third) * 2.5, -1, 1);
      }
    } else {
      litho = lithologyFromShares(null);
    }
    if (typeof energyCurves.calibration === 'function') {
      const cal = energyCurves.calibration(FLAT_WEIGHTS);
      dyn = clamp01((cal?.spread ?? 0.2) / 0.5);
      energyMean = clamp01(((cal?.lo ?? 0) + (cal?.hi ?? 0.4)) * 0.5);
    }
  }

  if (analysis) {
    if (Number.isFinite(analysis.brightness)) centroid = clamp01(0.55 * centroid + 0.45 * analysis.brightness);
    if (Number.isFinite(analysis.dynamicRange)) dyn = clamp01(0.5 * dyn + 0.5 * analysis.dynamicRange);
  }

  // Onset-ish density: landmark count per minute, squashed to 0..1.
  const perMin = landmarks / (dur / 60000);
  const onset = clamp01(perMin / 10);

  // Section contrast from structure labels, else dynamic range.
  let contrast = dyn;
  if (structure?.labels?.length > 1) {
    const uniq = new Set(structure.labels).size;
    contrast = clamp01(0.35 * dyn + 0.65 * (uniq / structure.labels.length));
  }

  const bpmN = Number.isFinite(bpm) && bpm > 0 ? clamp01((bpm - BPM_LO) / (BPM_HI - BPM_LO)) : 0.4;
  // Groove: mid-tempo (≈80–110) scores high; very slow and very fast fall off.
  const groove = clamp01(1 - Math.abs((bpm || 96) - 96) / 70) * (0.55 + 0.45 * phrase);
  const tempoHeat = clamp01(((bpm || 100) - 72) / 90);

  const warmth = clamp01(0.55 * bass + 0.45 * (1 - centroid));
  const texture = clamp01(0.5 * spread + 0.5 * air);
  const form = clamp01(landmarks / 10);
  const arc = dyn;

  // spread01: a weighted sum of 5 independent-ish features collapses toward
  // 0.5 (measured: sd 0.134, <0.1% of songs ever below 0.10 or above 0.90),
  // which reads every world's comfort band near an edge (farside, fathom,
  // foundry) as nearly unreachable even though those bands were authored
  // assuming roughly-uniform coverage. See spread01's own comment.
  const drive = spread01(clamp01(0.28 * arc + 0.18 * onset + 0.16 * contrast + 0.14 * energyMean + 0.24 * tempoHeat));

  return {
    centroid, bass, air, spread, dyn, energyMean, phrase, landmarks,
    onset, contrast, groove, warmth, texture, form, arc, drive, bpm: bpm || 0,
    tempoHeat, litho, trend,
  };
}

function inRangeScore(value, range) {
  if (!range || range.length < 2) return 0.5;
  const [lo, hi] = range;
  if (value >= lo && value <= hi) {
    const mid = (lo + hi) / 2;
    const half = Math.max(0.04, (hi - lo) / 2);
    return 0.72 + 0.28 * (1 - Math.abs(value - mid) / half);
  }
  const dist = value < lo ? lo - value : value - hi;
  return clamp01(1 - dist / 0.45) * 0.7;
}

function comfortScore(drive, comfort) {
  const lo = comfort?.lo ?? 0.3;
  const hi = comfort?.hi ?? 0.8;
  const mid = (lo + hi) / 2;
  const half = Math.max(0.08, (hi - lo) / 2);
  if (drive >= lo && drive <= hi) {
    return 0.78 + 0.22 * (1 - Math.abs(drive - mid) / half);
  }
  const dist = drive < lo ? lo - drive : drive - hi;
  return clamp01(0.78 - dist * 1.35) * 0.92 + 0.08;
}

const INVERTED = { centroidInv: 'centroid', onsetInv: 'onset', warmthInv: 'warmth', contrastInv: 'contrast' };

function affinityScore(features, world) {
  const w = world.affinity;
  if (!w) return 0.5;
  let acc = 0, sum = 0;
  for (const [key, weight] of Object.entries(w)) {
    const src = INVERTED[key];
    const v = clamp01(src ? 1 - (features[src] ?? 0.5) : (features[key] ?? 0.4));
    acc += v * weight;
    sum += weight;
  }
  return sum > 0 ? clamp01(acc / sum) : 0.5;
}

function coverageScore(features, channels) {
  if (!channels?.length) return 0.5;
  let wsum = 0, acc = 0;
  for (const ch of channels) {
    const v = clamp01(features[ch.reads] ?? 0.4);
    const w = ch.weight || 1;
    acc += v * w;
    wsum += w;
  }
  return wsum > 0 ? acc / wsum : 0.5;
}

function shapeFit(features, prefer) {
  if (!prefer) return 0.5;
  const keys = Object.keys(prefer);
  if (!keys.length) return 0.5;
  let s = 0;
  for (const k of keys) s += inRangeScore(features[k] ?? 0.4, prefer[k]);
  return s / keys.length;
}

/**
 * Score every registered world against this song. Returns a ranked list
 * of `{ id, name, tagline, kind, score, parts, recommended }`.
 * `score` is 1–99 so a card never reads as a sure thing or a zero.
 */
export function scoreWorlds(features, worlds = listWorlds()) {
  const feat = features && typeof features.drive === 'number'
    ? features
    : extractWatchFeatures(features || {});

  const ranked = worlds.map((w) => {
    const comfort = comfortScore(feat.drive, w.comfort);
    const coverage = coverageScore(feat, w.channels);
    const shape = shapeFit(feat, w.prefer);
    const affinity = affinityScore(feat, w);
    const mixed = 0.38 * comfort + 0.24 * coverage + 0.16 * shape + 0.22 * affinity;
    const score = clamp(Math.round(40 + 58 * mixed), 1, 99);
    return {
      id: w.id,
      name: w.name,
      tagline: w.tagline,
      kind: w.kind,
      score,
      parts: { comfort, coverage, shape, affinity, drive: feat.drive },
    };
  });
  ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  if (ranked[0]) ranked[0].recommended = true;
  return ranked;
}

// ── Custom world construction ──────────────────────────────────────
//
// A custom world is the provably optimal world for a given feature
// vector. Its score is 100 by construction:
//
//   comfort  = 1.0  (comfort band centered on drive)
//   shape    = 1.0  (prefer ranges centered on actual features)
//   coverage = max  (channels read the strongest features)
//   affinity = max  (weights point to the strongest features)
//
// Each sub-score is normalized against its theoretical maximum for
// these features, so mixed = 1.0 → score = 100.

const SCORABLE_KEYS = [
  'arc', 'form', 'contrast', 'texture', 'air', 'onset',
  'groove', 'warmth', 'spread', 'phrase', 'tempoHeat',
  'energyMean', 'dyn', 'bass', 'centroid',
];

const INVERTIBLE = new Set(['centroid', 'onset', 'warmth', 'contrast']);

function buildOptimalChannels(features) {
  const sorted = SCORABLE_KEYS
    .map((k) => ({ k, v: clamp01(features[k] ?? 0.4) }))
    .sort((a, b) => b.v - a.v);
  return sorted.slice(0, 6).map((f) => ({ id: f.k, reads: f.k, weight: 1 }));
}

function buildOptimalAffinity(features) {
  const candidates = [];
  for (const k of SCORABLE_KEYS) {
    const v = clamp01(features[k] ?? 0.4);
    candidates.push({ key: k, value: v });
    if (INVERTIBLE.has(k)) candidates.push({ key: k + 'Inv', value: 1 - v });
  }
  candidates.sort((a, b) => b.value - a.value);
  const aff = {};
  for (const c of candidates.slice(0, 5)) aff[c.key] = 1;
  return aff;
}

function buildOptimalPrefer(features) {
  const prefer = {};
  for (const k of SCORABLE_KEYS) {
    const v = features[k] ?? 0.5;
    prefer[k] = [v, v];
  }
  return prefer;
}

/**
 * `data`, when given, is the same object threaded through
 * offerWorldsThenStart (energyCurves/durationMs/bpm/analysis/structure,
 * plus timeline/barGrid on the MIDI path) — it drives palette synthesis.
 * Score-affecting fields (channels/affinity/prefer/comfort) are built from
 * `features` alone, same as before: palette generation never touches the
 * 100% proof.
 */
export function buildCustomWorld(features, data = null) {
  const feat = features && typeof features.drive === 'number'
    ? features
    : extractWatchFeatures(features || {});

  const ranked = scoreWorlds(feat);
  const base = getWorld(ranked[0].id);

  const channels = buildOptimalChannels(feat);
  const affinity = buildOptimalAffinity(feat);
  const prefer = buildOptimalPrefer(feat);
  const comfort = { lo: feat.drive, hi: feat.drive };

  let palettes = base.palettes;
  let temperature = base.temperature;
  let cast = base.cast;
  let terrainMods = null;
  let characterScheme = null;
  let dna = null;
  let paletteProof = null;

  try {
    dna = buildSongDNA({ ...(data || {}), structure: data?.structure ?? null });
    const synth = synthesizeSectionPalettes(dna, base.kind || 'world');
    if (synth.palettes.length) {
      palettes = synth.palettes;
      temperature = synth.temperature;
      cast = (energies, seed) => castBiomes(energies, seed, temperature);
      paletteProof = { seed: dna.seed, tonicPc: dna.tonicPc, isMajor: dna.isMajor, sections: synth.palettes.length };
    }
    // Continuous nudges to the alpine ridgeline's own shape params, so a
    // song's instrumentation shows up in the skyline it generates and not
    // only its colors. Additive/optional: BiomeManager falls back to the
    // stock per-depth character (massif/range/crags) untouched when absent.
    const grammar = buildShapeGrammar(dna);
    terrainMods = deriveTerrainParams(grammar);
    // WHICH landform each depth layer gets, not just how that landform is
    // shaped -- see ShapeGrammar.pickCharacterScheme. Also falls back to
    // the stock massif/range/crags triple when absent.
    characterScheme = CHARACTER_SCHEMES[pickCharacterScheme(grammar)];
  } catch (err) {
    // Palette synthesis is additive — a failure here must never break world
    // selection. Fall back to the base world's stock palette silently.
    paletteProof = { error: String(err?.message || err) };
  }

  const world = {
    id: 'custom',
    name: base.name,
    tagline: base.tagline,
    kind: base.kind,
    aerial: base.aerial,
    custom: true,
    baseId: base.id,
    comfort,
    channels,
    prefer,
    affinity,
    palettes,
    temperature,
    cast,
    terrainMods,
    characterScheme,
  };

  const proof = proveScore(feat, world);
  proof.dna = paletteProof;
  return { world, proof, baseId: base.id };
}

function proveScore(features, world) {
  const comfort = comfortScore(features.drive, world.comfort);
  const rawCoverage = coverageScore(features, world.channels);
  const shape = shapeFit(features, world.prefer);
  const rawAffinity = affinityScore(features, world);

  // Theoretical maximums: the best any world could achieve on these
  // features. The custom world's channels/affinity are constructed to
  // hit these, so the normalized ratios are 1.0.
  const maxCov = coverageScore(features, buildOptimalChannels(features));
  const maxAff = affinityScore(features, { affinity: buildOptimalAffinity(features) });

  const coverageNorm = maxCov > 0 ? rawCoverage / maxCov : 1;
  const affinityNorm = maxAff > 0 ? rawAffinity / maxAff : 1;

  const mixed = 0.38 * comfort + 0.24 * coverageNorm + 0.16 * shape + 0.22 * affinityNorm;
  const score = clamp(Math.round(100 * mixed), 1, 100);

  return {
    score,
    comfort,
    shape,
    rawCoverage,
    maxCoverage: maxCov,
    coverageNorm,
    rawAffinity,
    maxAffinity: maxAff,
    affinityNorm,
    mixed,
    drive: features.drive,
  };
}
