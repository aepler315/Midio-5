// Task 14: listening annotations -- parsing, binding to a recording, label
// isolation and alignment with a production run. Fixtures are illustrative
// and validate bookkeeping only, never emotion recognition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseAnnotation, timestampMs, AnnotationError } from '../src/eval/listening/parseAnnotation.js';
import { validateCase, checkGroups, labelsFor, assertRunLabelFree } from '../src/eval/listening/validateCase.js';
import { alignRun, matchEvents, trendDirection, eventDistance } from '../src/eval/listening/alignRun.js';
import { RUN_FORMAT, FEATURE_EXPORT_VERSION, SEMANTIC_UNSUPPORTED, HEURISTIC_CHANNELS } from '../src/eval/listening/ProductionRun.js';
import { parseArgs as parseAlignArgs, alignmentMarkdown, runAlign } from '../tools/listening/align.mjs';

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const EXAMPLE = read('../docs/listening/bright-melancholy.example.song.yaml');
const TEMPLATE = read('../docs/listening/template.song.yaml');
const REVERSAL = read('./fixtures/listening/foreground-reversal.illustrative.yaml');
const AUDIO = sha('recording');

const minimal = (body = '') => `format: midio-listening/0.1
status: reviewed
audio_file: "song.flac"
listener: "listener-01"
perspective: expressed
basis: sound
summary: "Quiet joy that turns uneasy."
segments:
  - span: ["00:00", "00:30"]
    emotions:
      joy: {intensity: 2, role: foreground}
    confidence: high
trends: []
events: []
${body}`;

function refused(text, pattern) {
  assert.throws(() => parseAnnotation(text), (err) => {
    assert.ok(err instanceof AnnotationError, String(err));
    assert.match(err.issues.join('\n'), pattern);
    return true;
  });
}

// A production run of a 60 s recording whose loudness and brightness never
// change: the sound stays the same while the listener's foreground reverses.
function run({ durationMs = 60000, semantic = SEMANTIC_UNSUPPORTED, energy = () => .5, caseId = 'case-1' } = {}) {
  const tMs = [], channels = Object.fromEntries(HEURISTIC_CHANNELS.map((c) => [c.name, []]));
  for (let t = 0; t <= durationMs; t += 500) {
    tMs.push(t);
    for (const c of HEURISTIC_CHANNELS) channels[c.name].push(c.name === 'weather.kind' ? 'snow' : c.name === 'opening.holding' ? false : .4);
  }
  const eT = [], g = [];
  for (let t = 0; t <= durationMs; t += 500) { eT.push(t); g.push(energy(t)); }
  return {
    format: RUN_FORMAT, runId: sha('run'), createdAt: '2026-10-05T00:00:00Z', caseId,
    versions: { runFormat: RUN_FORMAT, featureExport: FEATURE_EXPORT_VERSION },
    recording: { sha256: AUDIO, fileName: 'song.flac', byteLength: 1, decoded: { durationMs, sampleRate: 48000, channels: 2, frames: durationMs * 48 } },
    coverage: { decodedDurationMs: durationMs, analyzedFromMs: 0, analyzedToMs: durationMs, provisional: false },
    source: { commit: 'c'.repeat(40), servedModules: { 'src/audio/AudioAdapter.js': sha('m') } },
    config: { hash: sha('cfg') }, environment: { browser: 'chromium test' },
    evidence: {
      energy: { tMs: eT, globalNorm: g, bandNames: ['SUB'], bands: [g] },
      spectral: { featureRateHz: 2, brightness: Array(durationMs / 500 + 1).fill(.8), peakEnergy: [] },
      tonality: { source: 'test', timeline: [{ tMs: 0, tonic: 2, confidence: .5 }, { tMs: 30000, tonic: 9, confidence: .7 }] },
      tempo: { bpm: 100 }, onsets: { RHYTHM: [1000, 2000, 3000], MELODY: [1500] }, pitchProvenance: { notes: 4, authoredPitch: 0, inferredPitch: 4 },
    },
    heuristics: { clock: 'heard', stepMs: 1000 / 60, sampleEveryMs: 500, tMs, channels, definitions: HEURISTIC_CHANNELS.map(({ name, scale }) => ({ name, scale })) },
    semantic,
  };
}

function manifest(extra = {}) {
  return { purpose: 'workflow', submittedAudioSha256: AUDIO, recording: { sha256: AUDIO, decodedDurationMs: 60000 }, ...extra };
}

// --- Parsing -----------------------------------------------------------------

test('the documented example and blank template parse; prose and unknowns are kept as written', () => {
  const a = parseAnnotation(EXAMPLE);
  assert.equal(a.summary, 'Bright and happy with a severe melancholy undertone that intensifies and eventually takes over.');
  assert.deepEqual(a.segments.map((s) => s.spanMs), [[0, 45000], [45000, 90000], [90000, 180000]]);
  assert.deepEqual(a.segments[0].span, ['00:00', '00:45'], 'original strings stay beside the milliseconds');
  assert.equal(a.segments[1].notes.startsWith('Both readings occupy the foreground.'), true);
  const t = parseAnnotation(TEMPLATE);
  assert.equal(t.status, 'draft');
  assert.ok(t.segments.every((s) => s.spanMs.every((v) => v === null)), 'blank times stay unknown, never zero');
});

test('simultaneous emotions keep independent intensity and role', () => {
  const a = parseAnnotation(EXAMPLE);
  // Bright-plus-melancholy coexistence: two foreground readings at once, and
  // an undertone as intense as the foreground.
  assert.deepEqual(a.segments[1].emotions, { joy: { intensity: 3, role: 'foreground' }, melancholy: { intensity: 3, role: 'foreground' } });
  assert.deepEqual(a.segments[0].emotions.melancholy, { intensity: 3, role: 'undertone' });
  const r = parseAnnotation(REVERSAL);
  assert.deepEqual(r.segments[1].emotions.joy, { intensity: null, role: 'unclear' }, 'unknown intensity is null, not 0');
  assert.equal(r.segments[1].affect.arousal, null);
  assert.equal('calm' in r.segments[1].emotions, false, 'an unrated emotion is absent from the record, not marked absent');
});

test('timestamps are mm:ss(.sss); minutes may exceed 59, seconds may not', () => {
  assert.equal(timestampMs('00:45'), 45000);
  assert.equal(timestampMs('125:07.5'), 7507500);
  assert.equal(timestampMs('01:02.034'), 62034);
  assert.equal(timestampMs(null), null);
  for (const bad of ['0:45', '00:60', '1:2', '00:45.1234', 45, '45s']) assert.equal(timestampMs(bad), undefined, String(bad));
  refused(minimal().replace('"00:30"', '"00:75"'), /not a "mm:ss"/);
});

test('unsafe or ambiguous YAML is refused before anything is read', () => {
  refused(minimal().replace('listener: "listener-01"', 'listener: "a"\nlistener: "b"'), /duplicate key/);
  refused(minimal().replace('summary: "Quiet joy that turns uneasy."', 'summary: !!js/function "x"'), /explicit tag/);
  refused(minimal().replace('summary: "Quiet joy that turns uneasy."', 'summary: !custom "x"'), /explicit tag|TAG_RESOLVE_FAILED/);
  refused(minimal().replace('summary: "Quiet joy that turns uneasy."', 'summary: !!str "x"'), /explicit tag/);
  refused(minimal().replace('emotions:\n      joy: {intensity: 2, role: foreground}', 'emotions:\n      joy: &e {intensity: 2, role: foreground}\n      calm: *e'), /anchor|alias/);
  refused(`${minimal()}\n---\nformat: other\n`, /more than one document/);
});

test('vocabulary, scales and the absence rule are enforced', () => {
  refused(minimal().replace('joy: {intensity: 2', 'bittersweet: {intensity: 2'), /not in the emotion vocabulary/);
  refused(minimal().replace('intensity: 2', 'intensity: 5'), /integer 0..4/);
  refused(minimal().replace('intensity: 2', 'intensity: 2.5'), /integer 0..4/);
  refused(minimal().replace('intensity: 2, role: foreground', 'intensity: 0, role: undertone'), /intensity 0 requires role absent/);
  refused(minimal().replace('intensity: 2, role: foreground', 'intensity: 2, role: absent'), /role absent requires intensity 0/);
  refused(minimal().replace('confidence: high', 'confidence: certain'), /confidence must be one of/);
  refused(minimal().replace('perspective: expressed', 'perspective: heard'), /perspective/);
  refused(minimal().replace('summary:', 'mood: "x"\nsummary:'), /unknown field mood/);
  refused(minimal('').replace('trends: []', 'trends:\n  - span: ["00:00", "00:10"]\n    target: emotions.joy.role\n    direction: rising\n    confidence: low'), /not a ratable field/);
  refused(minimal('').replace('events: []', 'events:\n  - within: ["00:10", "00:12"]\n    type: foreground_change\n    from: joy\n    to: joy\n    confidence: low'), /from and to must differ/);
  refused(minimal().replace('span: ["00:00", "00:30"]', 'span: [null, "00:30"]'), /reviewed annotation has concrete times/);
});

// --- Binding to a recording ---------------------------------------------------

test('segments are ordered, non-overlapping, half-open and inside the recording', () => {
  const ok = parseAnnotation(minimal().replace('segments:\n', 'segments:\n  - span: ["00:30", "01:00"]\n    confidence: low\n').replace('- span: ["00:30", "01:00"]\n    confidence: low\n  - span: ["00:00", "00:30"]', '- span: ["00:00", "00:30"]\n    confidence: low\n  - span: ["00:30", "01:00"]'));
  assert.deepEqual(validateCase(ok, manifest()).errors, [], 'touching half-open spans, the last ending at the duration');
  const overlap = parseAnnotation(minimal().replace('segments:\n', 'segments:\n  - span: ["00:10", "00:40"]\n    confidence: low\n'));
  assert.match(validateCase(overlap, manifest()).errors.join('\n'), /starts before the previous segment ends/);
  const outside = parseAnnotation(minimal().replace('"00:30"', '"01:30"'));
  assert.match(validateCase(outside, manifest()).errors.join('\n'), /outside the recording/);
  const reversed = parseAnnotation(minimal().replace('["00:00", "00:30"]', '["00:30", "00:10"]'));
  assert.match(validateCase(reversed, manifest()).errors.join('\n'), /empty or reversed/);
  const exact = parseAnnotation(minimal().replace('events: []', 'events:\n  - within: ["00:20", "00:20"]\n    type: foreground_change\n    from: joy\n    to: unease\n    confidence: medium'));
  assert.deepEqual(validateCase(exact, manifest()).errors, [], 'equal endpoints mark an exact moment');
  const late = parseAnnotation(minimal().replace('events: []', 'events:\n  - within: ["00:50", "01:10"]\n    type: foreground_change\n    from: joy\n    to: unease\n    confidence: medium'));
  assert.match(validateCase(late, manifest()).errors.join('\n'), /events\[0\].*outside the recording/);
});

test('the case binds exact bytes: hash mismatch and unaligned excerpts are refused', () => {
  const a = parseAnnotation(minimal());
  assert.match(validateCase(a, manifest({ submittedAudioSha256: sha('other') })).errors.join('\n'), /audio hash mismatch/);
  assert.match(validateCase(a, manifest({ submittedAudioSha256: null })).errors.join('\n'), /which file the listener heard/);
  assert.match(validateCase(a, manifest({ excerpt: { parentSha256: sha('parent'), offsetMs: 30000, alignment: null } })).errors.join('\n'), /unaligned excerpt/);
  assert.deepEqual(validateCase(a, manifest({ excerpt: { parentSha256: sha('parent'), offsetMs: 30000, alignment: 'verified' } })).errors, []);
  assert.match(validateCase(a, null).errors.join('\n'), /not bound to a recording/);
});

test('scored admission needs a reviewed annotation, revision, group and frozen split; illustrations never', () => {
  const reviewed = parseAnnotation(minimal());
  const scored = manifest({ purpose: 'scored', caseId: 'c1', annotationRevision: 'r1', annotationSha256: sha('text'), annotator: 'listener-01',
    recordingGroup: 'g1', split: 'development', splitRevision: 's1' });
  assert.deepEqual(validateCase(reviewed, scored), { valid: true, scored: true, errors: [], warnings: [] });
  for (const k of ['recordingGroup', 'splitRevision', 'annotationSha256', 'annotator']) {
    assert.equal(validateCase(reviewed, { ...scored, [k]: null }).scored, false, k);
  }
  assert.match(validateCase(reviewed, { ...scored, split: 'tune' }).errors.join('\n'), /split must be one of/);
  const illustration = parseAnnotation(EXAMPLE);
  assert.match(validateCase(illustration, { ...scored, recording: { sha256: AUDIO, decodedDurationMs: 180000 } }).errors.join('\n'), /illustrative annotation never enters scored evaluation/);
  assert.equal(validateCase(illustration, manifest({ recording: { sha256: AUDIO, decodedDurationMs: 180000 } })).valid, true, 'it can still exercise the workflow');
  assert.match(validateCase(parseAnnotation(TEMPLATE), { ...scored }).errors.join('\n'), /status draft/);
  const lyrics = parseAnnotation(minimal().replace('basis: sound', 'basis: sound+lyrics'));
  assert.match(validateCase(lyrics, manifest()).warnings.join('\n'), /lyric meaning/);
});

test('recording groups stay on one side of the split', () => {
  const m = (group, split, s) => ({ recordingGroup: group, split, recording: { sha256: sha(s) } });
  assert.deepEqual(checkGroups([m('g1', 'development', 'a'), m('g1', 'development', 'a-remaster'), m('g2', 'test', 'b')]), []);
  assert.match(checkGroups([m('g1', 'development', 'a'), m('g1', 'test', 'a-edit')]).join('\n'), /in both development and test/);
  assert.match(checkGroups([m('g1', 'development', 'a'), m('g2', 'development', 'a')]).join('\n'), /in groups g1 and g2/);
});

test('held-out labels cannot reach analysis, retrieval or calibration', () => {
  const annotation = parseAnnotation(minimal());
  const dev = { manifest: { split: 'development' }, annotation };
  const val = { manifest: { split: 'validation' }, annotation };
  const heldOut = { manifest: { split: 'test' }, annotation };
  for (const c of [dev, val, heldOut]) assert.throws(() => labelsFor(c, { purpose: 'analysis' }), /never enter a machine analysis/);
  assert.equal(labelsFor(dev, { purpose: 'retrieval' }), annotation);
  assert.equal(labelsFor(dev, { purpose: 'calibration' }), annotation);
  for (const c of [val, heldOut]) {
    assert.throws(() => labelsFor(c, { purpose: 'retrieval' }), /cannot reach retrieval/);
    assert.throws(() => labelsFor(c, { purpose: 'calibration' }), /cannot reach calibration/);
  }
  assert.equal(labelsFor(val, { purpose: 'selection' }), annotation);
  assert.throws(() => labelsFor(heldOut, { purpose: 'selection' }), /cannot reach selection/);
  assert.equal(labelsFor(heldOut, { purpose: 'scoring' }), annotation);
  assert.throws(() => labelsFor(dev, {}), /unknown label purpose/);
  // And a run that has seen the listener's words is refused.
  const leaked = { ...run(), notes: `analysis hint: ${annotation.summary}` };
  assert.throws(() => assertRunLabelFree(leaked, annotation), /listener's own words/);
  assert.throws(() => assertRunLabelFree({ ...run(), annotation }, annotation), /carries labels/);
  assert.doesNotThrow(() => assertRunLabelFree(run(), annotation));
});

// --- Alignment ------------------------------------------------------------------

test('a foreground reversal with stable loudness is reported, not inferred from the sound', () => {
  const a = parseAnnotation(REVERSAL);
  const report = alignRun(a, run(), { manifest: manifest() });
  assert.equal(report.annotation.summary, a.summary, 'the listener\'s words, verbatim');
  assert.equal(report.segments[0].notes, 'Both are strong; the sadness is underneath.');
  // The measured sound is identical in both spans...
  assert.equal(report.segments[0].evidence.energy.mean, report.segments[1].evidence.energy.mean);
  assert.ok(Math.abs(report.segments[0].evidence.brightness.mean - report.segments[1].evidence.brightness.mean) < 1e-12);
  // ...and nothing claims an emotion from it.
  assert.equal(report.segments[1].predictions['emotions.sadness.intensity'].status, 'unsupported');
  assert.equal(report.segments[1].predictions['emotions.sadness.role'].status, 'unsupported');
  assert.ok(report.unsupportedTargets.includes('events.foreground_change'));
  assert.deepEqual(report.events.matching, { status: 'unsupported' });
  // The uncertain transition keeps its interval width.
  assert.equal(report.events.reference[0].widthMs, 14000);
  // The loudness trend gets a proxy delta and no verdict.
  assert.equal(report.trends[0].prediction.status, 'unsupported');
  assert.equal(report.trends[0].evidenceDelta.delta, 0);
  assert.equal(report.trends[0].evidenceDelta.verdict, 'none');
  assert.equal(report.segments[0].proxies['sound.loudness'].verdict, 'none: a proxy is not a calibrated rating');
});

test('a partial annotation reports its gaps and unrated emotions stay unrated', () => {
  const report = alignRun(parseAnnotation(REVERSAL), run(), { manifest: manifest() });
  assert.equal(report.coverage.annotatedMs, 50000);
  assert.equal(report.coverage.unannotatedMs, 10000, 'the 20-30 s gap stays unannotated');
  assert.deepEqual(report.coverage.uncovered, []);
  assert.equal(report.segments[1].human.emotions.joy.intensity, null);
  assert.equal('emotions.joy.intensity' in report.segments[1].predictions, false, 'an unknown rating is not a target');
  assert.equal(report.segments[1].human.emotions.calm, undefined);
});

test('missing coverage and a different recording are visible or refused', () => {
  const a = parseAnnotation(REVERSAL);
  const short = run();
  short.recording.decoded.durationMs = 60000;
  short.coverage.analyzedToMs = 59990;
  assert.equal(alignRun(a, short).binding.checked, false, 'without a manifest the binding is reported unchecked');
  const halfway = run();
  halfway.coverage.analyzedToMs = 45000;
  assert.throws(() => alignRun(a, halfway), /run refused: analysis covers 45000 of 60000 ms/);
  assert.throws(() => alignRun(a, run(), { manifest: manifest({ recording: { sha256: sha('other'), decodedDurationMs: 60000 } }) }), /different recording/);
  const provisional = run();
  provisional.coverage.provisional = true;
  assert.throws(() => alignRun(a, provisional), /provisional-only coverage/);
});

test('targets a predictor actually produced are scored with the declared conventions', () => {
  const tMs = [], joy = [], sad = [];
  for (let t = 0; t <= 60000; t += 1000) { tMs.push(t); joy.push(t < 25000 ? 3 : 1); sad.push(t < 25000 ? 2 : 4); }
  const semantic = {
    status: 'supported', predictor: { version: 'test-1' }, calibration: { version: 'dev-1' },
    predictions: { series: { 'emotions.sadness.intensity': { tMs, values: sad }, 'emotions.playfulness.intensity': { tMs, values: joy } },
      events: [{ tMs: 33500, from: 'playfulness', to: 'sadness' }] },
  };
  const report = alignRun(parseAnnotation(REVERSAL), run({ semantic }), { manifest: manifest() });
  const p = report.segments[1].predictions['emotions.sadness.intensity'];
  assert.deepEqual([p.status, p.predicted, p.human, p.absoluteError, p.withinOne], ['scored', 4, 4, 0, true]);
  assert.equal(report.segments[0].predictions['emotions.sadness.intensity'].absoluteError, 1);
  assert.equal(report.segments[1].predictions['emotions.sadness.role'].status, 'unsupported', 'role was not predicted');
  // 1.5 s outside the listener's 18-32 s interval: within the 3 s tolerance.
  assert.deepEqual(report.events.matching.matched, [{ reference: 0, predicted: 0, errorMs: 1500 }]);
  assert.equal(report.events.matching.recall, 1);
});

test('trend and event conventions: thirds with a 0.5 change, one-to-one matching within 3 s', () => {
  const tMs = [0, 1, 2, 3, 4, 5].map((s) => s * 1000);
  assert.equal(trendDirection(tMs, [1, 1, 1.2, 1.3, 1.6, 1.6], 0, 6000).direction, 'rising');
  assert.equal(trendDirection(tMs, [2, 2, 2, 2, 2.4, 2.4], 0, 6000).direction, 'stable');
  assert.equal(trendDirection(tMs, [3, 3, 2, 2, 2, 2], 0, 6000).direction, 'falling');
  assert.equal(trendDirection(tMs, [null, null, null, null, null, null], 0, 6000), null);
  assert.equal(eventDistance(5000, [4000, 6000]), 0);
  assert.equal(eventDistance(2500, [4000, 6000]), 1500);
  const ref = [{ from: 'joy', to: 'melancholy', withinMs: [85000, 95000] }, { from: 'melancholy', to: 'joy', withinMs: [150000, 150000] }];
  const m = matchEvents(ref, [
    { tMs: 97000, from: 'joy', to: 'melancholy' },
    { tMs: 90000, from: 'joy', to: 'melancholy' },
    { tMs: 154000, from: 'melancholy', to: 'joy' },
    { tMs: 90000, from: 'melancholy', to: 'joy' },
  ]);
  assert.deepEqual(m.matched, [{ reference: 0, predicted: 1, errorMs: 0 }], 'closest same-direction prediction wins; 4 s late is outside tolerance');
  assert.deepEqual(m.misses, [1]);
  assert.deepEqual(m.extras, [0, 2, 3]);
  assert.equal(m.precision, .25);
  assert.deepEqual(m.referenceWidthsMs, [10000, 0]);
});

test('the align tool validates a case and writes the listener\'s words beside the evidence', async () => {
  assert.throws(() => parseAlignArgs([]), /--annotation is required/);
  assert.throws(() => parseAlignArgs(['--annotation', 'a', '--purpose', 'graded']), /workflow or scored/);
  const report = alignRun(parseAnnotation(REVERSAL), run(), { manifest: manifest() });
  const md = alignmentMarkdown(report);
  assert.match(md, /> Smiling through grief/);
  assert.match(md, /Listener's notes: “Both are strong; the sadness is underneath.”/);
  assert.match(md, /semantic prediction: \*\*unsupported\*\*/);
  assert.match(md, /no verdict/);
  // Without a run it only validates; the illustrative fixture is refused for scoring.
  const out = await runAlign({ annotation: new URL('./fixtures/listening/foreground-reversal.illustrative.yaml', import.meta.url).pathname, purpose: 'scored' });
  assert.equal(out.report, null);
  assert.match(out.check.errors.join('\n'), /illustrative annotation never enters scored evaluation/);
});
