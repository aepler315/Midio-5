// World-quality evaluation: what “looks good” means, without a public score.
//
// Song measurement, world adaptation, internal recommendation, and the
// gallery stay separate. This module records the current heuristic privately,
// picks the same quiet / transition / peak clock for every world, and emits
// a review sheet whose ratings a human fills. Diagnostics are not beauty.
// An empty sheet must not claim the 80% target has been met.
import { clamp, clamp01, hashSeed } from '../utils/math.js';
import { listWorlds } from '../world/Worlds.js';
import { scoreWorlds } from '../world/WorldScore.js';
import { pickPreviewPassages, PREVIEW_SPAN_MS } from '../ui/WorldPreview.js';

export const EVAL_VERSION = 1;
export const EVAL_SPAN_MS = PREVIEW_SPAN_MS;

/** Capture settings. Fixed so a still is a still, not a quality surprise. */
export const EVAL_QUALITY = Object.freeze({
  phenomenaFull: true,
  particleMul: 1,
  contactShadowsEnabled: true,
  rimLightEnabled: true,
  brushEnabled: true,
  reducedFlash: false,
});

export const REQUIRED_FAMILIES = Object.freeze([
  'sparse-piano', 'ambient', 'warm-bass', 'fast-percussion',
  'dense-guitars', 'orchestral', 'loose-rhythm',
]);

export const RATING_AXES = Object.freeze([
  'appeal', 'musicalTiming', 'identity', 'quietInterest', 'climaxHeadroom', 'clutter',
]);

/** Target to validate. Not a claimed result. */
export const ACCEPTANCE_TARGET = Object.freeze({
  appealMin: 4,
  timingMin: 4,
  holdoutShare: 0.8,
  noBlocking: true,
  note: 'Recommended results: no blocking visual defects, and at least 4/5 for appeal and musical timing in at least 80% of held-out reviewed cases. Calmness is a legitimate outcome.',
});

const TUNE = 'tune';
const HOLDOUT = 'holdout';

export function viewingOrder(worlds = listWorlds()) {
  return worlds.map((w) => w.id);
}

export function evaluationSeed(track) {
  if (Number.isFinite(track?.seed)) return track.seed >>> 0;
  return hashSeed(String(track?.id || 'eval'));
}

export function splitTracks(tracks, split = 'all') {
  const all = Array.isArray(tracks) ? tracks : [];
  if (split === TUNE) return all.filter((t) => t.split === TUNE);
  if (split === HOLDOUT) return all.filter((t) => t.split === HOLDOUT);
  return all;
}

function waveAsCurves(wave, durationMs) {
  if (!Array.isArray(wave) || !wave.length) return null;
  const dur = Math.max(1, durationMs || 1);
  const last = wave.length - 1;
  return {
    globalEnergyNorm(t) {
      const u = clamp01((Number(t) || 0) / dur);
      const x = u * last;
      const i = Math.min(last, Math.max(0, Math.floor(x)));
      const f = x - i;
      const a = Number(wave[i]) || 0;
      const b = Number(wave[Math.min(i + 1, last)]) || a;
      return a + (b - a) * f;
    },
  };
}

function energySample(track) {
  if (track?.energyCurves && typeof track.energyCurves.globalEnergyNorm === 'function') {
    return track.energyCurves;
  }
  return waveAsCurves(track?.energyWave, track?.durationMs);
}

export function pickEvaluationPassages(track = {}) {
  const durationMs = Math.max(0, Number(track.durationMs) || 0);
  const annotated = track.passages || null;
  const span = Math.min(EVAL_SPAN_MS, durationMs);
  const maxStart = Math.max(0, durationMs - span);
  const curves = energySample(track);
  const derived = pickPreviewPassages({ energyCurves: curves, durationMs });
  const source = annotated && Number.isFinite(annotated.quietMs) && Number.isFinite(annotated.peakMs)
    ? 'annotated'
    : curves ? 'derived' : 'fallback';
  const quietMs = source === 'annotated'
    ? clamp(Math.round(annotated.quietMs), 0, maxStart)
    : derived.quietMs;
  const peakMs = source === 'annotated'
    ? clamp(Math.round(annotated.peakMs), 0, maxStart)
    : derived.peakMs;
  const transitionMs = pickTransitionMs({
    durationMs, quietMs, peakMs, spanMs: span, sample: curves, structure: track.structure, annotated,
  });
  return {
    quietMs, transitionMs, peakMs,
    durationMs, spanMs: span, source,
  };
}

function pickTransitionMs({ durationMs, quietMs, peakMs, spanMs, sample, structure, annotated }) {
  if (Number.isFinite(annotated?.transitionMs)) {
    return Math.round(clamp(annotated.transitionMs, 0, Math.max(0, durationMs - spanMs)));
  }
  const duration = Math.max(0, durationMs || 0);
  const span = spanMs ?? Math.min(EVAL_SPAN_MS, duration);
  const maxStart = Math.max(0, duration - span);
  const read = sample && typeof sample.globalEnergyNorm === 'function'
    ? (t) => sample.globalEnergyNorm(t)
    : null;
  const bounds = Array.isArray(structure?.boundariesMs)
    ? structure.boundariesMs
    : (structure?.sections || []).map((s) => s.startMs).filter(Number.isFinite);
  const lo = duration * 0.08;
  const hi = duration * 0.92;
  let best = null;
  let bestDelta = -1;
  if (read && bounds.length) {
    for (const b of bounds) {
      if (!(b > lo && b < hi - span * 0.25)) continue;
      const delta = Math.abs(read(Math.min(duration, b + 1500)) - read(Math.max(0, b - 1500)));
      if (delta > bestDelta) { bestDelta = delta; best = b; }
    }
  }
  if (best == null && read && duration > span + 1000) {
    for (let t = lo; t <= hi - span; t += 200) {
      const delta = read(t + span * 0.45) - read(t);
      if (delta > bestDelta) { bestDelta = delta; best = t; }
    }
  }
  if (best == null) {
    const mid = Math.round(((quietMs || 0) + (peakMs || 0)) / 2);
    if (Math.abs(mid - quietMs) >= span * 0.4 && Math.abs(mid - peakMs) >= span * 0.4) best = mid;
    else best = duration * 0.35;
  }
  return Math.round(clamp(best, 0, maxStart));
}

export function privateScores(features) {
  if (!features || typeof features.drive !== 'number') return null;
  const ranked = scoreWorlds(features);
  return {
    recommendedId: ranked.find((r) => r.recommended)?.id || ranked[0]?.id || null,
    byWorld: ranked.map((r) => ({
      id: r.id,
      name: r.name,
      score: r.score,
      parts: r.parts,
      recommended: !!r.recommended,
    })),
    note: 'Internal fit heuristic, not visual quality or a probability.',
  };
}

export function seventyEightyCases(heuristic) {
  if (!heuristic?.byWorld) return [];
  const winner = heuristic.recommendedId;
  return heuristic.byWorld
    .filter((w) => w.score >= 70 && w.score <= 80)
    .map((w) => ({ id: w.id, score: w.score, isWinner: w.id === winner }));
}

export function diagnosticsFromFeatures(features = {}, passages = null) {
  const onset = clamp01(features.onset);
  const energyMean = clamp01(features.energyMean);
  const groove = clamp01(features.groove);
  const drive = clamp01(features.drive);
  return {
    eventDensity: onset,
    pulse: clamp01(features.pulse),
    drive,
    saturation: Math.max(onset, energyMean, groove, drive),
    contrast: clamp01(features.contrast),
    bass: clamp01(features.bass),
    transitionMs: passages?.transitionMs ?? null,
    frameMs: null,
    previewLatencyMs: null,
    sceneVisibility: null,
    note: 'Diagnostics, not an automatic beauty score. Null capture fields wait for a still/session dump.',
  };
}

function emptyReview(worldId) {
  return {
    worldId,
    appeal: null,
    musicalTiming: null,
    identity: null,
    quietInterest: null,
    climaxHeadroom: null,
    clutter: null,
    blockingDefect: false,
    notes: '',
  };
}

export function capturePlan(track, passages, worlds = listWorlds()) {
  const seed = evaluationSeed(track);
  const span = passages?.spanMs ?? EVAL_SPAN_MS;
  const shots = [
    ['quiet', passages.quietMs],
    ['transition', passages.transitionMs],
    ['peak', passages.peakMs],
  ];
  return {
    trackId: track.id,
    seed,
    quality: EVAL_QUALITY,
    spanMs: span,
    worlds: worlds.map((w) => ({
      worldId: w.id,
      stills: shots.map(([passage, tMs]) => ({ passage, tMs, seed })),
    })),
  };
}

export function evaluateTrack(track, { worlds = listWorlds() } = {}) {
  const order = viewingOrder(worlds);
  const passages = pickEvaluationPassages(track);
  const heuristic = privateScores(track.features);
  return {
    protocol: EVAL_VERSION,
    track: {
      id: track.id,
      split: track.split,
      family: track.family,
      representation: track.representation,
      title: track.title || track.id,
      durationMs: track.durationMs || 0,
    },
    seed: evaluationSeed(track),
    quality: EVAL_QUALITY,
    passages,
    viewingOrder: order,
    heuristic,
    seventyEighty: seventyEightyCases(heuristic),
    diagnostics: diagnosticsFromFeatures(track.features || {}, passages),
    capture: capturePlan(track, passages, worlds),
    reviews: order.map(emptyReview),
  };
}

export function validateCorpus(corpus) {
  const tracks = Array.isArray(corpus?.tracks) ? corpus.tracks : Array.isArray(corpus) ? corpus : [];
  const errors = [];
  if (tracks.length < 12 || tracks.length > 20) {
    errors.push(`need 12–20 tracks, got ${tracks.length}`);
  }
  const ids = new Set();
  const bySplit = { [TUNE]: new Set(), [HOLDOUT]: new Set() };
  const families = { [TUNE]: new Set(), [HOLDOUT]: new Set() };
  const reps = { [TUNE]: new Set(), [HOLDOUT]: new Set() };
  for (const t of tracks) {
    if (!t?.id) errors.push('track missing id');
    else if (ids.has(t.id)) errors.push(`duplicate id ${t.id}`);
    else ids.add(t.id);
    if (t.split !== TUNE && t.split !== HOLDOUT) errors.push(`${t.id || '?'} split must be tune or holdout`);
    if (t.split === TUNE || t.split === HOLDOUT) {
      bySplit[t.split].add(t.id);
      if (t.family) families[t.split].add(t.family);
      if (t.representation) reps[t.split].add(t.representation);
    }
    if (!t.family) errors.push(`${t.id} missing family`);
    if (!t.representation) errors.push(`${t.id} missing representation`);
    if (!Number.isFinite(t.durationMs) || t.durationMs <= 0) errors.push(`${t.id} needs a duration`);
    if (!t.source || !t.source.kind) errors.push(`${t.id} needs a source.kind (no audio is stored in-repo)`);
  }
  for (const fam of REQUIRED_FAMILIES) {
    if (!families[TUNE].has(fam)) errors.push(`tune split missing family ${fam}`);
    if (!families[HOLDOUT].has(fam)) errors.push(`holdout split missing family ${fam}`);
  }
  if (!reps[TUNE].has('midi') || !reps[TUNE].has('audio')) errors.push('tune split needs both midi and audio');
  if (!reps[HOLDOUT].has('midi') || !reps[HOLDOUT].has('audio')) errors.push('holdout split needs both midi and audio');
  return { ok: errors.length === 0, errors, n: tracks.length };
}

export function evaluateCorpus(corpus, { split = 'all', worlds = listWorlds() } = {}) {
  const tracks = splitTracks(Array.isArray(corpus?.tracks) ? corpus.tracks : corpus, split);
  const sheets = tracks.map((t) => evaluateTrack(t, { worlds }));
  return {
    protocol: EVAL_VERSION,
    split,
    acceptance: ACCEPTANCE_TARGET,
    validation: validateCorpus(corpus),
    sheets,
    summary: summarizeAcceptance(sheets, { split }),
  };
}

function ratingComplete(review) {
  return RATING_AXES.every((axis) => Number.isFinite(review?.[axis]));
}

function reviewPasses(review) {
  if (!review || review.blockingDefect) return false;
  return review.appeal >= ACCEPTANCE_TARGET.appealMin
    && review.musicalTiming >= ACCEPTANCE_TARGET.timingMin;
}

/**
 * Acceptance is computed only from filled ratings on the recommended world.
 * Missing ratings yield met: null — never a claimed pass.
 */
export function summarizeAcceptance(sheets, { split = 'all' } = {}) {
  const relevant = (sheets || []).filter((s) => split === 'all' || s.track.split === split);
  const holdout = relevant.filter((s) => s.track.split === HOLDOUT);
  const pool = split === TUNE ? relevant.filter((s) => s.track.split === TUNE) : holdout;
  const recommended = pool.map((s) => {
    const id = s.heuristic?.recommendedId;
    return (s.reviews || []).find((r) => r.worldId === id) || null;
  });
  const filled = recommended.filter(ratingComplete);
  const passing = filled.filter(reviewPasses);
  const share = filled.length ? passing.length / filled.length : null;
  return {
    target: ACCEPTANCE_TARGET,
    split: split === TUNE ? TUNE : HOLDOUT,
    tracks: pool.length,
    reviewed: filled.length,
    passing: passing.length,
    share,
    met: filled.length ? share >= ACCEPTANCE_TARGET.holdoutShare : null,
    claimed: false,
  };
}

export function applyReviews(sheet, reviewsByWorld) {
  if (!sheet || !reviewsByWorld) return sheet;
  return {
    ...sheet,
    reviews: sheet.reviews.map((r) => {
      const next = reviewsByWorld[r.worldId];
      return next ? { ...r, ...next, worldId: r.worldId } : r;
    }),
  };
}
