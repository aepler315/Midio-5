import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as cache from '../src/audio/AnalysisCache.js';
import { fingerprintBuffer } from '../src/audio/SongFingerprint.js';
import { GrooveFingerprint } from '../src/sim/GrooveFingerprint.js';
import { ensureRidgeMusicSession, upgradeRidgeMusicSession } from '../src/world/RidgeMotionHistory.js';
import { EnergyCurves } from '../src/audio/EnergyCurves.js';
import * as opening from '../src/audio/OpeningAnalysis.js';
import {
  AUDIO_LOAD_LIMITS, accumulateDecodedAudioBytes, accumulateDecodedByteLength, decodedAudioByteLength,
  accumulateEncodedAudioBytes, audioAbortError, validateAudioFiles, validateDecodedAudioBuffer, validateDecodedByteLength,
} from '../src/audio/loadLimits.js';
import { SourceSelection } from '../src/audio/SourceSelection.js';
import { buildSongProfile, PROFILE_VERSION } from '../src/audio/SongProfile.js';
import { resolveSongSeed } from '../src/utils/seed.js';
import { mainFunctions } from './helpers/mainSource.js';

// Execute the real upload orchestrator with browser/audio boundaries replaced.
// Analysis/cache identity remain real; no browser is needed to test ownership.
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const loadSource = main.slice(main.indexOf('function claimSelection('), main.indexOf('\n// Retained so "Replay seed"'))
  + main.slice(main.indexOf('async function loadAudioFiles('), main.indexOf('\nfunction handleFile('));
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
    ...cache, fingerprintBuffer, GrooveFingerprint, ...opening, ensureRidgeMusicSession, upgradeRidgeMusicSession,
    running: false, sim: null, lastTimelineData: null, bulkExportArmed: false,
    fingerprintBufferOffThread: async (buffer) => fingerprintBuffer(buffer),
    readBulkExportFromUrl: () => null, rangeListening: false, fullAnalysisPending: null, adoptFullAnalysisLive() {},
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
    // back to it -- the one fact a folder scan cannot know. The track rides
    // on the selection that the library click claimed.
    sourceSelection: new SourceSelection(),
    musicLibrary: { played: [], async notePlayed(track, seconds) { this.played.push([track, seconds]); } },
  });
  vm.runInContext(loadSource, context);
  Object.assign(context, { buildSongProfile, PROFILE_VERSION, resolveSongSeed });
  vm.runInContext(mainFunctions(['offerIdentity', 'acceptDeferredIdentity']), context);
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
  const selection = context.claimSelection({ kind: 'library', name: 'a', libraryTrack: track });
  await context.loadAudioFiles([{ name: 'a.wav', arrayBuffer: async () => new ArrayBuffer(1024) }], { selection });
  assert.deepEqual(context.musicLibrary.played, [[track, 2]]);
  // The track belongs to that selection, so a later drop that did not come
  // from the library cannot be credited to the last track played from it.
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

test('landscape listening starts provisionally and adopts the complete analysis', async () => {
  const { context, load } = harness();
  const buffer = recording(); buffer.duration = 120;
  context.audioEngine.decodeFile = async () => buffer;
  context.rangeListening = true;
  context.sliceAudioBuffer = () => ({ ...buffer, duration: 15 });
  context.setTimeout = (fn) => fn();
  context.getBundle = async () => null;
  context.packBundle = () => ({}); context.putBundle = async () => {};
  let finish, offered = null;
  const full = new Promise(resolve => { finish = resolve; });
  context.audioToTimeline = async b => b.duration === 15
    ? { durationMs: 15000, timeline: [], barGrid: [] } : full;
  context.offerWorldsThenStart = data => { offered = data; };
  const loading = load();
  for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(offered?.opening, 'landscape starts on opening evidence without a reveal wait');
  await loading;
  const pending = context.fullAnalysisPending;
  assert.ok(pending);
  finish({ durationMs: 120000, timeline: [], barGrid: [] });
  await pending;
  assert.equal(offered.opening, undefined);
  assert.equal(offered.durationMs, 120000);
});


test('actual background analysis captures the provisional history before adoption and retains heard-time handoff', async () => {
  const { context, load } = harness();
  const buffer = recording(); buffer.duration = 120;
  context.audioEngine.decodeFile = async () => buffer;
  context.sliceAudioBuffer = () => ({ ...buffer, duration: 15 });
  context.setTimeout = fn => fn(); context.getBundle = async () => null;
  context.packBundle = () => ({}); context.putBundle = async () => {};
  const openingCurves = new EnergyCurves(15000); openingCurves.bands.forEach(b => b.fill(.2));
  const fullCurves = new EnergyCurves(120000); fullCurves.bands.forEach(b => b.fill(.9));
  let finish, offered, prior;
  const full = new Promise(resolve => { finish = resolve; });
  context.audioToTimeline = async b => b.duration === 15
    ? { durationMs: 15000, timeline: [], barGrid: [], energyCurves: openingCurves } : full;
  context.offerWorldsThenStart = data => {
    offered = data; prior = ensureRidgeMusicSession(data, 'load-1:opening');
    context.running = true; context.sim = { heardTimeMs: 5000 };
    context.lastTimelineData = data;
  };
  await load();
  const pending = context.fullAnalysisPending;
  finish({ durationMs: 120000, timeline: [], barGrid: [], energyCurves: fullCurves });
  await pending;
  assert.equal(offered.opening, undefined, 'full adoption actually completed');
  const retained = offered.ridgeMusicSession;
  assert.deepEqual(retained.stateKey, { primaryGeneration: 'load-1:final', previousGeneration: 'load-1:opening', handoffStartMs: 5000, handoffDurationMs: 500 });
  assert.equal(retained.previous, prior.primary);
  assert.equal(retained.sample(5000).bands[0], prior.sample(5000).bands[0]);
  assert.ok(Math.abs(retained.sample(5250).bands[0] - .55) < .001);
  fullCurves.bands.forEach(b => b.fill(0)); openingCurves.bands.forEach(b => b.fill(0));
  assert.ok(Math.abs(retained.sample(5250).bands[0] - .55) < .001, 'both histories are immutable after live data replacement');
});

// A failed whole-song pass leaves the song playable on its opening, records
// the failure on the coverage metadata export reads, and can be retried for
// the same selection only (AnalysisReadiness.js, requestFullSongExport).
function openingHarness() {
  const h = harness();
  const buffer = recording(); buffer.duration = 120;
  h.context.audioEngine.decodeFile = async () => buffer;
  h.context.sliceAudioBuffer = () => ({ ...buffer, duration: 15 });
  h.context.setTimeout = (fn) => fn();
  h.context.getBundle = async () => null;
  h.context.packBundle = () => ({}); h.context.putBundle = async () => {};
  const attempts = [];
  h.context.audioToTimeline = async (b) => {
    if (b.duration === 15) return { durationMs: 15000, timeline: [], barGrid: [] };
    let resolve, reject;
    const p = new Promise((res, rej) => { resolve = res; reject = rej; });
    attempts.push({ resolve, reject });
    return p;
  };
  let offered = null;
  h.context.offerWorldsThenStart = (data) => { offered = data; };
  return { ...h, attempts, offered: () => offered };
}

test('a failed whole-song pass is recorded on the opening, with its reason', async () => {
  const h = openingHarness();
  await h.load();
  const pending = h.context.fullAnalysisPending;
  await new Promise((r) => setImmediate(r));
  h.attempts[0].reject(new Error('worker crashed'));
  assert.equal(await pending, null);
  const data = h.offered();
  assert.equal(data.opening.failed, true);
  assert.equal(data.opening.failure, 'worker crashed');
  assert.equal(h.context.fullAnalysisPending, null);
  assert.equal(h.context.lastSongLoad.data, data);
});

test('retrying the whole-song pass analyses the same recording and adopts it', async () => {
  const h = openingHarness();
  await h.load();
  const first = h.context.fullAnalysisPending;
  await new Promise((r) => setImmediate(r));
  h.attempts[0].reject(new Error('worker crashed'));
  await first;
  const retry = h.context.lastSongLoad.retryWholeSong();
  assert.equal(h.offered().opening.failed, false, 'no longer reported failed while retrying');
  assert.ok(h.context.fullAnalysisPending, 'export sees the retry as pending');
  for (let i = 0; i < 10 && h.attempts.length < 2; i++) await new Promise((r) => setImmediate(r));
  h.attempts[1].resolve({ durationMs: 120000, timeline: [], barGrid: [] });
  assert.equal(await retry, h.offered());
  assert.equal(h.offered().opening, undefined);
  assert.equal(h.offered().durationMs, 120000);
});

test('a retry for a replaced selection does nothing', async () => {
  const h = openingHarness();
  await h.load();
  const first = h.context.fullAnalysisPending;
  await new Promise((r) => setImmediate(r));
  h.attempts[0].reject(new Error('worker crashed'));
  await first;
  const stale = h.context.lastSongLoad;
  h.context.sourceSelection.begin({ kind: 'sample', name: 'Proof' });
  assert.equal(await stale.retryWholeSong(), null);
  assert.equal(h.attempts.length, 1);
  assert.equal(stale.data.opening.failed, true);
});

test('an aborted whole-song pass is not reported as a failure', async () => {
  const h = openingHarness();
  await h.load();
  const pending = h.context.fullAnalysisPending;
  const data = h.offered();
  h.context.sourceSelection.cancel();
  await new Promise((r) => setImmediate(r));
  h.attempts[0]?.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  await pending;
  assert.equal(data.opening.failed, undefined);
});

// --- Opening identity admission (Task 11) -------------------------------------
//
// A song's look -- seed, profile, custom biome -- is accepted once and kept
// for every later play. An opening of silence or an atypical intro must not
// be what fixes it.

function identityHarness({ informative, cached = null }) {
  const h = harness();
  const buffer = recording(); buffer.duration = 120;
  h.context.audioEngine.decodeFile = async () => buffer;
  h.context.sliceAudioBuffer = () => ({ ...buffer, duration: 15 });
  h.context.setTimeout = (fn) => fn();
  h.context.generateCustomBiomeFromMidi = (data) => ({ from: data.opening ? 'opening' : 'whole' });
  const stored = [];
  h.context.getBundle = async () => (cached ? { cached: true } : null);
  h.context.unpackBundle = () => (cached ? { durationMs: 120000, timeline: [], barGrid: [], songIdentity: cached } : null);
  h.context.packBundle = (data) => ({ identity: data.songIdentity });
  h.context.putBundle = async (key, bundle) => { stored.push(bundle); };
  // The opening pass: confident or not, by construction.
  let finish;
  const full = new Promise((resolve) => { finish = resolve; });
  h.context.audioToTimeline = async (b) => (b.duration === 15
    ? { durationMs: 15000, timeline: [], barGrid: [], confidence: informative ? .9 : 0, freeTime: !informative }
    : full);
  let offered = null;
  // What offerWorldsThenStart does with identity, without the world picker.
  h.context.offerWorldsThenStart = (data) => {
    offered = data;
    if (!data.songIdentity) h.context.offerIdentity(data, { seed: 11, songProfile: { version: PROFILE_VERSION, from: 'opening' }, customBiome: data.customBiome });
  };
  h.context.lyricsDisabled = true;
  return { ...h, stored, finish, offered: () => offered };
}

test('an informative opening is accepted as the song identity at once', async () => {
  const h = identityHarness({ informative: true });
  await h.load();
  assert.equal(h.offered().songIdentity.seed, 11);
  assert.equal(h.offered().provisionalIdentity, undefined);
});

test('leading silence plays provisionally and is never cached as the identity', async () => {
  const h = identityHarness({ informative: false });
  await h.load();
  const data = h.offered();
  assert.equal(data.songIdentity, undefined, 'no early false confidence');
  assert.equal(data.provisionalIdentity.seed, 11, 'the performance still has a look to play on');
  const playingBiome = data.customBiome;
  const pending = h.context.fullAnalysisPending;
  h.finish({ durationMs: 120000, timeline: [{ tMs: 50000, pitch: 60, vel: .8, role: 'MELODY' }], barGrid: [], confidence: .9 });
  await pending;
  await new Promise((r) => setImmediate(r));
  assert.ok(data.songIdentity, 'accepted from the whole song');
  assert.notEqual(data.songIdentity.seed, undefined);
  assert.deepEqual(data.songIdentity.customBiome, { from: 'whole' });
  assert.equal(data.customBiome, playingBiome, 'the performance in progress is not repainted');
  assert.equal(h.stored.at(-1)?.identity, data.songIdentity, 'what is cached is the accepted identity');
});

test('a recording seen before starts with its cached identity even after a silent opening', async () => {
  const cached = { seed: 4242, songProfile: { version: PROFILE_VERSION, from: 'cache' }, customBiome: { from: 'cache' } };
  const h = identityHarness({ informative: false, cached });
  await h.load();
  assert.equal(h.offered().songIdentity.seed, 4242, 'identical accepted identity after a cache reload');
  assert.equal(h.offered().provisionalIdentity, undefined);
});

test('a short song analysed whole commits its identity directly', () => {
  const data = { durationMs: 20000 };
  const ctx = vm.createContext({ ...opening });
  vm.runInContext(mainFunctions(['offerIdentity']), ctx);
  ctx.offerIdentity(data, { seed: 5 });
  assert.equal(data.songIdentity.seed, 5);
});

test('accepting a deferred identity leaves the chosen world, scene and geography alone', () => {
  const ctx = vm.createContext({ buildSongProfile, PROFILE_VERSION, resolveSongSeed, generateCustomBiomeFromMidi: () => ({ id: 'b' }) });
  vm.runInContext(mainFunctions(['acceptDeferredIdentity']), ctx);
  const terrain = { range: 'tetons' };
  const data = { durationMs: 1000, timeline: [], sceneChoice: { biome: 'alpine' }, terrain, customBiome: { id: 'playing' }, worldId: 'range' };
  ctx.acceptDeferredIdentity(data, null, 'x.wav');
  assert.deepEqual(data.sceneChoice, { biome: 'alpine' });
  assert.equal(data.terrain, terrain);
  assert.deepEqual(data.customBiome, { id: 'playing' });
  assert.equal(data.worldId, 'range');
  const before = data.songIdentity;
  ctx.acceptDeferredIdentity(data, { seed: 1, songProfile: { version: PROFILE_VERSION } });
  assert.equal(data.songIdentity, before, 'an accepted identity is never replaced');
});

test('canCommitOpeningIdentity reads the informative signal', () => {
  assert.equal(opening.canCommitOpeningIdentity(null), true);
  assert.equal(opening.canCommitOpeningIdentity({ informative: true }), true);
  assert.equal(opening.canCommitOpeningIdentity({ informative: false }), false);
  assert.equal(opening.canCommitOpeningIdentity({}), false);
  const atypical = opening.asOpening({ durationMs: 15000, barGrid: [], freeTime: true, confidence: .8 }, 200000);
  assert.equal(opening.canCommitOpeningIdentity(atypical.opening), false, 'a free-time intro is not the song');
});
