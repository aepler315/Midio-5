import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conductor } from '../src/core/Conductor.js';
import { Simulation } from '../src/sim/Simulation.js';
import { ParamBus } from '../src/core/ParamBus.js';
import { BiomeManager } from '../src/world/BiomeManager.js';
import { EnergyCurves } from '../src/audio/EnergyCurves.js';
import { GroundField } from '../src/world/GroundField.js';
import { Role, makeNoteEvent } from '../src/core/NoteEvent.js';
import { buildRangeFrame, viewportState } from '../src/world/alpine/RangeFrame.js';

const note = (tMs, vel = .8) => makeNoteEvent({ tMs, pitch: 36, vel, role: Role.RHYTHM, kick: true, src: 'audio' });
const data = (extra = {}) => ({ timeline: [note(1000), note(2000), note(3000)], durationMs: 60000, barGrid: [], bpm: 90, confidence: .9, firstBarMs: 200, ...extra });

test('ground glow samples heard time while the collision clock stays on source time', () => {
  const gf = new GroundField(625, { durationMs: 0 });
  gf.kickGlow(0, 1000, 1);
  gf.update(1250, 0, 0, null, 0, 1100);
  assert.equal(gf._nowMs, 1250);
  const lights = gf.activeGlowScreenLights(0, 400);
  assert.equal(lights.length, 1);
  assert.ok(Math.abs(lights[0].intensity - Math.exp(-.1 / .09)) < 1e-7);
});

test('detected 90 BPM and downbeat survive sparse kick timing', () => {
  const c = new Conductor(); c.load(data());
  const s = new Simulation(c, new ParamBus(), { bpm: 90, songSeed: 3, worldId: 'range' });
  for (const at of [0, 1000, 2000, 3000, 4000, 5000]) {
    s.syncSongBeat(at);
    assert.ok(Math.abs(s.beatAnchor.periodMs - 60000 / 90) < 1e-8);
    assert.ok(Math.abs(s.beatAnchor.anchorMs - 200) < 1e-8);
  }
  assert.equal(s.songBeat.snapshotAt(1000).confidence, .9);
  assert.equal(s.presentationBeatAnchor.confidence, .9, 'the detected phase reaches the ensemble without requiring taps');
  s.dispose();
});

test('a low-confidence local tempo window falls back to global pulse without extending the prior window', () => {
  const c = new Conductor(); c.load(data({ bpm: 120, firstBarMs: 0, localTempo: [
    { tMs: 0, beatPeriodMs: 400, confidence: .9 },
    { tMs: 10000, beatPeriodMs: 750, confidence: .1 },
    { tMs: 20000, beatPeriodMs: 500, confidence: .9 },
  ] }));
  const s = new Simulation(c, new ParamBus(), { songSeed: 3, worldId: 'range' });
  assert.equal(s.songBeat.snapshotAt(15000).periodMs, 500);
  assert.equal(s.songBeat.snapshotAt(15000).beatIndex, 35);
  s.dispose();
});

test('local tempo has source-aligned continuous phase and meter', () => {
  const c = new Conductor(); c.load(data({ bpm: 120, firstBarMs: 0, localTempo: [
    { tMs: 0, beatPeriodMs: 500 }, { tMs: 2000, beatPeriodMs: 1000 },
  ], barGrid: [{ ms: 0, numerator: 3, denominator: 4 }, { ms: 1500, numerator: 3, denominator: 4 }] }));
  const s = new Simulation(c, new ParamBus(), { bpm: 120, songSeed: 3, worldId: 'range' });
  s.syncSongBeat(2500);
  assert.equal(s.beatAnchor.periodMs, 1000);
  assert.equal(s.songBeat.snapshotAt(2500).beatIndex, 4);
  assert.equal(s.songBeat.snapshotAt(2500).phase01, .5);
  assert.equal(s.songBeat.snapshotAt(2500).numerator, 3);
  s.dispose();
});

test('uncertain free-time audio exposes no invented metrical confidence', () => {
  const c = new Conductor(); c.load(data({ confidence: 0, freeTime: true }));
  const s = new Simulation(c, new ParamBus(), { songSeed: 3, worldId: 'range' });
  s.syncSongBeat(5000);
  assert.equal(s.songBeat.snapshotAt(5000).freeTime, true);
  assert.equal(s.songBeat.snapshotAt(5000).confidence, 0);
  assert.equal(s.songBeat.snapshotAt(5000).phase01, 0);
  s.dispose();
});

test('actual Conductor seek retains the same heard-time kick envelope without firing past cues', () => {
  const curves = new EnergyCurves(60000, 50);
  for (let i = 0; i < curves.n; i++) curves.setFrame(i, Array(7).fill(.35));
  const vp = viewportState({ logicalWidth: 1280, logicalHeight: 720, backingWidth: 1280, backingHeight: 720 });
  function frame(seek, presentationTime, lag) {
    const c = new Conductor(); c.load(data({ timeline: [note(1000), note(1200)] }));
    const mgr = new BiomeManager({ conductor: c, energyCurves: curves, durationMs: 60000, canvasWidth: 1280, canvasHeight: 720, groundY: 625, songSeed: 3, worldId: 'range' });
    let fired = 0; c.on('*', () => fired++);
    if (seek) c.seekTo(presentationTime, { primeAhead: true });
    c.dispatchUpTo(presentationTime);
    mgr.visualLagMs = lag;
    mgr.update(presentationTime, 0, curves);
    const f = buildRangeFrame({ frameId: 1, sim: { biomes: mgr, conductor: c, songSeed: 3, stageW: 1280 }, pose: { worldX: 0, midioX: 400 }, scenicViewport: vp, groundViewport: vp });
    const result = { music: f.music, timeMs: f.timeMs, rhythmMs: mgr.worldRhythm?.tMs, fired };
    mgr.dispose(); return result;
  }
  const straight = frame(false, 1100, 0), seek = frame(true, 1100, 0), lagged = frame(true, 1250, 150);
  assert.ok(straight.music.source.kickM > 0, 'the kick is heard (the land itself stays still between moments)');
  assert.deepEqual(seek.music, straight.music);
  assert.deepEqual(lagged.music, straight.music, 'a future dispatch must not replace the last heard kick');
  assert.equal(lagged.timeMs, 1100);
  assert.equal(lagged.rhythmMs, 1000);
  assert.equal(seek.fired, 0);
});

// --- Musical directors sample heard time (F05) -------------------------------
//
// Two performances of the same song: one through zero output latency, one
// through 300 ms (a Bluetooth speaker). Stepped so the SAME moment is heard,
// their visual musical state must agree. The feature transitions (a loud
// burst, a key change and a cued drop at 1000 ms) sit between the two source
// times (900 and 1200) of the first compared moment, which is exactly where
// a source-time reader would already have reacted on the late output.
function transitionSong() {
  const curves = new EnergyCurves(20000);
  for (let i = 0; i < curves.n; i++) {
    const t = i * 1000 / curves.rateHz;
    curves.setFrame(i, Array(7).fill(t < 1000 ? .05 : t < 9000 ? .9 : .2));
  }
  const timeline = [];
  for (let t = 0; t < 20000; t += 250) {
    timeline.push(makeNoteEvent({ tMs: t, pitch: 36, vel: .8, role: Role.RHYTHM, kick: true, src: 'midi' }));
    timeline.push(makeNoteEvent({ tMs: t + 10, pitch: (t < 1000 ? 60 : 67) + [0, 4, 7][(t / 250) % 3], vel: .7, role: Role.MELODY, src: 'midi' }));
  }
  const tonalityTimeline = [
    { tMs: 0, tonic: 0, mode: 'major', majorness: .6, confidence: .9 },
    { tMs: 1000, tonic: 9, mode: 'minor', majorness: -.6, confidence: .9 },
  ];
  const liveCues = [{ tMs: 1000, kind: 'drop', value: 1 }, { tMs: 1000, kind: 'calm', value: .5 }];
  return { curves, timeline, tonalityTimeline, liveCues };
}

function performance(latencyMs) {
  const song = transitionSong();
  const c = new Conductor();
  c.load({ timeline: song.timeline, durationMs: 20000, barGrid: [], bpm: 240, confidence: .9, firstBarMs: 0 });
  const s = new Simulation(c, new ParamBus(), {
    bpm: 240, songSeed: 3, worldId: 'range', energyCurves: song.curves, tonalityTimeline: song.tonalityTimeline,
    conductorCues: { liveCues: song.liveCues }, outputLatencyMs: () => latencyMs,
  });
  return s;
}

function musicalState(s) {
  return {
    heard: s.heardTimeMs,
    calm: s.calm.level,
    hypeFast: s.hype.fast, hypeSlow: s.hype.slow, surge: s.hype.surge, dropAtMs: s.hype.dropAtMs,
    valence: s.vibe.valence, epic: s.vibe.epic, tonic: s.vibe.tonic, tonicConfidence: s.vibe.tonicConfidence,
    keyTonic: s.keyDirector.tonic, rotation: s.keyDirector.paletteRotation,
    keyChanges: s.keyDirector.lastKeyChange ? s.keyDirector.lastKeyChange.to : null,
    unravel: s.coda.unravel, weather: s.weather.kind, weatherIntensity: s.weather.intensity,
    opening: s.opening.gain, orogeny: s.orogeny.growth,
    ringU: s.hype.ringU(s.heardTimeMs),
  };
}

function closeTo(a, b, label) {
  for (const k of Object.keys(a)) {
    if (typeof a[k] === 'number' && Number.isFinite(a[k])) {
      assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${label}: ${k} ${a[k]} vs ${b[k]}`);
    } else {
      assert.deepEqual(a[k], b[k], `${label}: ${k}`);
    }
  }
}

test('calm, hype, vibe, key and coda agree at the same heard time through any output latency', () => {
  const direct = performance(0), late = performance(300);
  const dt = 1000 / 60;
  let audioDirect = 0, audioLate = 0;
  direct.conductor.on('*', () => audioDirect++);
  late.conductor.on('*', () => audioLate++);
  // The pairs from the plan: (900, 0) and (1200, 300) are the same heard 900.
  const steps = Math.round(4000 / dt);
  for (let i = 0; i <= steps; i++) {
    const heard = i * dt;
    direct.step(dt, heard);
    late.step(dt, heard + 300);
    if (Math.abs(heard - 900) < dt / 2 || i % 30 === 0) {
      closeTo(musicalState(direct), musicalState(late), `heard ${heard.toFixed(0)}ms`);
    }
  }
  const a = musicalState(direct);
  assert.ok(Math.abs(a.dropAtMs - 1000) < dt && a.tonic === 9, 'the transitions really happened in this window');
  // Audio scheduling stays on source time: the late output has dispatched
  // further ahead, by exactly its latency.
  assert.ok(audioLate > audioDirect, 'audio dispatch is not delayed by visual compensation');
  direct.dispose(); late.dispose();
});

test('just before the transition is heard, the late output has not reacted yet', () => {
  const direct = performance(0), late = performance(300);
  const dt = 1000 / 60;
  for (let heard = 0; heard <= 900; heard += dt) { direct.step(dt, heard); late.step(dt, heard + 300); }
  // Source 1200 is past every transition at 1000; heard 900 is not.
  assert.equal(late.hype.dropAtMs, -Infinity, 'no drop ring before the drop is heard');
  assert.equal(late.vibe.tonic, 0, 'the key has not changed before it is heard');
  assert.ok(late.hype.fast < .2, `the loud burst is not yet in the envelope: ${late.hype.fast}`);
  direct.dispose(); late.dispose();
});

test('latency readings are clamped and heard time never goes negative at song start', () => {
  const huge = performance(5000), negative = performance(-200);
  huge.step(16, 100);
  negative.step(16, 100);
  assert.equal(huge.visualLagMs, 350, 'clamped to the compensation ceiling');
  assert.equal(huge.heardTimeMs, 0);
  assert.equal(negative.visualLagMs, 0);
  assert.equal(negative.heardTimeMs, 100);
  for (const s of [huge, negative]) {
    for (const v of [s.calm.level, s.hype.fast, s.vibe.valence, s.vibe.epic, s.coda.unravel]) assert.ok(Number.isFinite(v));
    s.dispose();
  }
});

test('a seek starts cues and the seeded envelope at the heard moment', () => {
  const late = performance(300);
  late.startAt(1150); // heard 850: the 1000ms drop cue is still ahead
  assert.equal(late.heardTimeMs, 850);
  assert.equal(late.hype.dropAtMs, -Infinity);
  const dt = 1000 / 60;
  for (let t = 1150; t <= 1400; t += dt) late.step(dt, t);
  assert.ok(Math.abs(late.hype.dropAtMs - 1000) < dt + 1e-9, `the cued drop fires when heard: ${late.hype.dropAtMs}`);
  late.dispose();
});
