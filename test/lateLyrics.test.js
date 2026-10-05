// Lyrics that arrive after the performance has started (F06). The audit
// delayed a successful lookup by 3.6 s: the timed lines and the lyric
// sections reached the song's data but never the running world, which kept
// playing as if there were no lyrics until a seek or replay rebuilt it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { Conductor } from '../src/core/Conductor.js';
import { BiomeManager } from '../src/world/BiomeManager.js';
import { EnergyCurves } from '../src/audio/EnergyCurves.js';
import { Role, makeNoteEvent } from '../src/core/NoteEvent.js';
import { parseLrc } from '../src/lyrics/LyricsClient.js';
import { toBlocks, labelBlocks } from '../src/lyrics/LyricStructure.js';
import { sectionIndexAt } from '../src/world/BiomeSchedule.js';
import { SourceSelection } from '../src/audio/SourceSelection.js';
import { mainFunctions } from './helpers/mainSource.js';
import * as opening from '../src/audio/OpeningAnalysis.js';
import { fingerprintBuffer } from '../src/audio/SongFingerprint.js';
import * as cache from '../src/audio/AnalysisCache.js';
import { GrooveFingerprint } from '../src/sim/GrooveFingerprint.js';
import { ensureRidgeMusicSession, upgradeRidgeMusicSession } from '../src/world/RidgeMotionHistory.js';
import * as limits from '../src/audio/loadLimits.js';

const DURATION = 120000;
const LRC = `[00:05.00]Walking out alone tonight
[00:07.50]The street is cold and wide

[00:20.00]I remember summer light
[00:23.00]I remember how you smiled

[00:40.00]So hold me now, hold me now
[00:43.00]We are burning bright
[00:46.00]So hold me now, hold me now

[01:00.00]I remember summer light
[01:03.00]I remember how you smiled

[01:20.00]So hold me now, hold me now
[01:23.00]We are burning bright
`;

function lyricEvidence() {
  const synced = parseLrc(LRC);
  const lyricSections = labelBlocks(toBlocks(synced, { synced: true }), { durationMs: DURATION });
  return { lyricSections, syncedLyrics: synced };
}

function manager(evidence = {}) {
  const barGrid = Array.from({ length: 61 }, (_, i) => ({ ms: i * 2000, numerator: 4, denominator: 4 }));
  const timeline = [];
  for (let t = 0; t < DURATION; t += 500) timeline.push(makeNoteEvent({ tMs: t, pitch: 36, vel: .8, role: Role.RHYTHM, kick: true, src: 'audio' }));
  const conductor = new Conductor();
  conductor.load({ timeline, durationMs: DURATION, barGrid, bpm: 120, confidence: .9, firstBarMs: 0 });
  const curves = new EnergyCurves(DURATION);
  for (let i = 0; i < curves.n; i++) {
    const t = i * 1000 / curves.rateHz;
    curves.setFrame(i, Array(7).fill(.3 + .5 * Math.abs(Math.sin(t / 15000))));
  }
  return new BiomeManager({
    conductor, energyCurves: curves, durationMs: DURATION, canvasWidth: 1280, canvasHeight: 720, groundY: 625,
    songSeed: 3, worldId: 'range', ...evidence,
  });
}

const shape = (s) => ({ startMs: s.startMs, endMs: s.endMs, kind: s.kind ?? null, lyricText: s.lyricText ?? null });

test('late lyrics fuse from the heard moment on, exactly as they would have on time', () => {
  const evidence = lyricEvidence();
  const onTime = manager(evidence);
  const late = manager();
  const heard = 3600; // the audit's delay
  const before = late.sections.map(shape);
  late.update(heard, 1 / 60, null, 0, 0);
  const idx = late._lastSectionIdx;
  assert.equal(late.adoptLyricEvidence(evidence, heard), true);
  // The past is untouched and the current section keeps its start.
  const i = sectionIndexAt(late.sections, heard);
  assert.equal(i, idx, 'no section boundary is inserted behind the playhead');
  assert.deepEqual(late.sections.slice(0, i).map(shape), before.slice(0, i));
  assert.equal(late.sections[i].startMs, before[i].startMs);
  // From here on it is the on-time schedule.
  const future = (m) => m.sections.filter((s) => s.startMs > heard).map(shape);
  assert.deepEqual(future(late), future(onTime));
  assert.ok(future(late).some((s) => s.kind), 'the future really carries lyric labels');
  // The current section's labels are what an on-time performance has here.
  const onTimeNow = onTime.sections[sectionIndexAt(onTime.sections, heard)];
  assert.equal(late.sections[i].kind ?? null, onTimeNow.kind ?? null);
  onTime.dispose(); late.dispose();
});

test('adoption fires no transition and replays no past lyric glyph', () => {
  const evidence = lyricEvidence();
  const late = manager();
  const heard = 44000; // inside the first chorus, past several lines
  for (let t = 0; t <= heard; t += 1000) late.update(t, 1, null, 0, 0);
  const hinted = [];
  late.weaver.hintGlyph = (id, deadline) => hinted.push({ id, deadline });
  late.adoptLyricEvidence(evidence, heard);
  late.update(heard, 1 / 60, null, 0, 0);
  assert.equal(late.sectionJustChanged, false, 'adoption is not a section boundary');
  assert.equal(late.cutFlashJustFired, false);
  assert.equal(late._lyricLineCursor, evidence.syncedLyrics.findIndex((l) => l.tMs > heard));
  assert.deepEqual(hinted, [], 'lines already sung are not scanned');
  // The next line still lands when it is heard.
  late.update(46500, 1 / 60, null, 0, 0);
  assert.equal(late._lyricLineCursor, evidence.syncedLyrics.findIndex((l) => l.tMs > 46500));
  assert.ok(late.songSymbol !== undefined);
  late.dispose();
});

test('nothing to adopt is a no-op', () => {
  const late = manager();
  const before = late.sections.map(shape);
  assert.equal(late.adoptLyricEvidence({ lyricSections: null, syncedLyrics: [] }, 5000), false);
  assert.equal(late.adoptLyricEvidence(undefined, 5000), false);
  assert.deepEqual(late.sections.map(shape), before);
  assert.equal(late._syncedLyrics, null);
  late.dispose();
});

test('geography is untouched by late lyrics', () => {
  const late = manager();
  const chapters = JSON.stringify(late.chapterPlan ?? null);
  const biomes = late.sections.map((s) => s.biome ?? s.biomeId ?? null);
  late.adoptLyricEvidence(lyricEvidence(), 3600);
  assert.equal(JSON.stringify(late.chapterPlan ?? null), chapters);
  const after = late.sections.filter((s) => s.startMs <= 3600).map((s) => s.biome ?? s.biomeId ?? null);
  assert.deepEqual(after, biomes.slice(0, after.length));
  late.dispose();
});

// --- The orchestration in main.js --------------------------------------------

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function orchestration() {
  const adopted = [];
  const owner = new SourceSelection();
  const selection = owner.begin({ kind: 'file', name: 'song.mp3' });
  const data = {};
  const audioSource = { id: 'the-one-playing' };
  const context = vm.createContext({
    console: { info() {}, warn() {} },
    sourceSelection: owner, bulkExportArmed: false, lastTimelineData: data,
    sim: {
      heardTimeMs: 3600,
      biomes: { adoptLyricEvidence: (evidence, heard) => { adopted.push({ evidence, heard }); return true; } },
    },
    audioEngine: { source: audioSource },
  });
  vm.runInContext(mainFunctions(['adoptLateLyrics']), context);
  return { context, adopted, owner, selection, data, audioSource };
}

test('a lookup that lands 3.6 s into the song joins it at the heard moment, without touching the audio', () => {
  const h = orchestration();
  const evidence = lyricEvidence();
  assert.equal(h.context.adoptLateLyrics(h.data, h.selection, evidence), true);
  assert.equal(h.adopted.length, 1);
  assert.equal(h.adopted[0].heard, 3600);
  assert.equal(h.adopted[0].evidence, evidence);
  assert.equal(h.context.audioEngine.source, h.audioSource, 'the AudioBuffer source is unchanged');
});

test('lyrics for a replaced selection, another song, or a bulk export are not adopted', () => {
  const evidence = lyricEvidence();
  const replaced = orchestration();
  replaced.owner.begin({ kind: 'sample', name: 'Proof' });
  assert.equal(replaced.context.adoptLateLyrics(replaced.data, replaced.selection, evidence), false);
  const otherSong = orchestration();
  otherSong.context.lastTimelineData = {};
  assert.equal(otherSong.context.adoptLateLyrics(otherSong.data, otherSong.selection, evidence), false);
  const exporting = orchestration();
  exporting.context.bulkExportArmed = true;
  assert.equal(exporting.context.adoptLateLyrics(exporting.data, exporting.selection, evidence), false);
  const notStarted = orchestration();
  notStarted.context.sim = null;
  assert.equal(notStarted.context.adoptLateLyrics(notStarted.data, notStarted.selection, evidence), false);
  for (const h of [replaced, otherSong, exporting, notStarted]) assert.deepEqual(h.adopted, []);
});

test('an empty or instrumental answer adopts nothing', () => {
  const h = orchestration();
  assert.equal(h.context.adoptLateLyrics(h.data, h.selection, { lyricSections: null, syncedLyrics: null }), false);
  assert.equal(h.context.adoptLateLyrics(h.data, h.selection, { lyricSections: [], syncedLyrics: [] }), false);
  assert.deepEqual(h.adopted, []);
});

// The load path wires it: the real loadAudioFiles, with a lookup that
// resolves after the world has started.

function loadHarness() {
  const samples = new Float32Array(16000).map((_, i) => Math.sin(i / 3) * .4);
  const recording = { sampleRate: 8000, length: samples.length, duration: 2, numberOfChannels: 1, getChannelData: () => samples };
  const lookup = deferred();
  const adopted = [], errors = [];
  const element = () => ({ classList: { add() {}, remove() {} }, textContent: '' });
  const context = vm.createContext({
    ...cache, ...opening, ...limits, fingerprintBuffer, GrooveFingerprint, ensureRidgeMusicSession, upgradeRidgeMusicSession,
    AbortController, console: { info() {}, warn() {}, error() {} }, setTimeout,
    sourceSelection: new SourceSelection(), loadGen: 0,
    running: false, sim: null, lastTimelineData: null, bulkExportArmed: false,
    fingerprintBufferOffThread: async (b) => fingerprintBuffer(b), readBulkExportFromUrl: () => null, rangeListening: false,
    fullAnalysisPending: null, adoptFullAnalysisLive() {}, groove: new GrooveFingerprint(),
    lyricsDisabled: false,
    resolveLyricsForAudio: () => lookup.promise,
    bootAudio: async () => {}, showProgress() {}, showErrorBanner: (m) => errors.push(m),
    audioEngine: { decodeFile: async () => recording },
    stopTimeline() {}, stopTitleBackdrop() {}, closeWorldChooser() {}, pendingWorldStart: null,
    progressEl: element(), loaderEl: element(), hudEl: element(), auditionHeadingEl: element(), auditionPanelEl: element(), lyricsRowEl: element(),
    loadShow: { start() {}, stop() {}, setStage() {} }, sumToMixBuffer: () => recording, isVocalStemName: () => false,
    getBundle: async () => null, unpackBundle: () => null, packBundle: () => ({}), putBundle: async () => {},
    audioToTimeline: async () => ({ durationMs: 2000, timeline: [], barGrid: [] }),
    generateCustomBiomeFromMidi: () => ({}), rememberCustomBiome() {}, paramBus: {},
    muteTimelineSynth: false, lastSongName: '', lastAudioBuffer: null, fontRecommender: null, DEV_MODE: false,
    musicLibrary: { async notePlayed() {} },
    // The world starts as soon as it is offered, before the lookup returns.
    offerWorldsThenStart: (data) => {
      context.lastTimelineData = data;
      context.sim = { heardTimeMs: 3600, biomes: { adoptLyricEvidence: (e, heard) => { adopted.push({ e, heard }); return true; } } };
    },
  });
  vm.runInContext(mainFunctions(['claimSelection', 'adoptLateLyrics', 'loadAudioFiles']), context);
  const load = () => context.loadAudioFiles([{ name: 'Artist - Song.mp3', arrayBuffer: async () => new ArrayBuffer(1024) }]);
  return { context, lookup, adopted, errors, load };
}

test('the load path hands a late lookup to the running performance', async () => {
  const h = loadHarness();
  await h.load();
  assert.ok(h.context.sim, 'the world started before the lyrics arrived');
  const evidence = lyricEvidence();
  h.lookup.resolve({ identity: { title: 'Song' }, ...evidence });
  await flush();
  assert.equal(h.adopted.length, 1);
  assert.equal(h.adopted[0].heard, 3600);
  assert.equal(h.context.lastTimelineData.syncedLyrics, evidence.syncedLyrics, 'kept for later seeks and replays');
  assert.deepEqual(h.errors, []);
});

test('turning lyric grounding off while the lookup is pending wins', async () => {
  const h = loadHarness();
  await h.load();
  h.context.lyricsDisabled = true;
  h.lookup.resolve({ identity: { title: 'Song' }, ...lyricEvidence() });
  await flush();
  assert.deepEqual(h.adopted, []);
  assert.equal(h.context.lastTimelineData.syncedLyrics, undefined);
});

test('a lookup that fails is quiet: no banner, nothing adopted', async () => {
  const h = loadHarness();
  await h.load();
  h.lookup.reject(new Error('network down'));
  await flush();
  assert.deepEqual(h.adopted, []);
  assert.deepEqual(h.errors, []);
});

test('a lookup for a replaced song is not adopted into the new one', async () => {
  const h = loadHarness();
  await h.load();
  const first = h.context.lastTimelineData;
  h.context.sourceSelection.begin({ kind: 'file', name: 'next.mp3' });
  h.context.lastTimelineData = {};
  h.lookup.resolve({ identity: { title: 'Song' }, ...lyricEvidence() });
  await flush();
  assert.deepEqual(h.adopted, []);
  assert.ok(first);
});
