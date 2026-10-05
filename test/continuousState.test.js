// Task 11, continuity half: what a performance carries across a rebuild.
//
// Three rebuilds happen while a song plays -- a seek, a replay, and the
// whole-song analysis replacing the opening mid-song. Each builds a new
// Simulation. These tests hold the contract in src/sim/ContinuousState.js:
//   - seek/replay reconstructs the continuous directors from the song's
//     start, on playback's fixed step, so the destination shows the state a
//     played-through performance had at the same heard moment;
//   - nothing one-shot that happened on the way is emitted at the
//     destination;
//   - adoption carries the on-screen state across exactly, then eases to the
//     new analysis at the directors' own rates;
//   - the storm envelope is handed over, not jumped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { Conductor } from '../src/core/Conductor.js';
import { Simulation } from '../src/sim/Simulation.js';
import { ParamBus } from '../src/core/ParamBus.js';
import { EnergyCurves } from '../src/audio/EnergyCurves.js';
import { Role, makeNoteEvent } from '../src/core/NoteEvent.js';
import {
  CONTINUOUS_CHANNELS, RECONSTRUCT_STEP_MS, captureContinuous, restoreContinuous, reconstructContinuous,
} from '../src/sim/ContinuousState.js';
import { compileStorm, stormAt, STORM_HANDOFF_MS } from '../src/world/alpine/RangeStorm.js';
import { mainFunctions } from './helpers/mainSource.js';

const STEP = RECONSTRUCT_STEP_MS;

// A song with something happening in every continuous channel: a quiet
// opening, a loud passage with a cued drop and calm, a key change, a quiet
// release, and a late swell. Long enough for the opening director to commit
// and the weather to evaluate more than once.
function song({ durationMs = 40000, loud = .9 } = {}) {
  const curves = new EnergyCurves(durationMs);
  for (let i = 0; i < curves.n; i++) {
    const t = i * 1000 / curves.rateHz;
    const e = t < 3000 ? .05 : t < 14000 ? loud : t < 24000 ? .15 : .6 + .3 * Math.sin(t / 900);
    curves.setFrame(i, Array(7).fill(e));
  }
  const timeline = [];
  for (let t = 0; t < durationMs; t += 250) {
    timeline.push(makeNoteEvent({ tMs: t, pitch: 36, vel: .8, role: Role.RHYTHM, kick: true, src: 'midi' }));
    timeline.push(makeNoteEvent({ tMs: t + 10, pitch: (t < 9000 ? 60 : 69) + [0, 4, 7][(t / 250) % 3], vel: .7, role: Role.MELODY, src: 'midi' }));
  }
  const tonalityTimeline = [
    { tMs: 0, tonic: 0, mode: 'major', majorness: .6, confidence: .9 },
    { tMs: 9000, tonic: 9, mode: 'minor', majorness: -.6, confidence: .9 },
  ];
  const liveCues = [
    { tMs: 3000, kind: 'drop', value: 1 },
    { tMs: 3000, kind: 'calm', value: .5 },
    { tMs: 16000, kind: 'weather', value: 'rain' },
  ];
  return { curves, timeline, tonalityTimeline, liveCues, durationMs };
}

function build(s, latencyMs = 0) {
  const c = new Conductor();
  c.load({ timeline: s.timeline, durationMs: s.durationMs, barGrid: [], bpm: 240, confidence: .9, firstBarMs: 0 });
  const sim = new Simulation(c, new ParamBus(), {
    bpm: 240, songSeed: 3, worldId: 'range', energyCurves: s.curves, tonalityTimeline: s.tonalityTimeline,
    conductorCues: { liveCues: s.liveCues }, outputLatencyMs: () => latencyMs,
  });
  // Background silhouette baking needs a canvas and has nothing to do with
  // musical state (as in landscapePresentation.test.js).
  sim.biomes.pumpStripPrewarm = () => {};
  return sim;
}

/** Play a performance from the start on playback's fixed step (main.js frame()). */
function playTo(sim, toMs) {
  let t = 0;
  while (t < toMs - 1e-6) {
    const next = Math.min(toMs, t + STEP);
    sim.step(next - t, next);
    t = next;
  }
}

// Every continuous channel, as the eye reads it. One-shots (the drop ring,
// a key-change wave) are compared separately.
function continuous(sim) {
  return {
    calm: sim.calm.level, calmG: sim.calm.G,
    hypeFast: sim.hype.fast, hypeSlow: sim.hype.slow, surge: sim.hype.surge, buildUp: sim.hype.buildUp, drops: sim.hype.dropCount,
    valence: sim.vibe.valence, epic: sim.vibe.epic, tonic: sim.vibe.tonic, tonicConfidence: sim.vibe.tonicConfidence,
    keyTonic: sim.keyDirector.tonic, rotation: sim.keyDirector.paletteRotation,
    lastKeyTo: sim.keyDirector.lastKeyChange?.to ?? null,
    weather: sim.weather.kind, weatherIntensity: sim.weather.intensity, severity: sim.weather.severity,
    cover: sim.weather.groundCover, dryness: sim.weather.dryness01, rain: sim.weather.rainAccum01,
    openingGain: sim.opening.gain, holding: sim.opening.holding,
    unravel: sim.coda.unravel,
    lyricIntensity: sim.biomes.lyricIntensityEased, kindConfidence: sim.biomes.kindConfidenceEased,
  };
}

function assertClose(a, b, label, tol = 1e-9) {
  for (const k of Object.keys(a)) {
    if (typeof a[k] === 'number' && Number.isFinite(a[k])) {
      // Relative to the magnitude for values beyond 1 (palette rotation is
      // in degrees).
      assert.ok(Math.abs(a[k] - b[k]) <= tol * Math.max(1, Math.abs(a[k]), Math.abs(b[k])), `${label}: ${k} ${a[k]} vs ${b[k]}`);
    } else {
      assert.deepEqual(a[k], b[k], `${label}: ${k}`);
    }
  }
}

// --- Seek / replay: reconstruction ------------------------------------------

test('a seek shows the continuous state the played-through song had at that heard moment', () => {
  const s = song();
  for (const at of [2000, 3100, 9500, 15000, 26000, 31000]) {
    const played = build(s), seeked = build(s);
    playTo(played, at);
    seeked.startAt(at);
    assertClose(continuous(seeked), continuous(played), `seek to ${at}`);
    // The destination is really a different moment from a fresh scene: the
    // old seek reset these to construction defaults.
    if (at >= 15000) {
      const fresh = build(s);
      assert.notEqual(continuous(fresh).weather === continuous(played).weather
        && Math.abs(fresh.calm.level - played.calm.level) < 1e-6
        && Math.abs(fresh.vibe.valence - played.vibe.valence) < 1e-6, true, `${at}: something continuous had moved`);
      fresh.dispose();
    }
    played.dispose(); seeked.dispose();
  }
});

test('equal heard time reconstructs equal state through any output latency', () => {
  const s = song();
  const direct = build(s, 0), late = build(s, 300);
  direct.startAt(15000);
  late.startAt(15300);
  assert.equal(late.heardTimeMs, 15000);
  // Reconstruction on the late output runs 300 ms of steps at heard time 0
  // first (heard time never goes negative), exactly as its playback did. A
  // director with a time constant still remembers those steps, so compare
  // the late seek against the late output's own playback, and both outputs
  // against each other with the tolerance that remainder allows.
  const latePlayed = build(s, 300);
  playTo(latePlayed, 15300);
  assertClose(continuous(late), continuous(latePlayed), 'late output: seek vs playback');
  assertClose(continuous(late), continuous(direct), 'same heard moment, different latency', 5e-3);
  direct.dispose(); late.dispose(); latePlayed.dispose();
});

test('a seek does not emit the one-shots it passed on the way', () => {
  const s = song();
  const seeked = build(s);
  // Just after the cued drop (3000) and inside the key-change wave window
  // after the modulation at 9000 is confirmed.
  seeked.startAt(3200);
  assert.equal(seeked.hype.dropAtMs, -Infinity, 'no drop ring replayed');
  assert.equal(seeked.hype.ringU(seeked.heardTimeMs), null);
  assert.equal(seeked.hype.slam, 0);
  assert.ok(seeked.hype.surge > .5, `but the surge envelope the drop raised is there: ${seeked.hype.surge}`);
  assert.equal(seeked.hype.dropCount, 1, 'the drop is part of the song so far');
  seeked.dispose();

  const after = build(s);
  after.startAt(12500);
  assert.equal(after.keyDirector.lastKeyChange?.to, 9, 'the key change happened before the destination');
  assert.equal(after.keyDirector.justKeyChange, false);
  assert.equal(after.keyDirector.transitionActive, false, 'its wave is not replayed');
  let waves = 0;
  for (let t = 12500; t < 14000; t += STEP) { after.step(STEP, t); if (after.keyDirector.justKeyChange) waves++; }
  assert.equal(waves, 0, 'and it does not fire late either');
  assert.equal(after.keyDirector.paletteRotation !== 0, true, 'the palette already sits in the new key');
  after.dispose();
});

test('cues on the way change continuous state; one-shot cues are skipped', () => {
  const s = song();
  s.liveCues.push({ tMs: 4000, kind: 'lightning', value: 1 }, { tMs: 4000, kind: 'shake', value: 1 },
    { tMs: 4000, kind: 'meteors', value: 1 }, { tMs: 4000, kind: 'ground_pulse', value: 1 });
  const sim = build(s);
  let lightning = 0, meteors = 0, shakes = 0, pulses = 0;
  sim.biomes.cueLightning = () => lightning++;
  sim.biomes.cueMeteors = () => meteors++;
  sim.camera.shake = () => shakes++;
  sim.groundField.impulse = () => pulses++;
  // Reconstruction alone (startAt's own first frame also lets kick
  // listeners shake the camera, which is not a replayed cue).
  reconstructContinuous(sim, 17000);
  assert.deepEqual({ lightning, meteors, shakes, pulses }, { lightning: 0, meteors: 0, shakes: 0, pulses: 0 });
  assert.equal(sim.weather._pendingKind === 'rain' || sim.weather.kind === 'rain', true, 'the weather cue is part of the state');
  assert.ok(sim.calm.G !== 0 || sim.calm.level !== 1, 'the calm cue was applied');
  sim.dispose();
});

test('reconstruction lands exactly on the destination and its cost is bounded on a long recording', () => {
  // Ten minutes, dense: eight melodic notes and four kicks a second.
  const durationMs = 600000;
  const curves = new EnergyCurves(durationMs);
  for (let i = 0; i < curves.n; i++) curves.setFrame(i, Array(7).fill(.4 + .3 * Math.sin(i / 400)));
  const timeline = [];
  for (let t = 0; t < durationMs; t += 125) {
    timeline.push(makeNoteEvent({ tMs: t + 5, pitch: 60 + (t / 125) % 12, vel: .6, role: Role.MELODY, src: 'audio' }));
    if (t % 250 === 0) timeline.push(makeNoteEvent({ tMs: t, pitch: 36, vel: .8, role: Role.RHYTHM, kick: true, src: 'audio' }));
  }
  const s = { curves, timeline, tonalityTimeline: [], liveCues: [], durationMs };
  const sim = build(s);
  const t0 = performance.now();
  sim.startAt(590000.5);
  const elapsed = performance.now() - t0;
  assert.equal(sim.reconstructedSteps, Math.ceil(590000.5 / STEP));
  assert.equal(sim.heardTimeMs, 590000.5);
  // A seek near the end of a ten-minute song: a budget well under a second
  // on a CI runner (measured ~150-300 ms on a laptop-class CPU).
  assert.ok(elapsed < 2500, `reconstruction took ${elapsed.toFixed(0)} ms`);
  sim.dispose();
});

test('a replay from the start reconstructs nothing', () => {
  const sim = build(song());
  assert.equal(reconstructContinuous(sim, 0), 0);
  assert.equal(reconstructContinuous(sim, -5), 0);
  assert.equal(reconstructContinuous(null, 1000), 0);
  sim.dispose();
});

// --- Adoption: capture and restore ------------------------------------------

test('the channel inventory carries every continuous field of each director', () => {
  assert.deepEqual([...CONTINUOUS_CHANNELS].sort(), ['calm', 'hype', 'keyDirector', 'opening', 'vibe', 'weather']);
  const sim = build(song());
  playTo(sim, 12000);
  const state = captureContinuous(sim);
  // Contract: a number, boolean, string or plain record on a director is
  // carried unless it is listed as a one-shot or a cursor. A field added to a
  // director later is carried by default.
  const notCarried = {
    hype: ['slam'], vibe: ['_lo', '_hi'],
    keyDirector: ['justKeyChange', 'transitionActive', 'transitionProgress', '_waveStartMs'],
  };
  for (const name of CONTINUOUS_CHANNELS) {
    for (const [k, v] of Object.entries(sim[name])) {
      const scalar = ['number', 'boolean', 'string'].includes(typeof v) || v === null
        || (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype);
      if (!scalar) continue;
      if (notCarried[name]?.includes(k)) assert.equal(k in state.channels[name], false, `${name}.${k} is not carried`);
      else assert.ok(k in state.channels[name], `${name}.${k} is carried`);
    }
  }
  assert.ok(Number.isFinite(state.form.lyricIntensityEased) && Number.isFinite(state.form.kindConfidenceEased));
  // A captured state is a value: later play does not change it.
  const frozen = JSON.stringify(state);
  playTo(sim, 13000);
  assert.equal(JSON.stringify(state), frozen);
  sim.dispose();
});

test('adopting the whole-song analysis carries the on-screen state across exactly, then eases', () => {
  const opening = song({ loud: .9 });
  // The whole-song analysis hears the same recording differently: quieter,
  // with the key change placed elsewhere.
  const whole = song({ loud: .45 });
  whole.tonalityTimeline = [{ tMs: 0, tonic: 2, mode: 'major', majorness: .5, confidence: .9 }];
  const before = build(opening);
  playTo(before, 12000);
  const shown = continuous(before);
  const state = captureContinuous(before);

  const after = build(whole);
  after.startAt(12000, { continuous: state });
  assertClose(continuous(after), shown, 'at the adoption boundary');
  assert.equal(after.reconstructedSteps, undefined, 'a carried state is not recomputed from the new analysis');

  // Then each director moves toward the new analysis at its own rate: no
  // single step jumps, and the state does arrive somewhere new.
  let prev = continuous(after);
  for (let t = 12000 + STEP; t < 14000; t += STEP) {
    after.step(STEP, t);
    const now = continuous(after);
    for (const k of ['calm', 'hypeFast', 'hypeSlow', 'valence', 'epic', 'rotation', 'weatherIntensity', 'openingGain']) {
      assert.ok(Math.abs(now[k] - prev[k]) < .08, `${k} at ${t.toFixed(0)}: ${prev[k]} -> ${now[k]}`);
    }
    prev = now;
  }
  assert.ok(Math.abs(prev.hypeSlow - shown.hypeSlow) > .01, 'the new analysis is followed');
  before.dispose(); after.dispose();
});

test('a drop on screen at adoption keeps its ring and is not launched a second time', () => {
  const s = song();
  const before = build(s);
  playTo(before, 3300); // the cued drop at 3000 is 300 ms old
  assert.equal(before.hype.dropAtMs >= 3000 && before.hype.dropAtMs < 3000 + STEP, true);
  const after = build(s);
  after.startAt(3300, { continuous: captureContinuous(before) });
  assert.equal(after.hype.dropAtMs, before.hype.dropAtMs);
  assert.ok(after.hype.ringU(after.heardTimeMs) !== null, 'the ring in progress continues');
  let rings = 0;
  const excite = after.biomes.lakeRing.excite.bind(after.biomes.lakeRing);
  after.biomes.lakeRing.excite = (...a) => { rings++; return excite(...a); };
  for (let t = 3300 + STEP; t < 3600; t += STEP) after.step(STEP, t);
  assert.equal(rings, 0, 'BiomeManager saw this drop already: no second lake ring, meteors or wall');
  before.dispose(); after.dispose();
});

test('restoring ignores fields a director does not have and records of another shape', () => {
  const sim = build(song());
  assert.equal(restoreContinuous(sim, null), false);
  assert.equal(restoreContinuous(sim, { channels: { calm: { level: .25, notAField: 7 }, nope: { x: 1 } } }), true);
  assert.equal(sim.calm.level, .25);
  assert.equal('notAField' in sim.calm, false);
  sim.dispose();
});

// --- Storm envelope handoff -------------------------------------------------

function stormManager(curves, durationMs) {
  return { conductor: { timeline: [] }, energyCurves: curves, sections: [], durationMs, reducedFlash: false };
}

test('the storm envelope is held at adoption and eases to the whole song\'s storm', () => {
  const durationMs = 180000;
  // Opening analysis: the storm sits early. Whole song: it sits late.
  const early = new EnergyCurves(durationMs), late = new EnergyCurves(durationMs);
  for (let i = 0; i < early.n; i++) {
    const t = i * 1000 / early.rateHz;
    early.setFrame(i, Array(7).fill(t > 30000 && t < 60000 ? .95 : .1));
    late.setFrame(i, Array(7).fill(t > 120000 && t < 150000 ? .95 : .1));
  }
  const oldScore = compileStorm({ energyCurves: early, durationMs });
  const mgr = stormManager(late, durationMs);
  const at = 45000;
  assert.ok(oldScore.at(at).amount > .9, 'mid-storm on the opening\'s schedule');
  assert.ok(stormAt(mgr, at).amount < .05, 'the whole song has no storm here');
  mgr.stormHandoff = { score: oldScore, atMs: at, durationMs: STORM_HANDOFF_MS };

  assert.ok(Math.abs(stormAt(mgr, at).amount - oldScore.at(at).amount) < 1e-12, 'no jump at the boundary');
  let prev = stormAt(mgr, at);
  for (let t = at + 100; t <= at + STORM_HANDOFF_MS + 1000; t += 100) {
    const now = stormAt(mgr, t);
    assert.ok(Math.abs(now.amount - prev.amount) < .05, `amount at ${t}: ${prev.amount} -> ${now.amount}`);
    assert.ok(Math.abs(now.wet01 - prev.wet01) < .05, `wet at ${t}`);
    prev = now;
  }
  const settled = stormAt(mgr, at + STORM_HANDOFF_MS + 1000);
  const own = compileStorm({ energyCurves: late, durationMs }).at(at + STORM_HANDOFF_MS + 1000);
  assert.deepEqual(settled, own, 'after the handoff the whole song\'s storm alone');
});

test('lightning during a storm handoff comes from the new score only', () => {
  const durationMs = 180000;
  const curves = new EnergyCurves(durationMs);
  for (let i = 0; i < curves.n; i++) curves.setFrame(i, Array(7).fill(.1));
  const snare = (tMs) => ({ tMs, role: 'RHYTHM', pitch: 38, vel: 1 });
  const loud = new EnergyCurves(durationMs);
  for (let i = 0; i < loud.n; i++) loud.setFrame(i, Array(7).fill(i * 1000 / loud.rateHz < 60000 ? .9 : .1));
  const oldScore = compileStorm({ energyCurves: loud, durationMs, timeline: [snare(40000), snare(41000)] });
  assert.ok(oldScore.at(40050).flash > 0, 'the old score strikes at 40 s');
  const mgr = stormManager(curves, durationMs);
  mgr.stormHandoff = { score: oldScore, atMs: 39000, durationMs: STORM_HANDOFF_MS };
  assert.equal(stormAt(mgr, 40050).flash, 0, 'that stroke is not replayed into the new performance');
  assert.ok(stormAt(mgr, 40050).amount > .5, 'while the clouds it built are held');
});

// --- main.js: the adoption wiring --------------------------------------------

test('main.js adoption hands the captured state and the storm to the rebuilt performance', () => {
  const s = song();
  const sim = build(s);
  playTo(sim, 12000);
  const calls = [];
  const context = vm.createContext({
    captureContinuous, stormScoreFor: () => ({ at: () => ({ amount: .7 }) }), STORM_HANDOFF_MS,
    running: true, sim, bulkExportArmed: false, paused: false,
    audioEngine: { nowMs: 12000 }, lastTimelineData: null,
    // A previous start left this behind; it must not erase the capture.
    lastStartExtra: { continuousState: null, worldId: 'range' },
    startTimeline(data, extra) {
      calls.push(extra);
      context.sim = { biomes: {} };
    },
    updatePauseButtonUI() {}, renderer: { draw() {} },
  });
  vm.runInContext(mainFunctions(['adoptFullAnalysisLive']), context);
  const data = { durationMs: s.durationMs };
  context.lastTimelineData = data;
  context.adoptFullAnalysisLive(data);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].continuousState, 'the captured state reaches startTimeline');
  assert.equal(calls[0].continuousState.channels.calm.level, sim.calm.level);
  assert.equal(calls[0].worldId, 'range');
  assert.equal(context.sim.biomes.stormHandoff.atMs, sim.heardTimeMs);
  assert.equal(context.sim.biomes.stormHandoff.durationMs, STORM_HANDOFF_MS);
  sim.dispose();
});
