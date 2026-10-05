import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SourceSelection, SOURCE_KINDS } from '../src/audio/SourceSelection.js';
import * as opening from '../src/audio/OpeningAnalysis.js';
import { fingerprintBuffer } from '../src/audio/SongFingerprint.js';
import * as cache from '../src/audio/AnalysisCache.js';
import { GrooveFingerprint } from '../src/sim/GrooveFingerprint.js';
import { ensureRidgeMusicSession, upgradeRidgeMusicSession } from '../src/world/RidgeMotionHistory.js';
import {
  AUDIO_LOAD_LIMITS, accumulateDecodedAudioBytes, accumulateDecodedByteLength, decodedAudioByteLength,
  accumulateEncodedAudioBytes, audioAbortError, validateAudioFiles, validateDecodedAudioBuffer, validateDecodedByteLength,
} from '../src/audio/loadLimits.js';

// --- The owner itself --------------------------------------------------------

test('begin returns an immutable selection and aborts the previous one', () => {
  const owner = new SourceSelection();
  const a = owner.begin({ kind: 'file', name: 'a.wav' });
  assert.equal(owner.isCurrent(a), true);
  assert.equal(Object.isFrozen(a), true);
  assert.throws(() => { 'use strict'; a.name = 'b'; });
  const b = owner.begin({ kind: 'sample', name: 'Proof' });
  assert.equal(a.signal.aborted, true);
  assert.equal(owner.isCurrent(a), false);
  assert.equal(owner.isCurrent(b), true);
  assert.notEqual(a.id, b.id);
  assert.equal(owner.current, b);
});

test('only library selections carry a library track', () => {
  const owner = new SourceSelection();
  const track = { path: 'a.wav' };
  assert.equal(owner.begin({ kind: 'library', libraryTrack: track }).libraryTrack, track);
  assert.equal(owner.begin({ kind: 'file', libraryTrack: track }).libraryTrack, null);
});

test('unknown kinds are rejected and every documented kind is accepted', () => {
  const owner = new SourceSelection();
  assert.throws(() => owner.begin({ kind: 'midi' }), TypeError);
  for (const kind of SOURCE_KINDS) assert.equal(owner.begin({ kind }).kind, kind);
});

test('cancel leaves no current selection', () => {
  const owner = new SourceSelection();
  const a = owner.begin({ kind: 'url' });
  owner.cancel();
  assert.equal(a.signal.aborted, true);
  assert.equal(owner.isCurrent(a), false);
  assert.equal(owner.current, null);
  assert.equal(owner.isCurrent(null), false);
});

// --- The real orchestrators from main.js --------------------------------------
//
// Every public way into a song is executed from the real source, with only the
// browser, network, storage and audio boundaries replaced by controllable
// deferred promises. The assertions are about what the player sees: which
// selection reaches the chooser, which errors appear, what the library is told.

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

/** Source of one top-level function from main.js, by brace matching. */
function fnSource(name) {
  const re = new RegExp(`\\n(async )?function ${name}\\(`);
  const m = re.exec(main);
  assert.ok(m, `main.js defines ${name}`);
  let i = m.index + m[0].length;
  let paren = 1;
  while (paren) { const c = main[i++]; if (c === '(') paren++; else if (c === ')') paren--; }
  while (main[i] !== '{') i++;
  let depth = 0;
  const start = m.index + 1;
  for (; i < main.length; i++) {
    if (main[i] === '{') depth++;
    else if (main[i] === '}' && --depth === 0) return main.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

const ORCHESTRATORS = [
  'claimSelection', 'loadAudioFiles', 'handleFiles', 'playLibraryTrack', 'startDemoSample',
  'cancelUrlLoad', 'beginUrlLoadOperation', 'endUrlLoadOperation', 'openUrlTarget', 'loadUrlAudio',
];

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function recording(seconds = 2) {
  const length = 8000 * seconds;
  const samples = Float32Array.from({ length }, (_, i) => Math.sin(i * 440 * Math.PI / 4000) * (0.4 + 0.1 * Math.sin(i / 100)));
  return { sampleRate: 8000, length, duration: seconds, numberOfChannels: 1, getChannelData: () => samples };
}

function harness() {
  const element = () => ({ classList: { add() {}, remove() {}, toggle() {} }, textContent: '' });
  const offered = [], errors = [], urlStatus = [];
  const reads = new Map(); // file name -> deferred bytes
  const fileNamed = (name, seconds = 2) => ({
    name,
    seconds,
    arrayBuffer: () => (reads.get(name)?.promise ?? Promise.resolve(new ArrayBuffer(1024))),
  });
  const context = vm.createContext({
    ...cache, fingerprintBuffer, GrooveFingerprint, ...opening, ensureRidgeMusicSession, upgradeRidgeMusicSession,
    AUDIO_LOAD_LIMITS, accumulateDecodedAudioBytes, accumulateDecodedByteLength, decodedAudioByteLength,
    accumulateEncodedAudioBytes, audioAbortError, validateAudioFiles, validateDecodedAudioBuffer, validateDecodedByteLength,
    AbortController, console, setTimeout, clearTimeout,
    SourceSelection, sourceSelection: new SourceSelection(), loadGen: 0,
    running: false, sim: null, lastTimelineData: null, bulkExportArmed: false,
    fingerprintBufferOffThread: async (buffer) => fingerprintBuffer(buffer),
    readBulkExportFromUrl: () => null, rangeListening: false, fullAnalysisPending: null, adoptFullAnalysisLive() {},
    groove: new GrooveFingerprint(), lyricsDisabled: true,
    bootAudio: async () => {}, unlockAudio() {}, showProgress() {},
    showErrorBanner: (message) => errors.push(message),
    // decodeFile hands back a buffer as long as the file says it is, so the
    // duration reported to the library identifies which file was decoded.
    audioEngine: {
      decodeFile: async (bytes) => recording(bytes?.seconds ?? 2),
    },
    stopTimeline() {}, stopTitleBackdrop() {}, stopWorldPreview() {}, closeWorldChooser() {},
    pendingWorldStart: null,
    worldSelectEl: element(), progressEl: element(), loaderEl: element(), hudEl: element(),
    auditionHeadingEl: element(), auditionPanelEl: element(), lyricsRowEl: element(),
    loadShow: { start() {}, stop() {}, setStage() {} },
    sumToMixBuffer: () => recording(), isVocalStemName: () => false,
    getBundle: async () => null, unpackBundle: () => null, packBundle: () => ({}), putBundle: async () => {},
    audioToTimeline: async () => ({ durationMs: 2000, timeline: [], barGrid: [] }),
    generateCustomBiomeFromMidi: () => ({}), rememberCustomBiome() {}, paramBus: {},
    muteTimelineSynth: false, lastSongName: '', lastAudioBuffer: null,
    fontRecommender: null, DEV_MODE: false,
    offerWorldsThenStart: (data, extra = {}) => offered.push({ song: context.lastSongName, data, extra }),
    // The sample.
    buildDemoSong: () => ({ title: 'Proof', bpm: 120, durationMs: 1000, timeline: [], barGrid: [], conductor: {}, sections: [] }),
    synthesizeEnergyCurves: () => null,
    // The library.
    displayTitle: (track) => track.path,
    closeLibrary() {},
    musicLibrary: {
      playable: true, root: null, played: [],
      grantAccess: async () => true,
      openFile: async (track) => fileNamed(track.path, track.seconds),
      async notePlayed(track, seconds) { this.played.push([track.path, seconds]); },
    },
    // The URL panel.
    urlLoadAbort: null,
    setUrlLoadBusy() {}, clearUrlLoadListing() {}, renderUrlListing() {},
    setUrlLoadStatus: (text, isError) => urlStatus.push([text, !!isError]),
    location: { href: 'http://127.0.0.1:8080/' },
    UrlAudioError: class UrlAudioError extends Error {},
    decodeUrlPathForDisplay: (u) => u,
    classifyUrl: (url) => ({ ok: true, url }),
    openAudioUrl: async () => ({ kind: 'file', file: fileNamed('url.mp3') }),
    fetchAudioAsFile: async (url, { name }) => fileNamed(name || 'url.mp3'),
  });
  // Bytes carry the file's length through the fake decoder.
  context.validateAudioFiles = (files, limits) => validateAudioFiles(files, limits);
  const realRead = fileNamed;
  vm.runInContext(ORCHESTRATORS.map(fnSource).join('\n\n'), context);
  // What backToTitle() does to ownership.
  const backToTitle = () => { context.sourceSelection.cancel(); context.loadGen++; };
  const holdRead = (name) => { const d = deferred(); reads.set(name, d); return d; };
  const bytes = (seconds) => Object.assign(new ArrayBuffer(1024), { seconds });
  return { context, offered, errors, urlStatus, fileNamed: realRead, holdRead, bytes, backToTitle };
}

test('library A resolving after a dropped file B: only B plays and A is never credited', async () => {
  const h = harness();
  const permission = deferred();
  h.context.musicLibrary.playable = false;
  h.context.musicLibrary.root = { handle: {} };
  h.context.musicLibrary.grantAccess = () => permission.promise;
  const libraryPlay = h.context.playLibraryTrack({ path: 'a.flac', seconds: 3 });
  // The player gives up on the prompt and drops a file instead.
  h.context.handleFiles([h.fileNamed('b.wav')]);
  await flush();
  permission.resolve(true);
  await libraryPlay;
  await flush();
  assert.deepEqual(h.offered.map((o) => o.song), ['b.wav']);
  assert.deepEqual(h.context.musicLibrary.played, []);
  assert.deepEqual(h.errors, []);
});

test('library A whose file read finishes after library B: B wins with its own duration', async () => {
  const h = harness();
  const readA = deferred();
  h.context.musicLibrary.openFile = (track) => (track.path === 'a.flac'
    ? readA.promise : Promise.resolve(h.fileNamed(track.path)));
  h.context.audioEngine.decodeFile = async () => recording(4);
  const first = h.context.playLibraryTrack({ path: 'a.flac' });
  const second = h.context.playLibraryTrack({ path: 'b.flac' });
  await second; await flush();
  readA.resolve(h.fileNamed('a.flac'));
  await first; await flush();
  assert.deepEqual(h.offered.map((o) => o.song), ['b.flac']);
  assert.deepEqual(h.context.musicLibrary.played, [['b.flac', 4]]);
});

test('an upload still decoding when the Proof sample is chosen never replaces it', async () => {
  const h = harness();
  const read = h.holdRead('upload.wav');
  h.context.handleFiles([h.fileNamed('upload.wav')]);
  await flush();
  await h.context.startDemoSample();
  read.resolve(h.bytes(2));
  await flush();
  assert.deepEqual(h.offered.map((o) => o.song), ['Proof']);
  assert.deepEqual(h.errors, []);
});

test('the Proof sample waiting on audio boot loses to a newer upload', async () => {
  const h = harness();
  const boot = deferred();
  h.context.bootAudio = () => boot.promise;
  const sample = h.context.startDemoSample();
  h.context.bootAudio = async () => {};
  h.context.handleFiles([h.fileNamed('upload.wav')]);
  await flush();
  boot.resolve();
  await sample; await flush();
  assert.deepEqual(h.offered.map((o) => o.song), ['upload.wav']);
});

test('a URL download that finishes after a file replacement is discarded', async () => {
  const h = harness();
  const download = deferred();
  h.context.fetchAudioAsFile = (_url, { signal }) => {
    signal.addEventListener('abort', () => download.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    return download.promise;
  };
  const url = h.context.loadUrlAudio('http://music.local/a.mp3', 'a.mp3');
  h.context.handleFiles([h.fileNamed('picked.wav')]);
  await url; await flush();
  assert.deepEqual(h.offered.map((o) => o.song), ['picked.wav']);
  assert.equal(h.urlStatus.some(([, isError]) => isError), false, 'no URL error for an abandoned download');
});

test('a URL download that ignores abort still cannot publish once replaced', async () => {
  const h = harness();
  const download = deferred();
  h.context.fetchAudioAsFile = () => download.promise; // never observes the signal
  const url = h.context.loadUrlAudio('http://music.local/a.mp3', 'a.mp3');
  h.context.handleFiles([h.fileNamed('picked.wav')]);
  await flush();
  download.resolve(h.fileNamed('a.mp3'));
  await url; await flush();
  assert.deepEqual(h.offered.map((o) => o.song), ['picked.wav']);
});

for (const phase of ['permission', 'decode', 'analysis']) {
  test(`returning to the title during ${phase} publishes nothing`, async () => {
    const h = harness();
    const gate = deferred();
    if (phase === 'permission') {
      h.context.musicLibrary.playable = false;
      h.context.musicLibrary.root = { handle: {} };
      h.context.musicLibrary.grantAccess = () => gate.promise.then(() => true);
    } else if (phase === 'decode') {
      h.context.audioEngine.decodeFile = () => gate.promise.then(() => recording());
    } else {
      h.context.audioToTimeline = () => gate.promise.then(() => ({ durationMs: 2000, timeline: [], barGrid: [] }));
    }
    const play = h.context.playLibraryTrack({ path: 'a.flac' });
    await flush();
    h.backToTitle();
    gate.resolve();
    await play; await flush();
    assert.deepEqual(h.offered, []);
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.context.musicLibrary.played, []);
  });
}

test('a failed library play is never credited with the next unrelated file', async () => {
  const h = harness();
  h.context.musicLibrary.openFile = async () => null; // moved since the scan
  await h.context.playLibraryTrack({ path: 'gone.flac' });
  assert.equal(h.errors.length, 1, 'the missing file is reported');
  h.context.handleFiles([h.fileNamed('other.wav')]);
  await flush();
  assert.deepEqual(h.offered.map((o) => o.song), ['other.wav']);
  assert.deepEqual(h.context.musicLibrary.played, []);
});

test('a library play whose decode fails is not credited to the next drop', async () => {
  const h = harness();
  h.context.audioEngine.decodeFile = async () => { throw new Error('bad header'); };
  await h.context.playLibraryTrack({ path: 'broken.flac' });
  await flush();
  assert.equal(h.errors.length, 1);
  h.context.audioEngine.decodeFile = async () => recording(5);
  h.context.handleFiles([h.fileNamed('other.wav')]);
  await flush();
  assert.deepEqual(h.context.musicLibrary.played, []);
});

test('a successful library play reports its decoded duration exactly once', async () => {
  const h = harness();
  h.context.audioEngine.decodeFile = async () => recording(7);
  await h.context.playLibraryTrack({ path: 'a.flac' });
  await flush();
  assert.deepEqual(h.context.musicLibrary.played, [['a.flac', 7]]);
  assert.deepEqual(h.offered.map((o) => o.song), ['a.flac']);
});

for (const order of ['old fails first', 'new finishes first']) {
  test(`an obsolete decode failure cannot disturb the newer load (${order})`, async () => {
    const h = harness();
    const oldDecode = deferred();
    h.context.audioEngine.decodeFile = () => oldDecode.promise;
    h.context.handleFiles([h.fileNamed('old.wav')]);
    await flush();
    const newDecode = deferred();
    h.context.audioEngine.decodeFile = () => newDecode.promise;
    h.context.handleFiles([h.fileNamed('new.wav')]);
    await flush();
    if (order === 'old fails first') {
      oldDecode.reject(new Error('corrupt'));
      await flush();
      newDecode.resolve(recording());
    } else {
      newDecode.resolve(recording());
      await flush();
      oldDecode.reject(new Error('corrupt'));
    }
    await flush();
    assert.deepEqual(h.offered.map((o) => o.song), ['new.wav']);
    assert.deepEqual(h.errors, [], 'no banner from the replaced load');
  });
}

test('an obsolete whole-song analysis cannot clear the newer pending one', async () => {
  const h = harness();
  const long = () => recording(60);
  h.context.audioEngine.decodeFile = async () => long();
  h.context.sliceAudioBuffer = (b) => ({ ...b, duration: 15 });
  const wholes = [];
  h.context.audioToTimeline = (b) => {
    if (b.duration === 15) return Promise.resolve({ durationMs: 15000, timeline: [], barGrid: [] });
    const d = deferred(); wholes.push(d); return d.promise;
  };
  h.context.useOpeningAnalysis = () => true;
  h.context.setTimeout = (fn) => { fn(); return 0; };
  h.context.handleFiles([h.fileNamed('old.wav')]);
  await flush();
  const oldPending = h.context.fullAnalysisPending;
  h.context.handleFiles([h.fileNamed('new.wav')]);
  await flush();
  const newPending = h.context.fullAnalysisPending;
  assert.ok(newPending && newPending !== oldPending);
  wholes[0].reject(new Error('worker crashed'));
  await flush();
  assert.equal(h.context.fullAnalysisPending, newPending);
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.offered.map((o) => o.song), ['old.wav', 'new.wav']);
});

test('loads finishing work for a selection never claim a newer generation', async () => {
  const h = harness();
  const selection = h.context.claimSelection({ kind: 'file', name: 'a.wav' });
  const gen = h.context.loadGen;
  await h.context.loadAudioFiles([h.fileNamed('a.wav')], { selection });
  assert.equal(h.context.loadGen, gen);
  assert.equal(h.context.sourceSelection.isCurrent(selection), true);
});
