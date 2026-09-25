import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as cache from '../src/audio/AnalysisCache.js';
import { fingerprintBuffer } from '../src/audio/SongFingerprint.js';
import { GrooveFingerprint } from '../src/sim/GrooveFingerprint.js';
import * as opening from '../src/audio/OpeningAnalysis.js';
import {
  AUDIO_LOAD_LIMITS, accumulateDecodedAudioBytes, accumulateDecodedByteLength, decodedAudioByteLength,
  accumulateEncodedAudioBytes, audioAbortError, validateAudioFiles, validateDecodedAudioBuffer, validateDecodedByteLength,
} from '../src/audio/loadLimits.js';

// Execute the real upload orchestrator with browser/audio boundaries replaced.
// Analysis/cache identity remain real; no browser is needed to test ownership.
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const loadSource = main.slice(main.indexOf('async function loadAudioFiles('), main.indexOf('\nfunction handleFile('));
const element = () => ({ classList: { add() {}, remove() {} }, textContent: '' });
function recording(hz = 440) {
  const samples = Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i * hz * Math.PI / 4000) * (0.4 + 0.1 * Math.sin(i / 100)));
  return { sampleRate: 8000, length: samples.length, duration: 2, numberOfChannels: 1, getChannelData: () => samples };
}
function harness() {
  const mix = recording();
  const encoded = new ArrayBuffer(1024);
  const keys = [], errors = [];
  const context = vm.createContext({
    ...cache, fingerprintBuffer, GrooveFingerprint, ...opening,
    fingerprintBufferOffThread: async (buffer) => fingerprintBuffer(buffer),
    readBulkExportFromUrl: () => null, fullAnalysisPending: null, adoptFullAnalysisLive() {},
    AUDIO_LOAD_LIMITS, accumulateDecodedAudioBytes, accumulateDecodedByteLength, decodedAudioByteLength,
    accumulateEncodedAudioBytes, audioAbortError, validateAudioFiles, validateDecodedAudioBuffer, validateDecodedByteLength,
    AbortController,
    loadGen: 0, groove: new GrooveFingerprint(), lyricsDisabled: true,
    console, bootAudio: async () => {}, showProgress() {},
    showErrorBanner: (error) => errors.push(error),
    audioEngine: { playing: true, decodeFile: async () => mix },
    stopTimeline() { context.audioEngine.playing = false; context.stopped = true; },
    stopTitleBackdrop() {}, stopWorldPreview() {}, closeWorldChooser() {}, pendingWorldStart: {},
    worldSelectEl: element(), progressEl: element(), loaderEl: element(), hudEl: element(),
    auditionHeadingEl: element(), auditionPanelEl: element(), lyricsRowEl: element(),
    loadShow: { start() {}, stop() {}, setStage() {} },
    sumToMixBuffer: () => mix, isVocalStemName: () => false,
    getBundle: async (key) => { keys.push(key); return {}; },
    unpackBundle: () => ({ fromBundle: true }),
    audioToTimeline: async () => ({ fromBundle: true }),
    generateCustomBiomeFromMidi: () => ({}), rememberCustomBiome() {}, paramBus: {},
    muteTimelineSynth: false, lastSongName: '', lastAudioBuffer: null,
    fontRecommender: null, DEV_MODE: false, offerWorldsThenStart() {},
    // A load started from the music library reports the decoded duration
    // back to it -- the one fact a folder scan cannot know.
    playingFromLibrary: null,
    musicLibrary: { played: [], async notePlayed(track, seconds) { this.played.push([track, seconds]); } },
  });
  vm.runInContext(loadSource, context);
  const load = async (names = ['mix.wav']) => {
    await context.loadAudioFiles(names.map((name) => ({ name, arrayBuffer: async () => encoded })));
    assert.deepEqual(errors, []);
    return keys.at(-1);
  };
  return { context, load, keys };
}

test('accepting an upload stops the old performance before audio initialization awaits', async () => {
  const { context } = harness();
  context.bootAudio = () => new Promise(() => {});
  context.loadAudioFiles([{ name: 'new.wav' }]);
  assert.equal(context.audioEngine.playing, false);
  assert.equal(context.pendingWorldStart, null);
});

test('a library play reports its decoded duration back, exactly once', async () => {
  const { context, load } = harness();
  const track = { key: 'root\u0000a.wav', path: 'a.wav' };
  context.playingFromLibrary = track;
  await load();
  assert.deepEqual(context.musicLibrary.played, [[track, 2]]);
  // The claim is consumed, so a later drop that did not come from the
  // library cannot be credited to the last track played from it.
  assert.equal(context.playingFromLibrary, null);
  await load();
  assert.equal(context.musicLibrary.played.length, 1);
});

test('a drop that did not come from the library tells it nothing', async () => {
  const { context, load } = harness();
  await load();
  assert.deepEqual(context.musicLibrary.played, []);
});

test('cache identity changes when the same stem audio is renamed for a different character', async () => {
  const { load } = harness();
  const first = await load(['vocals.wav', 'bass.wav']);
  assert.notEqual(await load(['guitar.wav', 'bass.wav']), first);
});

test('cache identity changes with learned rhythm settings and is stable otherwise', async () => {
  const { context, load } = harness();
  const first = await load();
  assert.equal(await load(), first);
  context.groove.low.count = 16;
  context.groove.low.template[0] = 1;
  assert.notEqual(await load(), first);
});


test('stem content participates in cache identity even when the mixed fingerprint is unchanged', () => {
  const mix = fingerprintBuffer(recording());
  const key = (buffer) => cache.analysisCacheKey(mix, { stems: [{ name: 'bass.wav', buffer }] });
  assert.notEqual(key(recording(440)), key(recording(880)));
});

test('low-information audio bypasses cache lookup and still reaches analysis', async () => {
  const { context, keys } = harness();
  let analyzed = false;
  context.audioToTimeline = async () => { analyzed = true; return { fromBundle: true }; };
  const silence = recording();
  silence.getChannelData = () => new Float32Array(silence.length);
  context.audioEngine.decodeFile = async () => silence;
  await context.loadAudioFiles([{ name: 'silence.wav', arrayBuffer: async () => new ArrayBuffer(1024) }]);
  assert.equal(analyzed, true);
  assert.deepEqual(keys, []);
});

test('a superseded load awaiting audio initialization never starts decoding', async () => {
  const { context } = harness();
  let release;
  context.bootAudio = () => new Promise((resolve) => { release = resolve; });
  let decoded = false;
  context.audioEngine.decodeFile = async () => { decoded = true; };
  const pending = context.loadAudioFiles([{ name: 'old.wav', arrayBuffer: async () => new ArrayBuffer(1024) }]);
  context.loadGen++;
  release();
  await pending;
  assert.equal(decoded, false);
});

test('a superseded audio analysis receives an abort signal', async () => {
  const { context } = harness();
  let analysisStarted;
  const analysisSignal = new Promise((resolve) => { analysisStarted = resolve; });
  context.unpackBundle = () => null;
  context.audioToTimeline = async (_buffer, { signal }) => {
    analysisStarted(signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { fromBundle: true };
  };
  const first = context.loadAudioFiles([{ name: 'old.wav', arrayBuffer: async () => new ArrayBuffer(1024) }]);
  const signal = await analysisSignal;
  const second = context.loadAudioFiles([{ name: 'new.wav', arrayBuffer: async () => new ArrayBuffer(1024) }]);
  await Promise.all([first, second]);
  assert.equal(signal.aborted, true);
});

test('phase-sensitive analysis never shares a cache entry with an in-phase recording', () => {
  const mono = recording();
  const left = mono.getChannelData(0);
  const right = Float32Array.from(left, (x) => -x);
  const stereo = (inverted) => ({ ...mono, numberOfChannels: 2,
    getChannelData: (c) => c && inverted ? right : left });
  const a = fingerprintBuffer(stereo(false)), b = fingerprintBuffer(stereo(true));
  assert.deepEqual(a.frames, b.frames, 'acoustic matching remains phase-safe');
  assert.notEqual(cache.analysisCacheKey(a), cache.analysisCacheKey(b),
    'cached stereo width depends on phase');
});

test('long audio exposes a whole-recording overview while full analysis is pending and after adoption', async () => {
  const { context, load } = harness();
  const buffer = recording();
  buffer.duration = 744.573;
  context.audioEngine.decodeFile = async () => buffer;
  context.sliceAudioBuffer = () => ({ ...buffer, duration: 15 });
  context.setTimeout = (fn) => fn();
  context.getBundle = async () => null;
  context.packBundle = () => ({});
  context.putBundle = async () => {};
  let finish;
  const full = new Promise((resolve) => { finish = resolve; });
  context.audioToTimeline = async (b) => b.duration === 15
    ? { durationMs: 15000, timeline: [{ tMs: 1000 }], barGrid: [] } : full;
  let offered;
  context.offerWorldsThenStart = (data) => { offered = data; };
  await load();
  assert.equal(offered.opening.analyzedMs, 15000);
  assert.ok(offered.audioOverview[200] > 0);
  const overview = offered.audioOverview;
  finish({ durationMs: 744573, timeline: [{ tMs: 600000 }], barGrid: [] });
  await context.fullAnalysisPending;
  assert.equal(offered.opening, undefined);
  assert.equal(offered.audioOverview, overview);
  assert.equal(offered.timeline[0].tMs, 600000);
});
