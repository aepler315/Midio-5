// Binding the world-evaluation corpus to exact recordings, freezing its
// split, and the baseline review book a human fills in.
//
// A corpus track names a recording (a URL, a generator, a local slot, or only
// a feature snapshot). It is bound only by a valid production run of that
// recording's bytes (ProductionRun.js): hash, decoded duration, analysed
// interval, source revision. Nothing else -- not a title, not a URL -- binds.
//
// The acceptance target is WorldQuality's (both appeal and musical timing at
// least 4/5, no blocking defect, in at least 80% of reviewed held-out cases).
// Only real recordings that are bound and reviewed count. Synthetic or
// unrated cases never count as successful musical cases, and an empty book
// establishes no rate.
import { ACCEPTANCE_TARGET } from '../WorldQuality.js';
import { validateRun } from './ProductionRun.js';

export const BINDINGS_FORMAT = 'midio-recording-bindings/1';
export const SPLIT_FORMAT = 'midio-split-manifest/1';
export const REVIEW_BOOK_FORMAT = 'midio-production-review-book/1';
export const REVIEW_FIELDS = Object.freeze(['appeal', 'musicalTiming', 'blockingDefect', 'listenerNotes', 'reviewer', 'reviewedCommit']);

const SPLITS = new Set(['tune', 'holdout']);

function emptyReview() {
  return Object.fromEntries(REVIEW_FIELDS.map((k) => [k, null]));
}

/** What a track's source can be bound to, before any run. */
function sourceStatus(track) {
  const kind = track?.source?.kind;
  if (track?.representation === 'midi' || kind === 'generator') return { status: 'synthetic', reason: 'generated MIDI, not a recording' };
  if (kind === 'features') return { status: 'unavailable', reason: 'feature snapshot only; the corpus references no recording' };
  if (kind === 'url' || kind === 'local') return { status: 'unbound', reason: kind === 'local' ? 'operator-supplied slot; no recording analysed yet' : 'not analysed yet' };
  return { status: 'unavailable', reason: `unknown source kind ${kind}` };
}

/**
 * Bind corpus tracks to runs (matched by run.caseId). Returns the bindings
 * and every reason a binding was refused.
 */
export function bindCorpus(corpus, runs = []) {
  const tracks = Array.isArray(corpus?.tracks) ? corpus.tracks : [];
  const errors = [];
  const byCase = new Map();
  for (const run of runs) {
    const check = validateRun(run);
    if (!run?.caseId) { errors.push(`run ${run?.runId ?? '?'} names no corpus case`); continue; }
    if (!check.valid) { errors.push(`${run.caseId}: run ${run.runId ?? '?'} refused: ${check.errors.join('; ')}`); continue; }
    (byCase.get(run.caseId) || byCase.set(run.caseId, []).get(run.caseId)).push(run);
  }
  const known = new Set(tracks.map((t) => t.id));
  for (const id of byCase.keys()) if (!known.has(id)) errors.push(`run for unknown corpus case ${id}`);

  const bound = tracks.map((t) => {
    const base = { id: t.id, split: t.split, family: t.family ?? null, representation: t.representation ?? null,
      recordingGroup: t.group || t.id, source: t.source?.href ? { kind: t.source.kind, href: t.source.href } : { kind: t.source?.kind ?? null } };
    const { status, reason } = sourceStatus(t);
    const caseRuns = byCase.get(t.id) || [];
    if (status !== 'unbound' || !caseRuns.length) return { ...base, status, reason, recording: null, runs: [] };
    const hashes = new Set(caseRuns.map((r) => r.recording.sha256));
    if (hashes.size > 1) {
      errors.push(`${t.id}: runs disagree on the recording (${[...hashes].map((h) => h.slice(0, 12)).join(', ')})`);
      return { ...base, status: 'conflict', reason: 'runs of different recordings', recording: null, runs: [] };
    }
    const r = caseRuns[0];
    return {
      ...base, status: 'bound', reason: null,
      recording: { sha256: r.recording.sha256, byteLength: r.recording.byteLength, fileName: r.recording.fileName,
        decodedDurationMs: r.recording.decoded.durationMs, sampleRate: r.recording.decoded.sampleRate },
      runs: caseRuns.map((x) => ({ runId: x.runId, commit: x.source.commit, analyzedToMs: x.coverage.analyzedToMs, createdAt: x.createdAt })),
    };
  });

  // One recording, one group, one split: a recording in both splits, or in
  // two groups, would leak the holdout into tuning.
  const owner = new Map();
  for (const b of bound) {
    if (b.status !== 'bound') continue;
    const prev = owner.get(b.recording.sha256);
    if (!prev) { owner.set(b.recording.sha256, b); continue; }
    if (prev.split !== b.split) errors.push(`${prev.id} (${prev.split}) and ${b.id} (${b.split}) are the same recording in both splits`);
    else if (prev.recordingGroup !== b.recordingGroup) errors.push(`${prev.id} and ${b.id} are the same recording in different groups`);
  }
  return { format: BINDINGS_FORMAT, tracks: bound, errors };
}

/** The frozen split: recording groups and the recordings bound to them. */
export function freezeSplit(bindings) {
  const groups = { tune: [], holdout: [] };
  const recordings = {};
  const errors = [...(bindings?.errors || [])];
  for (const b of bindings?.tracks || []) {
    if (!SPLITS.has(b.split)) { errors.push(`${b.id}: split ${b.split} is not tune or holdout`); continue; }
    if (!groups[b.split].includes(b.recordingGroup)) groups[b.split].push(b.recordingGroup);
    if (b.status === 'bound') recordings[b.recording.sha256] = { group: b.recordingGroup, split: b.split };
  }
  for (const g of groups.tune) if (groups.holdout.includes(g)) errors.push(`group ${g} is in both splits`);
  groups.tune.sort(); groups.holdout.sort();
  return { format: SPLIT_FORMAT, groups, recordings, frozen: errors.length === 0, errors };
}

function mean(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

/** A few readable numbers per run for the book's table (exploratory). */
export function runDigest(run) {
  const h = run?.heuristics;
  const c = h?.channels || {};
  const kinds = {};
  for (const k of c['weather.kind'] || []) if (k != null) kinds[k] = (kinds[k] || 0) + 1;
  const n = h?.tMs?.length || 0;
  const holdIdx = (c['opening.holding'] || []).findIndex((v) => v === false);
  const ev = run?.evidence || {};
  return {
    durationMs: run?.recording?.decoded?.durationMs ?? null,
    bpm: ev.tempo?.bpm ?? null, tempoConfidence: ev.tempo?.confidence ?? null, freeTime: ev.tempo?.freeTime ?? null,
    globalKeyConfidence: ev.tonality?.global?.confidence ?? null,
    meanEnergy: mean(ev.energy?.globalNorm || []),
    meanCalm: mean(c['calm.level'] || []), meanEpic: mean(c['vibe.epic'] || []), meanValence: mean(c['vibe.valence'] || []),
    meanTonicConfidence: mean(c['vibe.tonicConfidence'] || []),
    drops: (c['hype.dropCount'] || []).at(-1) ?? null,
    openingReleasedAtMs: holdIdx >= 0 ? h.tMs[holdIdx] : null,
    weatherShare: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, n ? v / n : 0])),
    inferredPitchShare: ev.pitchProvenance?.notes ? ev.pitchProvenance.inferredPitch / ev.pitchProvenance.notes : null,
    sections: ev.structure?.boundariesMs ? Math.max(0, ev.structure.boundariesMs.length - 1) : null,
  };
}

/** The baseline review book: one empty review per case, for a human. */
export function baselineReviewBook(bindings, runs = []) {
  const runById = new Map(runs.map((r) => [r.runId, r]));
  const cases = (bindings?.tracks || []).map((b) => {
    const latest = b.runs?.length ? runById.get(b.runs[b.runs.length - 1].runId) : null;
    return {
      id: b.id, split: b.split, family: b.family, representation: b.representation, status: b.status, reason: b.reason,
      countsAsMusicalCase: b.status === 'bound' && b.representation === 'audio',
      recordingSha256: b.recording?.sha256 ?? null,
      runId: latest?.runId ?? null,
      digest: latest ? runDigest(latest) : null,
      review: emptyReview(),
    };
  });
  const book = { format: REVIEW_BOOK_FORMAT, acceptance: ACCEPTANCE_TARGET, reviewFields: [...REVIEW_FIELDS], cases };
  return { ...book, summary: summarizeReviewBook(book) };
}

function complete(review) {
  return Number.isFinite(review?.appeal) && Number.isFinite(review?.musicalTiming) && typeof review?.blockingDefect === 'boolean';
}

function passes(review) {
  return complete(review) && !review.blockingDefect
    && review.appeal >= ACCEPTANCE_TARGET.appealMin && review.musicalTiming >= ACCEPTANCE_TARGET.timingMin;
}

/**
 * Coverage and denominators first, then the rate -- and no rate at all
 * until a held-out real recording has a complete review.
 */
export function summarizeReviewBook(book) {
  const out = {};
  for (const split of ['tune', 'holdout']) {
    const cases = (book?.cases || []).filter((c) => c.split === split);
    const real = cases.filter((c) => c.countsAsMusicalCase);
    const reviewed = real.filter((c) => complete(c.review));
    const passing = reviewed.filter((c) => passes(c.review));
    const rate = reviewed.length ? passing.length / reviewed.length : null;
    out[split] = {
      cases: cases.length,
      synthetic: cases.filter((c) => c.status === 'synthetic').length,
      unavailable: cases.filter((c) => c.status !== 'bound' && c.status !== 'synthetic').length,
      boundRecordings: real.length,
      reviewed: reviewed.length,
      unreviewedBound: real.length - reviewed.length,
      passing: passing.length,
      rate,
      met: split === 'holdout' && reviewed.length ? rate >= ACCEPTANCE_TARGET.holdoutShare : null,
      reviewedShareOfCases: cases.length ? reviewed.length / cases.length : null,
    };
  }
  out.claimed = false;
  out.note = out.holdout.reviewed
    ? `${out.holdout.passing} of ${out.holdout.reviewed} reviewed held-out recordings pass (${out.holdout.cases} held-out cases in all).`
    : 'No held-out recording has a complete review: no acceptance rate is established.';
  return out;
}
