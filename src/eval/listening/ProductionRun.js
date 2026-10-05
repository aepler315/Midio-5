// A production run: one recording, analysed whole by the browser analyzer
// Midio plays with, and its live heuristics stepped through the song the way
// playback steps them. Machine evidence only. Human labels never enter it
// (docs/listening/pipeline-design.md, "Machine run").
//
// Three layers, kept apart:
//   evidence    measured acoustic features (energy, brightness, tonality,
//               tempo, structure, onsets) with their provenance
//   heuristics  the live directors' outputs (calm, hype, vibe, key, weather,
//               opening, coda), sampled sequentially on heard time
//   semantic    calibrated emotion predictions: `unsupported` until a
//               predictor exists. Never neutral, zero or a guessed confidence.
//
// Pure module: runs in the browser page the exporter drives and in Node
// tests. Hashing, files and the browser live in the CLI
// (tools/listening/export-production.mjs).
import { BAND_NAMES } from '../../audio/bands.js';
import { isAuthoredPitch } from '../../audio/TonalEvidence.js';
import { BUNDLE_VERSION } from '../../audio/AnalysisBundle.js';
import { PROFILE_VERSION } from '../../audio/SongProfile.js';

export const RUN_FORMAT = 'midio-production-run/1';
/** Version of the evidence/heuristic field layout below. */
export const FEATURE_EXPORT_VERSION = 1;
/** Playback's frame step (60 fps) unless the operator chooses another. */
export const DEFAULT_STEP_MS = 1000 / 60;
export const DEFAULT_SAMPLE_MS = 100;
/** Decoded duration and analysed duration may differ by frame rounding. */
export const COVERAGE_TOLERANCE_MS = 50;

export const SEMANTIC_UNSUPPORTED = Object.freeze({
  status: 'unsupported',
  reason: 'No semantic emotion predictor exists. Heuristic valence/epic are not emotion intensities.',
  predictions: null,
});

/**
 * The live heuristics a run records: name, scale and owner. Read after each
 * Simulation.step, so they are the values playback shows. Scales are the
 * code's own; none is a 0-4 listener rating.
 */
export const HEURISTIC_CHANNELS = Object.freeze([
  { name: 'calm.level', owner: 'CalmDirector', scale: '0..1', read: (s) => s.calm?.level },
  { name: 'hype.fast', owner: 'HypeDirector', scale: '0..1', read: (s) => s.hype?.fast },
  { name: 'hype.slow', owner: 'HypeDirector', scale: '0..1', read: (s) => s.hype?.slow },
  { name: 'hype.surge', owner: 'HypeDirector', scale: '0..1', read: (s) => s.hype?.surge },
  { name: 'hype.buildUp', owner: 'HypeDirector', scale: '0..1', read: (s) => s.hype?.buildUp },
  { name: 'hype.dropCount', owner: 'HypeDirector', scale: 'count', read: (s) => s.hype?.dropCount },
  { name: 'vibe.valence', owner: 'VibeDirector', scale: '-1..1 heuristic (third balance + brightness)', read: (s) => s.vibe?.valence },
  { name: 'vibe.epic', owner: 'VibeDirector', scale: '0..1 heuristic', read: (s) => s.vibe?.epic },
  { name: 'vibe.tonic', owner: 'VibeDirector', scale: 'pitch class 0..11, meaningful only with confidence', read: (s) => s.vibe?.tonic },
  { name: 'vibe.tonicConfidence', owner: 'VibeDirector', scale: '0..1', read: (s) => s.vibe?.tonicConfidence },
  { name: 'key.paletteRotation', owner: 'KeyDirector', scale: 'degrees', read: (s) => s.keyDirector?.paletteRotation },
  { name: 'weather.kind', owner: 'WeatherDirector', scale: 'category', read: (s) => s.weather?.kind },
  { name: 'weather.intensity', owner: 'WeatherDirector', scale: '0..1', read: (s) => s.weather?.intensity },
  { name: 'opening.gain', owner: 'OpeningDirector', scale: '0..1', read: (s) => s.opening?.gain },
  { name: 'opening.holding', owner: 'OpeningDirector', scale: 'boolean', read: (s) => s.opening?.holding },
  { name: 'coda.unravel', owner: 'CodaDirector', scale: '0..1', read: (s) => s.coda?.unravel },
]);

function scalar(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  return null;
}

/**
 * Step a freshly built Simulation from the song's start to `durationMs` on a
 * fixed `stepMs` (sequential, from its construction state, never isolated
 * timestamps on reused state) and sample every channel each `sampleEveryMs`
 * of heard time. `maybeYield` lets a browser page breathe between steps.
 */
export async function sampleHeuristics(sim, {
  durationMs, stepMs = DEFAULT_STEP_MS, sampleEveryMs = DEFAULT_SAMPLE_MS,
  channels = HEURISTIC_CHANNELS, maybeYield = null, signal = null,
} = {}) {
  if (!sim || !(durationMs > 0)) throw new Error('sampleHeuristics needs a simulation and a positive duration');
  if (!(stepMs > 0) || !(sampleEveryMs > 0)) throw new Error('stepMs and sampleEveryMs must be positive');
  const out = { clock: 'heard', stepMs, sampleEveryMs, steps: 0, tMs: [], channels: {} };
  for (const c of channels) out.channels[c.name] = [];
  let next = 0;
  let t = 0;
  while (t < durationMs - 1e-6) {
    if (signal?.aborted) throw new Error('sampling aborted');
    const to = Math.min(durationMs, t + stepMs);
    sim.step(to - t, to);
    t = to;
    out.steps++;
    const heard = Number.isFinite(sim.heardTimeMs) ? sim.heardTimeMs : t;
    // One sample per grid point, at the first step that reaches it.
    if (heard >= next - 1e-6) {
      out.tMs.push(heard);
      for (const c of channels) out.channels[c.name].push(scalar(c.read(sim)));
      while (next <= heard + 1e-6) next += sampleEveryMs;
    }
    if (maybeYield) await maybeYield();
  }
  out.latencyMs = Number.isFinite(sim.visualLagMs) ? sim.visualLagMs : 0;
  return out;
}

function plainNumbers(arr) {
  return Array.from(arr || [], (v) => (Number.isFinite(v) ? v : null));
}

/**
 * Measured evidence from a full analysis result (AudioAdapter.audioToTimeline
 * with `diagnostics: true`). Values are the analyzer's own, unquantized;
 * energy is resampled on the run's grid by EnergyCurves' own interpolation.
 */
export function acousticEvidence(data, { sampleEveryMs = DEFAULT_SAMPLE_MS } = {}) {
  const durationMs = data?.durationMs;
  if (!(durationMs > 0)) throw new Error('acousticEvidence needs analysed data with a duration');
  const curves = data.energyCurves || null;
  const energy = { source: 'EnergyCurves (whole-song relative band level)', sampleEveryMs, bandNames: [...BAND_NAMES], tMs: [], bands: BAND_NAMES.map(() => []), globalNorm: [] };
  if (curves) {
    for (let t = 0; t <= durationMs + 1e-6; t += sampleEveryMs) {
      energy.tMs.push(t);
      const all = curves.sampleAll(t);
      all.forEach((v, b) => energy.bands[b].push(Number.isFinite(v) ? v : null));
      const g = curves.globalEnergyNorm(t);
      energy.globalNorm.push(Number.isFinite(g) ? g : null);
    }
  } else {
    energy.missing = true;
  }

  const diag = data.diagnostics || null;
  const spectral = diag
    ? { source: 'PitchTracker frames (log-frequency centroid; summed spectral peaks)', featureRateHz: diag.featureRateHz,
      brightness: plainNumbers(diag.brightness), peakEnergy: plainNumbers(diag.peakEnergy) }
    : { missing: true, reason: 'analysis ran without diagnostics' };

  const timeline = Array.isArray(data.timeline) ? data.timeline : [];
  const onsets = {};
  const provenance = { notes: 0, authoredPitch: 0, inferredPitch: 0, noPitch: 0, bySrc: {} };
  for (const e of timeline) {
    const role = e.role || 'UNKNOWN';
    (onsets[role] ||= []).push(e.tMs);
    provenance.notes++;
    provenance.bySrc[e.src || 'unknown'] = (provenance.bySrc[e.src || 'unknown'] || 0) + 1;
    if (!Number.isFinite(e.pitch)) provenance.noPitch++;
    else if (isAuthoredPitch(e)) provenance.authoredPitch++;
    else provenance.inferredPitch++;
  }

  const a = data.analysis || {};
  const profile = data.songProfile ? { ...data.songProfile } : null;
  if (profile?.events) profile.events = { ...profile.events, onsets: undefined, onsetsOmitted: 'raw onsets are in evidence.onsets (the profile caps them at 1500)' };

  return {
    energy,
    spectral,
    tonality: {
      source: 'AudioAdapter key timeline (Krumhansl over spectral chroma)',
      global: { tonic: a.tonic ?? null, mode: a.mode ?? null, majorness: a.majorness ?? null, confidence: a.tonalConfidence ?? null, chroma: plainNumbers(a.chroma) },
      timeline: (data.tonalityTimeline || []).map((k) => ({ tMs: k.tMs, tonic: k.tonic, mode: k.mode ?? null, majorness: k.majorness ?? null, confidence: k.confidence ?? null })),
    },
    tempo: {
      bpm: data.bpm ?? null, beatPeriodMs: data.beatPeriodMs ?? null, confidence: data.confidence ?? null,
      freeTime: !!data.freeTime, firstBarMs: data.firstBarMs ?? null, bars: (data.barGrid || []).length,
      localTempo: (data.localTempo || []).map((w) => ({ tMs: w.tMs, beatPeriodMs: w.beatPeriodMs, confidence: w.confidence ?? null })),
    },
    structure: data.structure ? {
      boundariesMs: plainNumbers(data.structure.boundariesMs), labels: Array.from(data.structure.labels || []),
      confidence: data.structure.confidence ?? null, boundaryStrengths: plainNumbers(data.structure.boundaryStrengths),
    } : null,
    texture: { meanBrightness: a.brightness ?? null, dynamicRange: a.dynamicRange ?? null, stereoWidth: a.stereoWidth ?? null, rhythm: a.rhythm ?? null },
    onsets,
    pitchProvenance: provenance,
    profile,
  };
}

/** Coverage as measured, independent of any advertised duration. */
export function measureCoverage(data, decodedDurationMs, heuristics = null) {
  const opening = data?.opening || null;
  // A provisional opening advertises the whole song's durationMs while
  // having analysed only its start (OpeningAnalysis.asOpening), so the
  // analysed interval comes from what was analysed, not the duration field.
  const analyzedToMs = opening ? (opening.analyzedMs ?? null) : data?.durationMs;
  return {
    decodedDurationMs,
    analyzedFromMs: 0,
    analyzedToMs: Number.isFinite(analyzedToMs) ? analyzedToMs : null,
    provisional: !!opening,
    advertisedDurationMs: Number.isFinite(data?.durationMs) ? data.durationMs : null,
    heuristicsToMs: heuristics?.tMs?.length ? heuristics.tMs[heuristics.tMs.length - 1] : null,
  };
}

/** Assemble a run. Hashes and identities are supplied by the caller. */
export function buildRun({
  createdAt, runId = null, recording, coverage, source, config, environment, evidence, heuristics,
  semantic = SEMANTIC_UNSUPPORTED, caseId = null,
}) {
  return {
    format: RUN_FORMAT,
    runId,
    createdAt,
    caseId,
    versions: { runFormat: RUN_FORMAT, featureExport: FEATURE_EXPORT_VERSION, bundle: BUNDLE_VERSION, profile: PROFILE_VERSION },
    recording,
    coverage,
    source,
    config,
    environment,
    evidence,
    heuristics: heuristics ? {
      ...heuristics,
      definitions: HEURISTIC_CHANNELS.map(({ name, owner, scale }) => ({ name, owner, scale })),
    } : null,
    semantic,
  };
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;

/**
 * Bookkeeping checks that must pass before a run is compared with any human
 * label. `audioSha256` / `expectedCommit` bind it to the recording and source
 * the caller means.
 */
export function validateRun(run, { audioSha256 = null, expectedCommit = null } = {}) {
  const errors = [];
  if (!run || typeof run !== 'object') return { valid: false, errors: ['not a run'] };
  if (run.format !== RUN_FORMAT) errors.push(`format ${run.format} is not ${RUN_FORMAT}`);
  if (run.versions?.featureExport !== FEATURE_EXPORT_VERSION) errors.push(`feature export version ${run.versions?.featureExport} is not ${FEATURE_EXPORT_VERSION}`);

  const rec = run.recording || {};
  if (!HEX64.test(rec.sha256 || '')) errors.push('recording.sha256 missing: the run is not bound to a file');
  if (!(rec.decoded?.durationMs > 0)) errors.push('recording.decoded.durationMs missing');
  if (typeof rec.fileName === 'string' && /[\\/]/.test(rec.fileName)) errors.push('recording.fileName must be a base name, not a path');
  if (audioSha256 && rec.sha256 && rec.sha256 !== audioSha256) errors.push('recording hash does not match the audio supplied: stale or mismatched input');

  const src = run.source || {};
  if (!HEX40.test(src.commit || '')) errors.push('source.commit missing');
  if (expectedCommit && src.commit && src.commit !== expectedCommit) errors.push(`run is from ${src.commit}, not ${expectedCommit}: stale analysis revision`);
  if (!src.servedModules || !Object.keys(src.servedModules).length) errors.push('source.servedModules missing: which analyzer code ran is unknown');
  if (!HEX64.test(run.config?.hash || '')) errors.push('config.hash missing');
  if (!run.environment?.browser) errors.push('environment.browser missing');

  const cov = run.coverage || {};
  const decoded = rec.decoded?.durationMs;
  if (cov.provisional) errors.push('provisional-only coverage: an opening analysis is not the whole recording');
  if (cov.analyzedFromMs !== 0) errors.push('analysis does not start at the recording start');
  if (!(cov.analyzedToMs > 0)) errors.push('analysed interval missing');
  else if (decoded > 0 && cov.analyzedToMs < decoded - COVERAGE_TOLERANCE_MS) {
    errors.push(`analysis covers ${Math.round(cov.analyzedToMs)} of ${Math.round(decoded)} ms`);
  }

  const h = run.heuristics;
  if (!h || !Array.isArray(h.tMs) || !h.tMs.length) errors.push('heuristics missing');
  else {
    if (h.clock !== 'heard') errors.push('heuristics must be sampled on heard time');
    for (const [name, values] of Object.entries(h.channels || {})) {
      if (!Array.isArray(values) || values.length !== h.tMs.length) errors.push(`heuristic ${name} has ${values?.length} samples for ${h.tMs.length} times`);
    }
    for (let i = 1; i < h.tMs.length; i++) {
      if (!(h.tMs[i] > h.tMs[i - 1])) { errors.push('heuristic sample times are not increasing'); break; }
    }
    const last = h.tMs[h.tMs.length - 1];
    if (decoded > 0 && last < decoded - h.sampleEveryMs - COVERAGE_TOLERANCE_MS) {
      errors.push(`heuristics stop at ${Math.round(last)} of ${Math.round(decoded)} ms`);
    }
  }

  const ev = run.evidence || {};
  if (!ev.energy || ev.energy.missing) errors.push('evidence.energy missing');
  if (!ev.tonality) errors.push('evidence.tonality missing');
  if (!ev.tempo) errors.push('evidence.tempo missing');
  if (!ev.pitchProvenance) errors.push('evidence.pitchProvenance missing: inferred and authored pitch cannot be told apart');

  const sem = run.semantic;
  if (!sem) errors.push('semantic capability missing: say unsupported rather than omit it');
  else if (sem.status === 'unsupported') {
    if (sem.predictions != null) errors.push('an unsupported semantic layer cannot carry predictions');
  } else if (sem.status === 'supported') {
    if (!sem.predictor?.version || !sem.calibration?.version) errors.push('semantic predictions need a predictor and calibration version');
  } else errors.push(`semantic status ${sem.status} is not supported/unsupported`);

  return { valid: errors.length === 0, errors };
}

/** JSON for run.json: typed arrays as plain arrays, non-finite numbers as null. */
export function serializeRun(run) {
  return `${JSON.stringify(run, (key, value) => {
    if (ArrayBuffer.isView(value)) return Array.from(value, (v) => (Number.isFinite(v) ? v : null));
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
  }, 2)}\n`;
}
