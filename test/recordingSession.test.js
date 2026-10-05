// The recording lifecycle in main.js around a real SongRecorder: what the
// player is told when the browser's encoder fails, what the saved file is
// named after, and how a retry in another container starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { SongRecorder } from '../src/render/SongRecorder.js';
import { exportFileName } from '../src/render/VideoExport.js';
import { SourceSelection } from '../src/audio/SourceSelection.js';
import { analysisReadiness, READINESS_MESSAGES } from '../src/audio/AnalysisReadiness.js';
import { mainFunctions } from './helpers/mainSource.js';

const H264 = 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"';
const WEBM = 'video/webm;codecs="vp9,opus"';

function chunk() {
  const bytes = new Uint8Array(512);
  for (let i = 0; i < 4; i++) bytes[40 + i] = 'avc1'.charCodeAt(i);
  return new Blob([bytes]);
}

/** A MediaRecorder world: types supported, recorders created, and controls
 *  to fail one or to hold its stop until the test releases it. */
function browser({ supported = [H264, WEBM] } = {}) {
  const recorders = [];
  class FakeMediaRecorder {
    static isTypeSupported(type) { return supported.includes(type); }
    constructor(stream, options) { this.stream = stream; this.options = options; this.state = 'inactive'; recorders.push(this); }
    start() { this.state = 'recording'; this.ondataavailable?.({ data: chunk() }); }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      const finish = () => { this.ondataavailable?.({ data: chunk() }); this.onstop?.(); };
      if (this.holdStop) this.release = finish; else finish();
    }
    fail(message, name = 'EncodingError') {
      this.onerror?.({ error: Object.assign(new Error(message), { name }) });
      if (this.state !== 'inactive') { this.state = 'inactive'; this.onstop?.(); }
    }
  }
  const canvas = () => ({
    width: 0, height: 0,
    getContext: () => ({ fillRect() {}, drawImage() {}, set fillStyle(_) {}, imageSmoothingEnabled: true }),
    captureStream: () => {
      const track = { stop() { track.stopped = true; }, requestFrame() {} };
      return { getVideoTracks: () => [track], getAudioTracks: () => [], addTrack() {} };
    },
  });
  const scope = { MediaRecorder: FakeMediaRecorder, performance: { now: () => 0 }, document: { createElement: canvas } };
  return { scope, recorders };
}

const flush = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function harness(opts) {
  const { scope, recorders } = browser(opts);
  const classes = () => {
    const set = new Set(['hidden']);
    return { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
  };
  const owner = new SourceSelection();
  owner.begin({ kind: 'file', name: 'First Song.wav' });
  const notes = [], banners = [], downloads = [], releases = [], replays = [];
  const context = vm.createContext({
    console: { error() {}, warn() {}, info() {} },
    SongRecorder, exportFileName, analysisReadiness, READINESS_MESSAGES,
    describeResult: () => 'MP4 · H.264', formatSeed: String,
    sourceSelection: owner,
    lastSongName: 'First Song.wav',
    lastTimelineData: { durationMs: 20000 },
    fullAnalysisPending: null,
    lastSongLoad: null,
    lastSongSeed: 3,
    lastAudioBuffer: null,
    muteTimelineSynth: false,
    sim: { heardTimeMs: 1234 },
    songRecorder: null,
    pendingCapturePresetId: null, pendingCaptureSession: null,
    activeRecordingSession: null, lastRecordingFailure: null,
    pendingExportPresetId: null, pendingExportCandidate: null,
    recordReadoutAtMs: 0,
    captureClock: { captureReady: true, release: (ms) => releases.push(ms), arm() {} },
    audioEngine: { nowMs: 500, ctx: {}, master: null, playBuffer() {} },
    canvas: {},
    storedExportPresetId: () => '1080p',
    ensureRecorder: () => {
      if (!context.songRecorder) {
        context.songRecorder = new SongRecorder({ stage: { width: 1920, height: 1080 }, scope, onAutoStop: () => context.finishRecording() });
      }
      return context.songRecorder;
    },
    syncRecordUI() {},
    setExportNote: (text, cls = '') => notes.push([text, cls]),
    showErrorBanner: (m) => banners.push(m),
    downloadBlob: (blob, name) => downloads.push(name),
    exportBtnEl: { disabled: false },
    exportRetryAnalysisBtnEl: { classList: classes() },
    exportRetryCodecBtnEl: { classList: classes(), textContent: '' },
    readPinnedSeed: () => null,
    startTimeline: (data, extra) => replays.push(extra),
    setSeedInput() {}, completeSeedEl: null,
  });
  vm.runInContext(mainFunctions([
    'recordingSessionFor', 'beginRecorder', 'startRecording', 'finishRecording',
    'reportRecordingFailure', 'showRecordingFailure', 'retryRecordingInFallback',
    'replaySong', 'songStillCurrent', 'showExportReadiness', 'requestFullSongExport',
  ]), context);
  const retryVisible = () => !context.exportRetryCodecBtnEl.classList.contains('hidden');
  return { context, recorders, notes, banners, downloads, releases, replays, owner, retryVisible };
}

test('an encoder error after a successful start reaches the player and saves nothing', async () => {
  const h = harness();
  await h.context.requestFullSongExport('1080p');
  assert.equal(h.context.songRecorder.recording, true);
  h.recorders[0].fail('Failed to initialize the Media Foundation H.264 encoder');
  await flush();
  assert.deepEqual(h.downloads, [], 'no success save');
  assert.equal(h.releases.length, 1, 'the capture clock is released');
  assert.equal(h.context.songRecorder.recording, false);
  assert.equal(h.context.songRecorder.finalizing, false);
  assert.match(h.banners.at(-1), /Media Foundation H\.264 encoder/);
  assert.match(h.banners.at(-1), /EncodingError/);
  assert.match(h.banners.at(-1), /video\/mp4/);
  const [note, cls] = h.notes.at(-1);
  assert.equal(cls, 'isWarning');
  assert.doesNotMatch(note, /too short/, 'a codec failure is not "too short"');
  assert.match(note, /WEBM/);
  assert.equal(h.retryVisible(), true);
});

test('with no other container to offer, the failure is reported without a retry', async () => {
  const h = harness({ supported: [H264] });
  await h.context.requestFullSongExport('1080p');
  h.recorders[0].fail('encoder gone');
  await flush();
  assert.match(h.banners.at(-1), /encoder gone/);
  assert.equal(h.retryVisible(), false);
});

test('the WebM retry is a fresh full-song attempt from frame zero, named as WebM', async () => {
  const h = harness();
  await h.context.requestFullSongExport('car');
  h.recorders[0].fail('mp4 encoder failed');
  await flush();
  h.context.retryRecordingInFallback();
  await flush();
  assert.equal(h.replays.length, 2, 'the song is replayed again');
  assert.equal(h.replays[1].captureMode, true);
  assert.equal(h.recorders.length, 2, 'a new recorder, not the failed one resumed');
  assert.equal(h.recorders[1].options.mimeType.startsWith('video/webm'), true);
  assert.match(h.notes.find(([t]) => /Recording as WEBM/.test(t))[0], /WEBM/);
  // It finishes and is saved under the song's name with its real extension.
  h.context.finishRecording();
  await flush();
  assert.equal(h.downloads.length, 1);
  assert.match(h.downloads[0], /^First Song - car - .*\.webm$/);
});

test('a retry for a recording that has since been replaced is refused', async () => {
  const h = harness();
  await h.context.requestFullSongExport('1080p');
  h.recorders[0].fail('mp4 encoder failed');
  await flush();
  h.owner.begin({ kind: 'sample', name: 'Proof' });
  h.context.retryRecordingInFallback();
  assert.equal(h.replays.length, 1);
  assert.match(h.notes.at(-1)[0], /replaced/);
});

test('the file is named after the song recorded, even if another loads before it saves', async () => {
  const h = harness();
  h.context.startRecording('1080p');
  h.recorders[0].holdStop = true;
  h.context.finishRecording(); // e.g. a new drop tears the song down
  h.context.lastSongName = 'Second Song.wav';
  h.owner.begin({ kind: 'file', name: 'Second Song.wav' });
  h.recorders[0].release();
  await flush();
  assert.equal(h.downloads.length, 1);
  assert.match(h.downloads[0], /^First Song - 1080p - /);
});

test('duplicate stop requests complete the recording exactly once', async () => {
  const h = harness();
  h.context.startRecording('1080p');
  h.recorders[0].holdStop = true;
  h.context.finishRecording();
  h.context.finishRecording(); // song end and the record button together
  h.recorders[0].release();
  h.recorders[0].onstop?.();
  await flush();
  assert.equal(h.downloads.length, 1);
});

test('an intentional short stop is still "too short", not a failure', async () => {
  const h = harness();
  h.context.startRecording('1080p');
  // Nothing captured: drop the chunk the fake emits.
  const r = h.recorders[0];
  r.ondataavailable = null;
  r.stop = function stop() { this.state = 'inactive'; this.onstop?.(); };
  h.context.songRecorder._chunks = [];
  h.context.finishRecording();
  await flush();
  assert.deepEqual(h.downloads, []);
  assert.deepEqual(h.banners, []);
  assert.match(h.notes.at(-1)[0], /too short/);
});

test('the failure shown on the complete screen is only for the song it happened to', async () => {
  const h = harness();
  await h.context.requestFullSongExport('1080p');
  h.recorders[0].fail('mp4 encoder failed');
  await flush();
  assert.equal(h.context.showRecordingFailure(), true);
  h.owner.begin({ kind: 'file', name: 'Another.wav' });
  assert.equal(h.context.showRecordingFailure(), false);
  assert.equal(h.retryVisible(), false);
});
