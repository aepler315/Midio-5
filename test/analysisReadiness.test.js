import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { analysisReadiness, isExportReady, READINESS_MESSAGES } from '../src/audio/AnalysisReadiness.js';
import { SourceSelection } from '../src/audio/SourceSelection.js';
import { evenExportSize } from '../src/render/BulkExport.js';
import { mainFunctions } from './helpers/mainSource.js';

const opening = (extra = {}) => ({
  durationMs: 240000,
  opening: { analyzedMs: 15000, provisional: true, informative: true, evidenceScope: 'opening', ...extra },
});

// --- The decision -------------------------------------------------------------

test('a whole-song analysis is ready', () => {
  assert.deepEqual(analysisReadiness({ durationMs: 240000 }), { state: 'ready', reason: '' });
  assert.equal(isExportReady({ durationMs: 240000 }), true);
});

test('an opening with the whole-song pass running is pending', () => {
  const r = analysisReadiness(opening(), Promise.resolve());
  assert.equal(r.state, 'pending');
  assert.equal(r.reason, READINESS_MESSAGES.pending);
});

test('the audit case: opening only, whole-song pass failed, nothing pending', () => {
  const r = analysisReadiness(opening({ failed: true, failure: 'worker crashed' }), null);
  assert.equal(r.state, 'failed');
  assert.match(r.reason, /failed/);
  assert.match(r.reason, /worker crashed/);
  assert.equal(isExportReady(opening({ failed: true }), null), false);
});

test('a failure outranks a stale promise that is still referenced', () => {
  assert.equal(analysisReadiness(opening({ failed: true }), Promise.resolve()).state, 'failed');
});

test('an opening with nothing running behind it is only provisional', () => {
  assert.equal(analysisReadiness(opening(), null).state, 'provisional');
});

test('an advertised duration is not coverage: only analysedMs counts', () => {
  // The opening is stretched to the song's length, so durationMs alone says
  // nothing about what was heard.
  assert.equal(analysisReadiness({ durationMs: 15000, opening: { analyzedMs: 15000 } }).state, 'ready');
  assert.equal(analysisReadiness({ durationMs: 15030, opening: { analyzedMs: 15000 } }).state, 'ready');
  assert.equal(analysisReadiness({ durationMs: 16000, opening: { analyzedMs: 15000 } }).state, 'provisional');
  assert.equal(analysisReadiness({ durationMs: NaN, opening: { analyzedMs: 15000 } }).state, 'provisional');
});

test('no song is never ready', () => {
  assert.equal(analysisReadiness(null).state, 'failed');
  assert.equal(analysisReadiness(undefined, Promise.resolve()).state, 'failed');
});

test('the decision never needs a promise stored on the data', () => {
  const data = opening();
  analysisReadiness(data, Promise.resolve());
  assert.equal(JSON.stringify(data).includes('then'), false);
  assert.deepEqual(Object.keys(data.opening).sort(), ['analyzedMs', 'evidenceScope', 'informative', 'provisional']);
});

// --- The real export orchestration from main.js -------------------------------

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function harness(data) {
  const classes = () => {
    const set = new Set(['hidden']);
    return { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
  };
  const notes = [], recordings = [], replays = [], errors = [];
  const owner = new SourceSelection();
  const selection = owner.begin({ kind: 'file', name: 'song.wav' });
  const context = vm.createContext({
    analysisReadiness, READINESS_MESSAGES, evenExportSize, console,
    sourceSelection: owner,
    lastTimelineData: data,
    fullAnalysisPending: null,
    lastSongLoad: { selection, data, retryWholeSong: () => Promise.resolve(null) },
    pendingExportPresetId: null,
    lastSongSeed: 7,
    lastAudioBuffer: null,
    muteTimelineSynth: false,
    exportBtnEl: { disabled: false },
    exportRetryAnalysisBtnEl: { classList: classes() },
    progressEl: { classList: classes() },
    setExportNote: (text, cls = '') => notes.push([text, cls]),
    showErrorBanner: (m) => errors.push(m),
    showProgress() {},
    syncRecordUI() {},
    readPinnedSeed: () => null,
    startTimeline: (d, extra) => replays.push({ data: d, extra }),
    startRecording: (presetId) => { recordings.push(presetId); return true; },
    audioEngine: { playBuffer() {} },
    sim: null, completeSeedEl: null, setSeedInput() {}, formatSeed: String,
    bulkExportArmed: false, canvas: { width: 0, height: 0 }, conductor: null,
    perfGovernor: null, perfStartLevel: 0, lastFitDiagnostic: null,
    effectivePresentation: () => ({}), resolvePresentation: (x) => x, resolveDisplayPrefs: (x) => x,
    window: {},
  });
  vm.runInContext(mainFunctions([
    'replaySong', 'songStillCurrent', 'showExportReadiness', 'requestFullSongExport',
    'retryWholeSongAnalysis', 'beginBulkExport',
  ]), context);
  const retryVisible = () => !context.exportRetryAnalysisBtnEl.classList.contains('hidden');
  return { context, notes, recordings, replays, errors, owner, selection, retryVisible };
}

test('export over a failed whole-song pass never arms the recorder and offers a retry', async () => {
  const h = harness(opening({ failed: true }));
  await h.context.requestFullSongExport('1080p');
  assert.deepEqual(h.recordings, []);
  assert.deepEqual(h.replays, [], 'the song is not even replayed');
  assert.equal(h.context.pendingExportPresetId, null);
  assert.match(h.notes.at(-1)[0], /failed/);
  assert.equal(h.notes.at(-1)[1], 'isWarning');
  assert.equal(h.notes.some(([t]) => /Recording…/.test(t)), false, 'never labelled as recording');
  assert.equal(h.retryVisible(), true);
});

test('export over an opening with nothing pending is refused too', async () => {
  const h = harness(opening());
  await h.context.requestFullSongExport('1080p');
  assert.deepEqual(h.recordings, []);
  assert.equal(h.retryVisible(), true);
});

test('an already-final analysis records from frame zero with the same seed', async () => {
  const data = { durationMs: 240000 };
  const h = harness(data);
  await h.context.requestFullSongExport('1080p');
  assert.deepEqual(h.recordings, ['1080p']);
  assert.equal(h.replays.length, 1);
  assert.equal(h.replays[0].data, data);
  assert.equal(h.replays[0].extra.songSeed, 7);
  assert.equal(h.replays[0].extra.captureMode, true);
  assert.equal(h.replays[0].data.opening, undefined, 'final data reaches the first frame');
});

test('a pending pass that succeeds is waited for, then recorded on final data', async () => {
  const data = opening();
  const h = harness(data);
  const pass = deferred();
  h.context.fullAnalysisPending = pass.promise;
  const exporting = h.context.requestFullSongExport('1080p');
  await flush();
  assert.deepEqual(h.recordings, []);
  assert.equal(h.context.exportBtnEl.disabled, true);
  // adoptFullAnalysis: the opening's metadata goes, the pending slot clears.
  delete data.opening;
  h.context.fullAnalysisPending = null;
  pass.resolve(data);
  await exporting;
  assert.deepEqual(h.recordings, ['1080p']);
  assert.equal(h.replays[0].data.opening, undefined);
});

test('a pending pass that fails stops with the failure instead of recording the opening', async () => {
  const data = opening();
  const h = harness(data);
  const pass = deferred();
  h.context.fullAnalysisPending = pass.promise;
  const exporting = h.context.requestFullSongExport('1080p');
  await flush();
  data.opening.failed = true;
  h.context.fullAnalysisPending = null;
  pass.resolve(null); // the load path's catch resolves null after marking failure
  await exporting;
  assert.deepEqual(h.recordings, []);
  assert.deepEqual(h.replays, []);
  assert.equal(h.retryVisible(), true);
});

test('a recording replaced during the wait is never exported', async () => {
  const data = opening();
  const h = harness(data);
  const pass = deferred();
  h.context.fullAnalysisPending = pass.promise;
  const exporting = h.context.requestFullSongExport('1080p');
  await flush();
  h.owner.begin({ kind: 'file', name: 'other.wav' });
  h.context.lastTimelineData = { durationMs: 1000 };
  delete data.opening;
  pass.resolve(data);
  await exporting;
  assert.deepEqual(h.recordings, []);
  assert.deepEqual(h.replays, []);
});

test('the same selection replaced but the data still on screen is not exported either', async () => {
  const data = opening();
  const h = harness(data);
  const pass = deferred();
  h.context.fullAnalysisPending = pass.promise;
  const exporting = h.context.requestFullSongExport('1080p');
  await flush();
  h.owner.cancel(); // back to the title
  delete data.opening;
  pass.resolve(data);
  await exporting;
  assert.deepEqual(h.recordings, []);
});

test('replaySong refuses to arm a full-song export whatever path reaches it', () => {
  const h = harness(opening({ failed: true }));
  h.context.pendingExportPresetId = '1080p';
  h.context.replaySong({ songSeed: 7 });
  assert.deepEqual(h.recordings, []);
  assert.deepEqual(h.replays, []);
  assert.equal(h.context.pendingExportPresetId, null);
});

test('plain replays are unaffected by an opening-only analysis', () => {
  const h = harness(opening({ failed: true }));
  h.context.replaySong({ songSeed: 7 });
  assert.equal(h.replays.length, 1);
  assert.deepEqual(h.recordings, []);
});

test('retry analyses the current recording and reports when it is ready', async () => {
  const data = opening({ failed: true });
  const h = harness(data);
  let retried = 0;
  h.context.lastSongLoad.retryWholeSong = async () => { retried++; delete data.opening; return data; };
  h.context.retryWholeSongAnalysis();
  await flush();
  assert.equal(retried, 1);
  assert.equal(h.retryVisible(), false);
  assert.match(h.notes.at(-1)[0], /whole song is analysed/);
  await h.context.requestFullSongExport('1080p');
  assert.deepEqual(h.recordings, ['1080p']);
});

test('a retry that fails again says so and keeps the retry offered', async () => {
  const data = opening({ failed: true });
  const h = harness(data);
  h.context.lastSongLoad.retryWholeSong = async () => null;
  h.context.retryWholeSongAnalysis();
  await flush();
  assert.match(h.notes.at(-1)[0], /failed/);
  assert.equal(h.retryVisible(), true);
});

test('retry cannot revive a replaced selection', async () => {
  const data = opening({ failed: true });
  const h = harness(data);
  let retried = 0;
  h.context.lastSongLoad.retryWholeSong = async () => { retried++; return data; };
  h.owner.begin({ kind: 'sample', name: 'Proof' });
  h.context.retryWholeSongAnalysis();
  await flush();
  assert.equal(retried, 0);
  assert.match(h.notes.at(-1)[0], /replaced/);
});

test('bulk export uses the same decision and names the failure', () => {
  const failed = harness(opening({ failed: true }));
  assert.throws(() => failed.context.beginBulkExport({ width: 1920, height: 1080 }), /failed/);
  const provisional = harness(opening());
  assert.throws(() => provisional.context.beginBulkExport({ width: 1920, height: 1080 }), /Only the opening/);
  const pending = harness(opening());
  pending.context.fullAnalysisPending = Promise.resolve();
  assert.throws(() => pending.context.beginBulkExport({ width: 1920, height: 1080 }), /Still analysing/);
  for (const h of [failed, provisional, pending]) assert.deepEqual(h.replays, []);
});
