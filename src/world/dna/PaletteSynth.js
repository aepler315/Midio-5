// Palette synthesis — the song DNA becomes an actual palette, not a pick
// from a fixed list. Generated in OKLCH (see OklchColor.js for why), scored
// against hard constraints (must clear) and soft objectives (should be
// good), best-of-N wins. This is constrained optimization, not a single
// deterministic formula: candidates that would strobe against Midio, wash
// out the parallax, or clip the sRGB gamut into mud are rejected outright.
import { clamp01, lerp, lerpHue, mulberry32 } from '../../utils/math.js';
import { oklchToHex, hexToOklab, oklabDelta } from './OklchColor.js';
import { FIFTHS_ORDER } from './SongDNA.js';
import {
  buildShapeGrammar, computeTemperature, pickFx, pickParticleKind, pickCelestialKind, deriveParticleMotion,
} from './ShapeGrammar.js';

const N_CANDIDATES = 400;

// Midio renders at HSL lightness ~65-78% (src/sim/Midasus.js:469,480,507)
// across a hue that cycles with every note's pitch class — full hue
// coverage, so hue-only separation can't work. What holds for every hue is
// keeping the silhouette she's staged against well below that band.
const SILHOUETTE_MAX_L = 0.36;
const SKY_STOP_MIN_DELTA = 0.035;
const SILHOUETTE_SKY_MIN_DELTA = 0.11;

function hueFromTonic(tonicPc) {
  const idx = FIFTHS_ORDER.indexOf(((tonicPc % 12) + 12) % 12);
  return (idx >= 0 ? idx : 0) * 30;
}

function roleLch(role, anchor) {
  const { baseHue, rotationDeg, chromaScale, lightnessScale, temp, hueJitter } = anchor;
  const jitter = (role.jitterMul || 0) * hueJitter;
  const H = (baseHue + role.hueFrac * rotationDeg + jitter + 360) % 360;
  const C = Math.max(0.01, role.chromaBase * chromaScale * (1 + 0.25 * temp));
  const L = clamp01(role.lightBase + role.lightGain * lightnessScale);
  return { L, C, H };
}

const ROLES = {
  // silhouette is deliberately near-decoupled from lightnessScale (small
  // lightGain): it must read as dark against the sky at every tempo, not
  // just the slow ones, so Midio silhouettes cleanly against it.
  silhouette: { hueFrac: -0.22, chromaBase: 0.06, lightBase: 0.02, lightGain: 0.05, jitterMul: 0.15 },
  skyDark: { hueFrac: 0, chromaBase: 0.11, lightBase: 0.14, lightGain: 0.26, jitterMul: 0.2 },
  skyMid: { hueFrac: 0.16, chromaBase: 0.15, lightBase: 0.16, lightGain: 0.55, jitterMul: 0.4 },
  skyHot: { hueFrac: 0.36, chromaBase: 0.19, lightBase: 0.30, lightGain: 1.05, jitterMul: 0.6 },
  halo: { hueFrac: 0.5, chromaBase: 0.15, lightBase: 0.80, lightGain: 0.14, jitterMul: 0.5 },
  celestial: { hueFrac: 0.55, chromaBase: 0.17, lightBase: 0.85, lightGain: 0.10, jitterMul: 0.5 },
  particle: { hueFrac: 0.85, chromaBase: 0.19, lightBase: 0.76, lightGain: 0.14, jitterMul: 0.8 },
};

function synthesizeCandidate(dna, grammar, temp, rand) {
  const baseHue = hueFromTonic(dna.tonicPc);
  const majorSignal = dna.isMajor ? dna.keyConfidence : -dna.keyConfidence;
  const anchor = {
    baseHue,
    rotationDeg: lerp(14, 145, dna.harmonicComplexity) * (0.82 + 0.36 * rand()),
    chromaScale: clamp01(0.55 + 0.22 * majorSignal + 0.28 * dna.energyMean) * (0.82 + 0.36 * rand()),
    lightnessScale: lerp(0.55, 1.15, clamp01(dna.tempoHeat)) * (0.85 + 0.3 * rand()),
    temp,
    hueJitter: (rand() - 0.5) * 26,
  };

  const lch = {};
  const hex = {};
  for (const key in ROLES) {
    lch[key] = roleLch(ROLES[key], anchor);
    hex[key] = oklchToHex(lch[key].L, lch[key].C, lch[key].H);
  }

  return { anchor, lch, hex };
}

function hardConstraintViolation(hex, lch) {
  let violation = 0;
  if (lch.silhouette.L > SILHOUETTE_MAX_L) violation += (lch.silhouette.L - SILHOUETTE_MAX_L) * 4;

  const skyDarkLab = hexToOklab(hex.skyDark);
  const skyMidLab = hexToOklab(hex.skyMid);
  const skyHotLab = hexToOklab(hex.skyHot);
  const silLab = hexToOklab(hex.silhouette);

  const dDarkMid = oklabDelta(skyDarkLab, skyMidLab);
  const dMidHot = oklabDelta(skyMidLab, skyHotLab);
  if (dDarkMid < SKY_STOP_MIN_DELTA) violation += (SKY_STOP_MIN_DELTA - dDarkMid) * 6;
  if (dMidHot < SKY_STOP_MIN_DELTA) violation += (SKY_STOP_MIN_DELTA - dMidHot) * 6;

  const dSilSky = oklabDelta(silLab, skyDarkLab);
  if (dSilSky < SILHOUETTE_SKY_MIN_DELTA) violation += (SILHOUETTE_SKY_MIN_DELTA - dSilSky) * 5;

  return violation;
}

function warmthOf(hue) {
  // 1 at hue=30 (amber), 0 at hue=210 (cyan) — a continuous warm/cool axis.
  return clamp01(0.5 + 0.5 * Math.cos(((hue - 30) * Math.PI) / 180));
}

function softScore(dna, anchor, lch) {
  // Vibe alignment: mode + energy vs how warm/bright the hot sky stop reads.
  const majorSignal = dna.isMajor ? dna.keyConfidence : -dna.keyConfidence;
  const valence = clamp01(0.5 + 0.32 * majorSignal + 0.22 * (dna.energyMean - 0.5));
  const warmth = warmthOf(lch.skyHot.H);
  const vibeAlignment = 1 - Math.abs(valence - (0.5 * warmth + 0.5 * lch.skyHot.L));

  // Internal harmony: role hues should sit close to the scheme anchors
  // (baseHue + role.hueFrac*rotation) — penalize how far jitter pushed them.
  let hueDeviation = 0, count = 0;
  for (const key in ROLES) {
    const target = (anchor.baseHue + ROLES[key].hueFrac * anchor.rotationDeg + 360) % 360;
    const actual = lch[key].H;
    const d = Math.abs(lerpHue(target, actual, 1) - target);
    const wrapped = Math.min(d, 360 - d);
    hueDeviation += wrapped;
    count++;
  }
  const internalHarmony = clamp01(1 - (hueDeviation / count) / 30);

  return 0.55 * vibeAlignment + 0.45 * internalHarmony;
}

function noveltyPenalty(seedKey) {
  if (typeof localStorage === 'undefined') return 0;
  try {
    const raw = localStorage.getItem('midio.worldDnaHistory');
    const history = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(history) || !history.length) return 0;
    let minDist = Infinity;
    for (const h of history) {
      const d = Math.abs((h.baseHue ?? 0) - (seedKey.baseHue ?? 0));
      const wrapped = Math.min(d, 360 - d);
      minDist = Math.min(minDist, wrapped);
    }
    return clamp01(1 - minDist / 40) * 0.15; // small nudge, never overrides song identity
  } catch {
    return 0;
  }
}

function rememberDna(seedKey) {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem('midio.worldDnaHistory');
    const history = raw ? JSON.parse(raw) : [];
    const next = [seedKey, ...(Array.isArray(history) ? history : [])].slice(0, 24);
    localStorage.setItem('midio.worldDnaHistory', JSON.stringify(next));
  } catch {
    // best-effort only
  }
}

/** Generate N candidates, reject/penalize hard-constraint violations, score
 *  the rest, return the best — plus a proof object showing why it won. */
export function synthesizePalette(dna, temperatureOverride = null) {
  const grammar = buildShapeGrammar(dna);
  const temp = temperatureOverride ?? computeTemperature(dna);
  const rand = mulberry32((dna.seed ^ 0x9e3779b9) >>> 0);

  let best = null, bestScore = -Infinity, bestValid = false;
  for (let i = 0; i < N_CANDIDATES; i++) {
    const c = synthesizeCandidate(dna, grammar, temp, rand);
    const violation = hardConstraintViolation(c.hex, c.lch);
    const valid = violation === 0;
    const soft = softScore(dna, c.anchor, c.lch);
    const novelty = valid ? noveltyPenalty({ baseHue: c.anchor.baseHue }) : 0;
    const score = soft + novelty - 1000 * violation;
    const better = best === null || (valid && !bestValid) || (valid === bestValid && score > bestScore);
    if (better) { best = c; bestScore = score; bestValid = valid; }
  }

  rememberDna({ baseHue: best.anchor.baseHue });

  const fx = pickFx(temp);
  const particleKind = pickParticleKind(grammar, temp);
  const { direction: particleDirection, driftBias } = deriveParticleMotion(dna);
  const celestialKind = pickCelestialKind(dna);
  const isMoon = celestialKind === 'moon';

  const profile = {
    sky: [best.hex.skyDark, best.hex.skyMid, best.hex.skyHot],
    silhouette: best.hex.silhouette,
    celestial: {
      kind: celestialKind,
      color: best.hex.celestial,
      radius: Math.round(30 + temp * 36 + (isMoon ? 8 : 0)),
      haloColor: best.hex.halo,
      veiled: temp > 0.72 && grammar.spikeCluster > 0.3,
      ring: isMoon && grammar.arch > 0.3,
      shafts: !isMoon && (temp > 0.55 || dna.air > 0.6),
    },
    particles: {
      kind: particleKind,
      color: best.hex.particle,
      count: Math.round(16 + temp * 46 + dna.noteDensity * 22),
      speed: Math.round(10 + temp * 110 + dna.percussionDensity * 40),
      direction: particleDirection,
      driftBias,
    },
    fx,
    // BiomeManager scales the ridge-dance amplitude by this directly
    // (BiomeManager.js:3828 etc.) — stock worlds span roughly 0.6-1.35, not
    // 0-1, so clamping to 0-1 here would make every generated world dance
    // visibly less than a stock one at the same energy.
    terrainEnergy: lerp(0.6, 1.35, clamp01(0.3 * grammar.spikeCluster + 0.3 * grammar.verticalStack + 0.2 * temp + 0.2 * dna.dyn)),
  };

  return {
    profile,
    temperature: temp,
    valid: bestValid,
    proof: {
      candidatesTried: N_CANDIDATES,
      hardConstraintsSatisfied: bestValid,
      softScore: bestScore,
      baseHue: best.anchor.baseHue,
      rotationDeg: best.anchor.rotationDeg,
      grammar,
    },
  };
}

/** One palette entry per distinct section label, sharing the base hue
 *  family but shifted in lightness/chroma/temperature — deterministic per
 *  (song seed, label) so the same section always reads the same way on
 *  replay. Falls back to a single entry when there's no section data. */
export function synthesizeSectionPalettes(dna, name) {
  // castBiomes forbids picking the same name twice in a row, so a single
  // entry would strand every section after the first with no candidate.
  // Detected structure wins when we have it; otherwise fall back to three
  // deterministic movements so casting always has real choices.
  const detected = Array.isArray(dna.sectionLabels) ? [...new Set(dna.sectionLabels)] : [];
  const labels = detected.length >= 2 ? detected : ['A', 'B', 'C'];

  const baseTemp = computeTemperature(dna);
  const palettes = [];
  const temperature = {};

  labels.forEach((label, i) => {
    const rand = mulberry32(dna.seed ^ (0x1000193 * (i + 1)) ^ hashOfLabel(label));
    const sectionTemp = clamp01(baseTemp + (rand() - 0.5) * 0.30);
    const sectionDna = { ...dna, tempoHeat: clamp01(dna.tempoHeat + (rand() - 0.5) * 0.2) };
    const { profile } = synthesizePalette(sectionDna, sectionTemp);
    const paletteName = `${name}_${label}_${i}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    palettes.push({ ...profile, name: paletteName });
    temperature[paletteName] = sectionTemp;
  });

  return { palettes, temperature };
}

function hashOfLabel(label) {
  const s = String(label || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}
