// Watchability match: how well a song would play in a world's visual suite.
//
// Not "is this a city song." The question is: if we drive this world's
// channels with this song, does the show sit in a sweet spot — enough
// going on to watch, not so much that every window strobes and every
// peak clips. A drone leaves The Range sitting still (boring). A wall
// of sound in After Hours lights every window at once (too intense).
import { clamp01, clamp } from '../utils/math.js';
import { listWorlds, getWorld } from './Worlds.js';
import { buildSongProfile } from '../audio/SongProfile.js';
import { adaptWorld } from './WorldAdaptation.js';

/** Shared extraction lives in SongProfile. Kept here so existing callers
 *  and tests do not have to move; scoring still consumes `watch`. */
export function extractWatchFeatures(data = {}) {
  return buildSongProfile(data).watch;
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
  // Comfort bands overlap heavily in the middle of drive-space (see
  // Worlds.js — up to five worlds' bands cover 0.30..0.52), so this
  // out-of-range falloff is the only thing that can actually separate a
  // well-matched world from a mismatched one for a typical song. The old
  // coefficient (1.35) plus a 0.08 floor meant even a badly-mismatched
  // world (dist ~0.3-0.4, common for real songs since drive rarely leaves
  // 0.15..0.85) never scored below ~0.3-0.4 — nearly as high as a
  // well-matched world's in-range floor of 0.78, which is what let
  // farside/fathom lose pickups they should have won. Steeper falloff, no
  // floor add-on: being outside a world's comfort band now costs real score.
  // Quadratic, not linear: a near-miss (drive just past the edge of the
  // band) barely costs anything -- other components can still carry a
  // genuinely close song -- but a real mismatch (a song whose drive sits
  // far from a world's band) is crushed hard, instead of settling into the
  // old formula's mid-0.3s floor that left every world looking plausible.
  const dist = drive < lo ? lo - drive : drive - hi;
  return clamp01(0.78 - dist * dist * 8) * 0.9;
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
 *
 * Worlds flagged `manualOnly` are excluded from the default set. They are
 * chosen by hand or not at all, and this is the one place that has to
 * enforce it: buildCustomWorld picks its base from `scoreWorlds(feat)[0]`,
 * so a manual-only world left in the ranking could be cloned into a custom
 * world -- inheriting a `kind` (and renderer expectation) that the rest of
 * the custom-world machinery has no path for. Filtering here covers both
 * the recommendation and the base pick at once. An explicit `worlds`
 * argument is still honored verbatim, so a caller that deliberately passes
 * one in can still score it.
 */
export function scoreWorlds(features, worlds = listWorlds().filter((w) => !w.manualOnly)) {
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

// ── World adaptation ───────────────────────────────────────────────
//
// Construction lives in WorldAdaptation.adaptWorld. Scoring stays here
// and is a heuristic, not a constructed 100. An adapted world keeps the
// base world's channels, affinity, prefer and comfort, so Choose-for-me
// can still compare apples to apples after adaptation.

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

/**
 * Song-specific interpretation of one registered world. Cathode keeps its
 * pixel renderer and four-color ramps; painterly worlds overlay as `custom`
 * with a stable `registeredId` and a per-song `instanceId`.
 */
export function buildWorldVariant(baseId, features, data = null) {
  const feat = features && typeof features.drive === 'number'
    ? features
    : extractWatchFeatures(features || {});
  const base = getWorld(baseId);
  if (base.id !== baseId) {
    throw new Error(`Cannot build a tailored variant for world ${baseId}`);
  }
  const adapted = adaptWorld(base, data?.profile || feat, { ...(data || {}), profile: data?.profile });
  const proof = proveScore(feat, adapted.world);
  proof.dna = adapted.proof?.dna || null;
  proof.degraded = adapted.degraded;
  return { world: adapted.world, proof, baseId: base.id };
}

/**
 * Choose-for-me constructor: score, then adapt the winner. Not a privileged
 * gallery card — the chooser calls buildWorldVariant with the picked world.
 */
export function buildCustomWorld(features, data = null) {
  const feat = features && typeof features.drive === 'number'
    ? features
    : extractWatchFeatures(features || {});
  const ranked = scoreWorlds(feat);
  return buildWorldVariant(ranked[0].id, feat, data);
}

function proveScore(features, world) {
  const comfort = comfortScore(features.drive, world.comfort);
  const rawCoverage = coverageScore(features, world.channels);
  const shape = shapeFit(features, world.prefer);
  const rawAffinity = affinityScore(features, world);

  // Theoretical maximums: the best any channel/affinity layout could
  // achieve on these features. Adapted worlds keep the base world's
  // layout, so the ratios are a diagnostic, not a constructed 1.0.
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
