// Align a listener's annotation with a production run of the same recording
// (docs/listening/pipeline-design.md, "Align" and "Compare").
//
// What the report does:
//   - keeps the listener's own words and ratings verbatim, unknowns unknown;
//   - aggregates measured evidence and the live heuristics over each
//     annotated span, labelled with their own scale and source;
//   - scores only targets a predictor actually produced (run.semantic
//     'supported'), with the design's declared conventions: trend direction
//     from first vs last third with a 0.5 change on the calibrated 0-4 scale,
//     foreground-change matching one-to-one by timing distance within 3 s of
//     the listener's uncertainty interval;
//   - lists every unsupported target and every uncovered span.
// What it never does: compare a 0-1 proxy (energy, valence, epic) with a 0-4
// rating as if they measured the same thing, or infer an emotion from
// loudness or brightness.
import { validateRun } from './ProductionRun.js';
import { assertRunLabelFree } from './validateCase.js';

export const ALIGNMENT_FORMAT = 'midio-listening-alignment/1';
export const TREND_DELTA = 0.5;
export const EVENT_TOLERANCE_MS = 3000;

// Measured evidence a listener's sound rating may be shown beside. A proxy,
// never a measurement of the rating; no agreement verdict is computed.
const SOUND_PROXIES = Object.freeze({
  'sound.loudness': { path: 'energy', label: 'EnergyCurves.globalEnergyNorm, 0..1 relative to this recording' },
  'sound.brightness': { path: 'brightness', label: 'PitchTracker log-frequency centroid, 0..1' },
  'sound.activity': { path: 'onsetRate', label: 'detected onsets per second (all roles)' },
});

function mean(values) {
  let sum = 0, n = 0;
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v)) { sum += v; n++; }
  return n ? sum / n : null;
}

/** Values of a sampled series whose times fall in [a, b). */
function within(tMs, values, a, b) {
  const out = [];
  for (let i = 0; i < tMs.length; i++) if (tMs[i] >= a && tMs[i] < b) out.push(values[i]);
  return out;
}

function brightnessSeries(run) {
  const s = run.evidence?.spectral;
  if (!s || s.missing || !(s.featureRateHz > 0)) return null;
  return { tMs: s.brightness.map((_, f) => (f / s.featureRateHz) * 1000), values: s.brightness };
}

function onsetRate(run, a, b, role = null) {
  const on = run.evidence?.onsets || {};
  const lists = role ? [on[role] || []] : Object.values(on);
  let n = 0;
  for (const list of lists) for (const t of list) if (t >= a && t < b) n++;
  return (b - a) > 0 ? n / ((b - a) / 1000) : null;
}

function evidenceOver(run, a, b) {
  const e = run.evidence || {};
  const energy = e.energy && !e.energy.missing ? within(e.energy.tMs, e.energy.globalNorm, a, b) : [];
  const bands = {};
  if (e.energy && !e.energy.missing) e.energy.bandNames.forEach((name, i) => { bands[name] = mean(within(e.energy.tMs, e.energy.bands[i], a, b)); });
  const br = brightnessSeries(run);
  const tonal = (e.tonality?.timeline || []).filter((k) => k.tMs >= a && k.tMs < b);
  const tonics = {};
  for (const k of tonal) tonics[k.tonic] = (tonics[k.tonic] || 0) + 1;
  for (const k of Object.keys(tonics)) tonics[k] /= tonal.length;
  return {
    energy: { mean: mean(energy), min: energy.length ? Math.min(...energy.filter(Number.isFinite)) : null, max: energy.length ? Math.max(...energy.filter(Number.isFinite)) : null,
      scale: '0..1 relative to this recording', source: 'EnergyCurves.globalEnergyNorm' },
    bands,
    brightness: { mean: br ? mean(within(br.tMs, br.values, a, b)) : null, scale: '0..1 log-frequency centroid', source: 'PitchTracker' },
    onsetsPerSec: { all: onsetRate(run, a, b), rhythm: onsetRate(run, a, b, 'RHYTHM') },
    tonality: { meanConfidence: mean(tonal.map((k) => k.confidence)), tonicShare: tonics, windows: tonal.length, source: e.tonality?.source ?? null },
  };
}

function heuristicsOver(run, a, b) {
  const h = run.heuristics;
  const out = {};
  if (!h) return out;
  const scale = Object.fromEntries((h.definitions || []).map((d) => [d.name, d.scale]));
  for (const [name, values] of Object.entries(h.channels)) {
    const vs = within(h.tMs, values, a, b);
    if (vs.some((v) => typeof v === 'string')) {
      const share = {};
      for (const v of vs) if (v != null) share[v] = (share[v] || 0) + 1 / vs.length;
      out[name] = { share, scale: scale[name] ?? null };
    } else {
      out[name] = { mean: mean(vs.map((v) => (typeof v === 'boolean' ? Number(v) : v))), scale: scale[name] ?? null };
    }
  }
  return out;
}

/** Calibrated 0-4 series the run's predictor produced, if any. */
function predictedSeries(run, target) {
  if (run.semantic?.status !== 'supported') return null;
  const s = run.semantic.predictions?.series?.[target];
  return s && Array.isArray(s.tMs) && Array.isArray(s.values) ? s : null;
}

/** The design's trend convention, for a predicted target only. */
export function trendDirection(tMs, values, a, b, threshold = TREND_DELTA) {
  const third = (b - a) / 3;
  const first = mean(within(tMs, values, a, a + third));
  const last = mean(within(tMs, values, b - third, b));
  if (first == null || last == null) return null;
  const delta = last - first;
  return { first, last, delta, direction: delta >= threshold ? 'rising' : delta <= -threshold ? 'falling' : 'stable' };
}

/** Distance from a moment to a closed interval: zero inside. */
export function eventDistance(tMs, [lo, hi]) {
  return tMs < lo ? lo - tMs : tMs > hi ? tMs - hi : 0;
}

/**
 * Match same-direction foreground changes one-to-one by smallest timing
 * distance, at most `toleranceMs` outside the listener's interval.
 */
export function matchEvents(reference, predicted, toleranceMs = EVENT_TOLERANCE_MS) {
  const pairs = [];
  reference.forEach((r, i) => predicted.forEach((p, j) => {
    if (r.from !== p.from || r.to !== p.to) return;
    const d = eventDistance(p.tMs, r.withinMs);
    if (d <= toleranceMs) pairs.push({ i, j, d });
  }));
  pairs.sort((x, y) => x.d - y.d || x.i - y.i || x.j - y.j);
  const usedR = new Set(), usedP = new Set(), matched = [];
  for (const p of pairs) {
    if (usedR.has(p.i) || usedP.has(p.j)) continue;
    usedR.add(p.i); usedP.add(p.j);
    matched.push({ reference: p.i, predicted: p.j, errorMs: p.d });
  }
  return {
    toleranceMs, matched,
    misses: reference.map((_, i) => i).filter((i) => !usedR.has(i)),
    extras: predicted.map((_, j) => j).filter((j) => !usedP.has(j)),
    precision: predicted.length ? matched.length / predicted.length : null,
    recall: reference.length ? matched.length / reference.length : null,
    referenceWidthsMs: reference.map((r) => r.withinMs[1] - r.withinMs[0]),
  };
}

function humanTargets(segment) {
  const out = [];
  for (const [k, v] of Object.entries(segment.sound || {})) if (v != null) out.push(`sound.${k}`);
  for (const [name, e] of Object.entries(segment.emotions || {})) {
    if (e.intensity != null) out.push(`emotions.${name}.intensity`);
    if (e.role && e.role !== 'unclear') out.push(`emotions.${name}.role`);
  }
  for (const [k, v] of Object.entries(segment.affect || {})) if (v != null) out.push(`affect.${k}`);
  return out;
}

/**
 * Align `annotation` (parseAnnotation) with `run` (a production run.json).
 * `manifest` (validateCase) binds the two; without it the report says the
 * binding is unchecked.
 */
export function alignRun(annotation, run, { manifest = null } = {}) {
  const runCheck = validateRun(run);
  if (!runCheck.valid) throw new Error(`run refused: ${runCheck.errors.join('; ')}`);
  assertRunLabelFree(run, annotation);
  const manifestSha = manifest?.recording?.sha256 ?? null;
  if (manifestSha && manifestSha !== run.recording.sha256) throw new Error('the run analysed a different recording than the annotation is bound to');
  const durationMs = run.recording.decoded.durationMs;
  const analyzedTo = run.coverage.analyzedToMs;
  const supported = run.semantic?.status === 'supported';

  const unsupported = new Set();
  const uncovered = [];
  let annotatedMs = 0;
  const segments = annotation.segments.map((s, index) => {
    const [a, b] = s.spanMs;
    const base = { index, span: s.span, spanMs: s.spanMs, label: s.label ?? null, notes: s.notes ?? null, confidence: s.confidence,
      human: { sound: s.sound ?? null, emotions: s.emotions ?? null, affect: s.affect ?? null } };
    if (a == null || b == null) { uncovered.push({ segment: index, reason: 'not placed in time' }); return { ...base, covered: false }; }
    annotatedMs += b - a;
    if (b > analyzedTo + 1) uncovered.push({ segment: index, reason: `ends past the analysed interval (${Math.round(analyzedTo)} ms)` });
    const targets = humanTargets(s);
    const predictions = {};
    for (const t of targets) {
      const series = predictedSeries(run, t);
      if (!series) { unsupported.add(t); predictions[t] = { status: 'unsupported' }; continue; }
      const predicted = mean(within(series.tMs, series.values, a, b));
      const human = t.split('.').reduce((o, k) => o?.[k], { sound: s.sound, emotions: s.emotions, affect: s.affect });
      predictions[t] = typeof human === 'number' && predicted != null
        ? { status: 'scored', predicted, human, absoluteError: Math.abs(predicted - human), withinOne: Math.abs(predicted - human) <= 1 }
        : { status: 'no-comparison', predicted, human: human ?? null };
    }
    const proxies = {};
    for (const t of targets) if (SOUND_PROXIES[t]) proxies[t] = { proxy: SOUND_PROXIES[t].label, verdict: 'none: a proxy is not a calibrated rating' };
    return { ...base, covered: b <= analyzedTo + 1, evidence: evidenceOver(run, a, b), heuristics: heuristicsOver(run, a, b), proxies, predictions };
  });

  const trends = annotation.trends.map((t, index) => {
    const [a, b] = t.spanMs;
    const out = { index, span: t.span, spanMs: t.spanMs, target: t.target, direction: t.direction, confidence: t.confidence, notes: t.notes ?? null };
    if (a == null || b == null) return { ...out, prediction: { status: 'unplaced' } };
    const series = predictedSeries(run, t.target);
    if (!series) unsupported.add(t.target);
    const prediction = series ? { status: 'scored', ...trendDirection(series.tMs, series.values, a, b) } : { status: 'unsupported' };
    if (prediction.status === 'scored') prediction.agrees = prediction.direction === t.direction;
    let evidenceDelta = null;
    const proxy = SOUND_PROXIES[t.target];
    if (proxy?.path === 'energy') {
      const e = run.evidence.energy;
      const d = trendDirection(e.tMs, e.globalNorm, a, b, Infinity);
      evidenceDelta = d && { proxy: proxy.label, first: d.first, last: d.last, delta: d.delta, verdict: 'none' };
    } else if (proxy?.path === 'brightness') {
      const br = brightnessSeries(run);
      const d = br && trendDirection(br.tMs, br.values, a, b, Infinity);
      evidenceDelta = d && { proxy: proxy.label, first: d.first, last: d.last, delta: d.delta, verdict: 'none' };
    }
    return { ...out, prediction, evidenceDelta };
  });

  const reference = annotation.events.filter((e) => !e.withinMs.includes(null));
  const predictedEvents = supported && Array.isArray(run.semantic.predictions?.events) ? run.semantic.predictions.events : null;
  if (!predictedEvents && reference.length) unsupported.add('events.foreground_change');
  const events = {
    reference: annotation.events.map((e, index) => ({ index, within: e.within, withinMs: e.withinMs, from: e.from, to: e.to, confidence: e.confidence,
      widthMs: e.withinMs.includes(null) ? null : e.withinMs[1] - e.withinMs[0], notes: e.notes ?? null })),
    matching: predictedEvents ? matchEvents(reference, predictedEvents) : { status: 'unsupported' },
  };

  return {
    format: ALIGNMENT_FORMAT,
    caseId: manifest?.caseId ?? run.caseId ?? null,
    run: { runId: run.runId, commit: run.source.commit, recordingSha256: run.recording.sha256, semantic: run.semantic.status },
    binding: { manifestRecordingSha256: manifestSha, match: manifestSha ? true : null, checked: !!manifestSha },
    annotation: { status: annotation.status, listener: annotation.listener, perspective: annotation.perspective, basis: annotation.basis,
      audioFile: annotation.audio_file, summary: annotation.summary },
    coverage: {
      recordingMs: durationMs, analyzedToMs: analyzedTo, annotatedMs, unannotatedMs: Math.max(0, durationMs - annotatedMs),
      segments: annotation.segments.length, trends: annotation.trends.length, events: annotation.events.length, uncovered,
    },
    segments, trends, events,
    unsupportedTargets: [...unsupported].sort(),
    notes: [
      'Measured evidence and heuristics are shown beside the listener\'s ratings, not scored against them: no calibrated mapping exists.',
      'Heuristic valence/epic are not emotion intensities. Unrated emotions are unknown, not absent.',
    ],
  };
}
