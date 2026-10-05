// Task 12: production evidence runs, corpus binding and the baseline review
// book. Bookkeeping only -- these synthetic cases validate identity,
// coverage and serialization, never musical recognition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Conductor } from '../src/core/Conductor.js';
import { ParamBus } from '../src/core/ParamBus.js';
import { Simulation } from '../src/sim/Simulation.js';
import { EnergyCurves } from '../src/audio/EnergyCurves.js';
import { Role, makeNoteEvent } from '../src/core/NoteEvent.js';
import { asOpening } from '../src/audio/OpeningAnalysis.js';
import { featureDiagnostics } from '../src/audio/AudioAdapter.js';
import {
  RUN_FORMAT, HEURISTIC_CHANNELS, SEMANTIC_UNSUPPORTED, acousticEvidence, buildRun, measureCoverage,
  sampleHeuristics, serializeRun, validateRun,
} from '../src/eval/listening/ProductionRun.js';
import { bindCorpus, freezeSplit, baselineReviewBook, summarizeReviewBook } from '../src/eval/listening/ReviewBook.js';
import { parseArgs as parseExportArgs } from '../tools/listening/export-production.mjs';
import { runChart, bookMarkdown } from '../tools/listening/review-book.mjs';

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const COMMIT = 'a'.repeat(40);

function analysed(durationMs = 20000) {
  const energyCurves = new EnergyCurves(durationMs);
  for (let i = 0; i < energyCurves.n; i++) energyCurves.setFrame(i, Array(7).fill(i * 1000 / energyCurves.rateHz < 8000 ? .1 : .8));
  const timeline = [];
  for (let t = 0; t < durationMs; t += 500) {
    timeline.push(makeNoteEvent({ tMs: t, pitch: 36, vel: .8, role: Role.RHYTHM, kick: true, src: 'audio' }));
    timeline.push(makeNoteEvent({ tMs: t + 20, pitch: 64, vel: .6, role: Role.MELODY, src: 'audio' }));
  }
  return {
    durationMs, timeline, energyCurves, barGrid: [], bpm: 120, beatPeriodMs: 500, confidence: .8, freeTime: false, firstBarMs: 0,
    localTempo: [{ tMs: 0, beatPeriodMs: 500, confidence: .8 }],
    tonalityTimeline: [{ tMs: 0, tonic: 4, mode: 'minor', majorness: -.4, confidence: .6 }],
    analysis: { tonic: 4, mode: 'minor', majorness: -.4, tonalConfidence: .6, chroma: Array(12).fill(1 / 12), brightness: .5, dynamicRange: .3, stereoWidth: .2 },
    structure: { boundariesMs: [0, 8000, 20000], labels: [0, 1], confidence: .7, boundaryStrengths: [1, .6, 1] },
    songProfile: { version: 2, events: { onsets: [1, 2, 3], eventRateHz: 4 }, sections: [] },
    diagnostics: { featureRateHz: 21.5, brightness: Float32Array.of(.2, .4, NaN), peakEnergy: Float32Array.of(1, 2, 3) },
  };
}

function simFor(data) {
  const c = new Conductor();
  c.load(data);
  const sim = new Simulation(c, new ParamBus(), { bpm: data.bpm, energyCurves: data.energyCurves, tonalityTimeline: data.tonalityTimeline,
    structure: data.structure, worldId: 'range', outputLatencyMs: () => 0, songSeed: 7 });
  sim.biomes.pumpStripPrewarm = () => {}; // canvas baking, unrelated to the music
  return sim;
}

async function validRun({ caseId = 'case-a', audio = 'audio-a', durationMs = 20000 } = {}) {
  const data = analysed(durationMs);
  const sim = simFor(data);
  const heuristics = await sampleHeuristics(sim, { durationMs, stepMs: 1000 / 60, sampleEveryMs: 250 });
  sim.dispose();
  const run = buildRun({
    createdAt: '2026-10-05T00:00:00.000Z', caseId,
    recording: { sha256: sha(audio), fileName: `${audio}.mp3`, byteLength: 1000, decoded: { sampleRate: 48000, channels: 2, frames: durationMs * 48, durationMs } },
    coverage: measureCoverage(data, durationMs, heuristics),
    source: { commit: COMMIT, dirtySrc: false, servedModules: { 'src/audio/AudioAdapter.js': sha('x') } },
    config: { stepMs: 1000 / 60, hash: sha('config') },
    environment: { browser: 'chromium test' },
    evidence: acousticEvidence(data, { sampleEveryMs: 250 }),
    heuristics,
  });
  const body = serializeRun(run);
  return JSON.parse(serializeRun({ ...run, runId: sha(body) }));
}

// --- Runs --------------------------------------------------------------------

test('a whole-recording run validates and says semantic prediction is unsupported', async () => {
  const run = await validRun();
  assert.equal(run.format, RUN_FORMAT);
  assert.deepEqual(validateRun(run, { audioSha256: sha('audio-a'), expectedCommit: COMMIT }), { valid: true, errors: [] });
  assert.equal(run.semantic.status, 'unsupported');
  assert.equal(run.semantic.predictions, null);
  assert.deepEqual(run.heuristics.definitions.map((d) => d.name), HEURISTIC_CHANNELS.map((c) => c.name));
});

test('an opening analysis is provisional-only coverage, whatever duration it advertises', async () => {
  const full = analysed(60000);
  const opening = asOpening({ ...analysed(15000) }, 60000);
  assert.equal(opening.durationMs, 60000, 'the opening advertises the whole song');
  const cov = measureCoverage(opening, 60000);
  assert.equal(cov.provisional, true);
  assert.equal(cov.analyzedToMs, 15000, 'coverage is what was analysed');
  assert.equal(cov.advertisedDurationMs, 60000);
  assert.equal(measureCoverage(full, 60000).analyzedToMs, 60000);

  const run = await validRun();
  const provisional = { ...run, coverage: { ...run.coverage, provisional: true } };
  assert.match(validateRun(provisional).errors.join('\n'), /provisional-only coverage/);
  const short = { ...run, coverage: { ...run.coverage, analyzedToMs: 15000 } };
  assert.match(validateRun(short).errors.join('\n'), /analysis covers 15000 of 20000 ms/);
  const late = { ...run, coverage: { ...run.coverage, analyzedFromMs: 2000 } };
  assert.match(validateRun(late).errors.join('\n'), /does not start at the recording start/);
});

test('a run for other bytes or another revision is refused as stale', async () => {
  const run = await validRun();
  assert.match(validateRun(run, { audioSha256: sha('audio-b') }).errors.join('\n'), /stale or mismatched input/);
  assert.match(validateRun(run, { expectedCommit: 'b'.repeat(40) }).errors.join('\n'), /stale analysis revision/);
});

test('missing provenance refuses the run', async () => {
  const run = await validRun();
  const cases = [
    [{ ...run, recording: { ...run.recording, sha256: undefined } }, /not bound to a file/],
    [{ ...run, source: { ...run.source, commit: undefined } }, /source.commit missing/],
    [{ ...run, source: { ...run.source, servedModules: {} } }, /which analyzer code ran is unknown/],
    [{ ...run, config: {} }, /config.hash missing/],
    [{ ...run, environment: {} }, /environment.browser missing/],
    [{ ...run, evidence: { ...run.evidence, pitchProvenance: undefined } }, /inferred and authored pitch/],
    [{ ...run, recording: { ...run.recording, fileName: '/home/me/music/song.mp3' } }, /base name, not a path/],
    [{ ...run, semantic: undefined }, /say unsupported rather than omit/],
    [{ ...run, semantic: { ...SEMANTIC_UNSUPPORTED, predictions: { joy: 3 } } }, /cannot carry predictions/],
    [{ ...run, semantic: { status: 'supported', predictions: {} } }, /predictor and calibration version/],
    [{ ...run, format: 'other' }, /format other/],
  ];
  for (const [bad, pattern] of cases) assert.match(validateRun(bad).errors.join('\n'), pattern);
});

test('heuristics are sampled sequentially on heard time, as playback stepped them', async () => {
  const data = analysed(12000);
  const sim = simFor(data);
  const h = await sampleHeuristics(sim, { durationMs: 12000, stepMs: 1000 / 60, sampleEveryMs: 500 });
  sim.dispose();
  assert.equal(h.clock, 'heard');
  assert.equal(h.steps, 720);
  assert.equal(h.tMs.length, 25, 'one sample per 500 ms grid point, 0 through 12000 (the first step covers 0)');
  for (let i = 1; i < h.tMs.length; i++) assert.ok(h.tMs[i] > h.tMs[i - 1]);
  // The sample at 6 s is the state of a performance played from the start,
  // not of a scene built at 6 s.
  const played = simFor(data);
  let t = 0;
  while (t < 6000 - 1e-6) { const to = Math.min(6000, t + 1000 / 60); played.step(to - t, to); t = to; }
  const i = h.tMs.findIndex((v) => Math.abs(v - 6000) < 1e-6);
  assert.ok(i >= 0);
  // Equal up to float accumulation in the step that lands on 6 s.
  for (const [name, value] of [['calm.level', played.calm.level], ['hype.slow', played.hype.slow], ['vibe.epic', played.vibe.epic]]) {
    assert.ok(Math.abs(h.channels[name][i] - value) < 1e-12, `${name}: ${h.channels[name][i]} vs ${value}`);
  }
  played.dispose();
  // Bad input is refused, not sampled.
  await assert.rejects(sampleHeuristics(null, { durationMs: 1 }));
  await assert.rejects(sampleHeuristics(simFor(data), { durationMs: 1000, stepMs: 0 }));
});

test('evidence keeps provenance, unquantized features and the raw onsets', () => {
  const data = analysed(10000);
  data.timeline.push(makeNoteEvent({ tMs: 100, pitch: 60, vel: .5, role: Role.MELODY, src: 'midi' }));
  const ev = acousticEvidence(data, { sampleEveryMs: 1000 });
  assert.deepEqual(ev.energy.tMs, [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]);
  assert.equal(ev.energy.bands.length, 7);
  assert.equal(ev.pitchProvenance.authoredPitch, 1, 'MIDI pitch is authored');
  assert.equal(ev.pitchProvenance.inferredPitch, data.timeline.length - 1, 'audio pitch is inferred');
  assert.deepEqual(ev.spectral.brightness, [Math.fround(.2), Math.fround(.4), null]);
  assert.equal(ev.onsets.RHYTHM.length, 20);
  assert.equal(ev.profile.events.onsets, undefined, 'the capped profile onsets are not mistaken for the raw ones');
  assert.equal(data.songProfile.events.onsets.length, 3, 'the analysis itself is not modified');
  const plain = acousticEvidence({ ...data, diagnostics: undefined });
  assert.equal(plain.spectral.missing, true);
  assert.throws(() => acousticEvidence({}), /duration/);
});

test('analyzer diagnostics are copies of what the pitch pass computed', () => {
  const features = { rate: 21.5, brightness: Float32Array.of(.1, .9), frames: [Float32Array.of(1, 2), Float32Array.of(3)] };
  const d = featureDiagnostics(features);
  assert.equal(d.featureRateHz, 21.5);
  assert.deepEqual(Array.from(d.peakEnergy), [3, 3]);
  d.brightness[0] = 7;
  assert.equal(features.brightness[0], Math.fround(.1));
});

test('serialization writes plain JSON and survives a round trip', async () => {
  const run = await validRun();
  const text = serializeRun({ ...run, extra: { t: Float32Array.of(1, NaN), x: Infinity } });
  const back = JSON.parse(text);
  assert.deepEqual(back.extra, { t: [1, null], x: null });
  assert.equal(validateRun(back).valid, true);
});

test('the exporter refuses incomplete arguments', () => {
  assert.throws(() => parseExportArgs([]), /--audio and --out are required/);
  assert.throws(() => parseExportArgs(['--audio', 'a', '--out', 'b', '--step-ms', '0']), /positive/);
  assert.throws(() => parseExportArgs(['--audio', 'a', '--out', 'b', '--sample-ms', '5']), /at least --step-ms/);
  assert.throws(() => parseExportArgs(['--bogus']), /unknown argument/);
  assert.equal(parseExportArgs(['--audio', 'a', '--out', 'b', '--case-id', 'x']).caseId, 'x');
});

// --- Binding, split and review book --------------------------------------------

const corpus = {
  tracks: [
    { id: 'tune-midi', split: 'tune', representation: 'midi', source: { kind: 'generator' } },
    { id: 'tune-url', split: 'tune', representation: 'audio', source: { kind: 'url', href: 'https://example.test/a.mp3' } },
    { id: 'hold-url', split: 'holdout', representation: 'audio', source: { kind: 'url', href: 'https://example.test/b.mp3' } },
    { id: 'hold-url-2', split: 'holdout', representation: 'audio', source: { kind: 'url', href: 'https://example.test/c.mp3' } },
    { id: 'hold-features', split: 'holdout', representation: 'audio', source: { kind: 'features' } },
    { id: 'hold-local', split: 'holdout', representation: 'audio', source: { kind: 'local' } },
  ],
};

test('only a valid run of the recording binds a corpus case', async () => {
  const a = await validRun({ caseId: 'tune-url', audio: 'a' });
  const b = await validRun({ caseId: 'hold-url', audio: 'b' });
  const stale = { ...(await validRun({ caseId: 'hold-url-2', audio: 'c' })) };
  stale.coverage = { ...stale.coverage, provisional: true };
  const bindings = bindCorpus(corpus, [a, b, stale]);
  const status = Object.fromEntries(bindings.tracks.map((t) => [t.id, t.status]));
  assert.deepEqual(status, { 'tune-midi': 'synthetic', 'tune-url': 'bound', 'hold-url': 'bound', 'hold-url-2': 'unbound', 'hold-features': 'unavailable', 'hold-local': 'unbound' });
  assert.match(bindings.errors.join('\n'), /hold-url-2: run .* refused: provisional-only coverage/);
  const bound = bindings.tracks.find((t) => t.id === 'hold-url');
  assert.equal(bound.recording.sha256, sha('b'));
  assert.equal(bound.recording.decodedDurationMs, 20000);
  assert.ok(!JSON.stringify(bindings).includes('/home/'), 'no absolute paths');
});

test('the same recording in both splits, or two recordings for one case, is refused', async () => {
  const a = await validRun({ caseId: 'tune-url', audio: 'same' });
  const b = await validRun({ caseId: 'hold-url', audio: 'same' });
  const leak = bindCorpus(corpus, [a, b]);
  assert.match(leak.errors.join('\n'), /same recording in both splits/);
  assert.equal(freezeSplit(leak).frozen, false);

  const two = bindCorpus(corpus, [await validRun({ caseId: 'hold-url', audio: 'x' }), await validRun({ caseId: 'hold-url', audio: 'y' })]);
  assert.equal(two.tracks.find((t) => t.id === 'hold-url').status, 'conflict');
  assert.match(two.errors.join('\n'), /runs disagree on the recording/);
  assert.match(bindCorpus(corpus, [await validRun({ caseId: 'nope' })]).errors.join('\n'), /unknown corpus case nope/);
});

test('the frozen split lists groups per side and the recordings bound to them', async () => {
  const split = freezeSplit(bindCorpus(corpus, [await validRun({ caseId: 'hold-url', audio: 'b' })]));
  assert.equal(split.frozen, true);
  assert.deepEqual(split.groups.tune, ['tune-midi', 'tune-url']);
  assert.deepEqual(split.groups.holdout, ['hold-features', 'hold-local', 'hold-url', 'hold-url-2']);
  assert.deepEqual(split.recordings, { [sha('b')]: { group: 'hold-url', split: 'holdout' } });
});

test('an unreviewed book establishes no rate; synthetic and unrated cases never count', async () => {
  const runs = [await validRun({ caseId: 'tune-url', audio: 'a' }), await validRun({ caseId: 'hold-url', audio: 'b' }),
    await validRun({ caseId: 'hold-url-2', audio: 'c' })];
  const book = baselineReviewBook(bindCorpus(corpus, runs), runs);
  assert.equal(book.summary.holdout.rate, null);
  assert.equal(book.summary.holdout.met, null);
  assert.equal(book.summary.claimed, false);
  assert.match(book.summary.note, /no acceptance rate is established/);
  assert.equal(book.summary.holdout.boundRecordings, 2);
  assert.equal(book.summary.holdout.unavailable, 2);
  assert.ok(book.cases.every((c) => Object.values(c.review).every((v) => v === null)), 'reviews start empty');
  assert.ok(book.cases.find((c) => c.id === 'hold-url').digest.durationMs === 20000);

  // A synthetic case rated perfectly does not count; one real pass, one
  // blocking defect.
  const rated = structuredClone(book);
  const set = (id, review) => Object.assign(rated.cases.find((c) => c.id === id).review, review);
  set('tune-midi', { appeal: 5, musicalTiming: 5, blockingDefect: false });
  set('hold-url', { appeal: 4, musicalTiming: 4, blockingDefect: false });
  set('hold-url-2', { appeal: 5, musicalTiming: 5, blockingDefect: true });
  const s = summarizeReviewBook(rated);
  assert.equal(s.tune.reviewed, 0, 'the synthetic review is not a musical case');
  assert.deepEqual([s.holdout.reviewed, s.holdout.passing, s.holdout.rate, s.holdout.met], [2, 1, .5, false]);
  assert.equal(s.holdout.reviewedShareOfCases, 2 / 4);
  // An incomplete review is unrated, not a failure.
  set('hold-url-2', { blockingDefect: null });
  assert.deepEqual([summarizeReviewBook(rated).holdout.reviewed, summarizeReviewBook(rated).holdout.rate], [1, 1]);
});

test('the evidence package renders a chart and a table from runs', async () => {
  const run = await validRun({ caseId: 'hold-url', audio: 'b' });
  const svg = runChart(run);
  assert.match(svg, /^<svg/);
  assert.match(svg, /exploratory, not an emotion measurement/);
  const bindings = bindCorpus(corpus, [run]);
  const md = bookMarkdown(baselineReviewBook(bindings, [run]), freezeSplit(bindings));
  assert.match(md, /\| hold-url \| holdout \| bound \|/);
  assert.match(md, /No held-out recording has a complete review/);
});
