import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectRhythmOnsets, estimateTempo, extractPseudoLane, estimateSustainMs, mixBandEnvelopes,
  globalBandReferences, normalizeBands,
} from '../src/audio/OnsetDetector.js';
import { Role } from '../src/core/NoteEvent.js';
import { clamp } from '../src/utils/math.js';

function silentBands(n) {
  return Array.from({ length: 7 }, () => new Float32Array(n));
}

test('detectRhythmOnsets finds periodic kicks and hats, classified correctly', () => {
  const rate = 86;
  const n = Math.round(rate * 8);
  const bands = silentBands(n);
  const periodFrames = Math.round(rate * 0.5); // 500ms period

  const kickFrames = [];
  for (let f = 0; f < n; f += periodFrames) {
    bands[0][f] = 0.9; bands[1][f] = 0.6;
    kickFrames.push(f);
  }
  const hatFrames = [];
  for (let f = Math.round(periodFrames / 2); f < n; f += periodFrames) {
    bands[5][f] = 0.7; bands[6][f] = 0.5;
    hatFrames.push(f);
  }

  const { onsets } = detectRhythmOnsets(bands, bands, rate, 1);
  const kicks = onsets.filter((o) => o.kick);
  const hats = onsets.filter((o) => o.type === 'HAT');

  assert.ok(kicks.length >= kickFrames.length - 2, `expected ~${kickFrames.length} kicks, got ${kicks.length}`);
  for (const k of kicks) assert.equal(k.pitch, 36);
  assert.ok(hats.length >= hatFrames.length - 2, `expected ~${hatFrames.length} hats, got ${hats.length}`);
  for (const h of hats) assert.equal(h.pitch, 42);
});

test('estimateTempo recovers BPM and a confident score from a periodic onset envelope', () => {
  const rate = 86;
  const bpmTrue = 128;
  const periodFrames = Math.round((rate * 60) / bpmTrue);
  const n = rate * 20;
  const O = new Float32Array(n);
  const kickFrames = [];
  for (let f = 0; f < n; f += periodFrames) { O[f] = 1; kickFrames.push(f); }

  const tempo = estimateTempo(O, rate, kickFrames);
  assert.ok(Math.abs(tempo.bpm - bpmTrue) < 3, `expected ~${bpmTrue}bpm, got ${tempo.bpm}`);
  assert.ok(tempo.confidence > 0.25, `expected confident tempo, got ${tempo.confidence}`);
  assert.equal(tempo.freeTime, false);
});

test('estimateTempo reports low confidence / freeTime on pure noise', () => {
  const rate = 86;
  const n = rate * 10;
  let seed = 42;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const O = Float32Array.from({ length: n }, () => rand());
  const tempo = estimateTempo(O, rate, []);
  assert.ok(tempo.confidence < 0.6); // noise shouldn't produce a strongly confident periodicity
});

test('extractPseudoLane emits MELODY notes from a varying MID band', () => {
  const rate = 86;
  const n = rate * 6;
  const bands = silentBands(n);
  for (let f = 0; f < n; f += Math.round(rate * 0.4)) {
    bands[3][f] = 0.8;
    bands[2][f] = 0.2;
    bands[4][f] = 0.4;
  }
  const notes = extractPseudoLane(bands, rate, { bandIndices: [2, 3, 4], pitchLo: 60, pitchHi: 96, role: Role.MELODY });
  assert.ok(notes.length > 3);
  for (const n2 of notes) {
    assert.ok(n2.pitch >= 60 && n2.pitch <= 96);
    assert.equal(n2.role, Role.MELODY);
  }
});

test('extractPseudoLane events carry their analysis frame for downstream pitch/duration refinement', () => {
  const rate = 86;
  const n = rate * 4;
  const bands = silentBands(n);
  for (let f = 0; f < n; f += Math.round(rate * 0.5)) bands[3][f] = 0.9;
  const notes = extractPseudoLane(bands, rate, { bandIndices: [2, 3, 4], pitchLo: 60, pitchHi: 96, role: Role.MELODY });
  assert.ok(notes.length > 0);
  for (const note of notes) {
    assert.ok(Number.isInteger(note.frame) && note.frame >= 0 && note.frame < n);
    assert.ok(Math.abs((note.frame / rate) * 1000 - note.tMs) < 1e-6, 'frame and tMs must agree');
  }
});

test('estimateSustainMs: a long plateau sustains, a transient spike stays near the floor, both clamped', () => {
  const rate = 86;
  const env = new Float32Array(rate * 4);
  // A 1s plateau starting at frame 43 (0.5s), then silence.
  for (let f = 43; f < 43 + rate; f++) env[f] = 0.8;
  const sustained = estimateSustainMs(env, rate, 43);
  assert.ok(Math.abs(sustained - 1000) < 120, `expected ~1000ms sustain, got ${sustained}`);

  // A single-frame spike.
  const spikeEnv = new Float32Array(rate * 2);
  spikeEnv[20] = 0.9;
  assert.equal(estimateSustainMs(spikeEnv, rate, 20), 120, 'a transient clamps to the minimum');

  // A plateau longer than the cap clamps to maxMs.
  const wall = new Float32Array(rate * 6);
  wall.fill(0.7);
  assert.equal(estimateSustainMs(wall, rate, 0), 1600);
});

test('mixBandEnvelopes averages exactly the requested bands', () => {
  const bands = silentBands(10);
  bands[2].fill(0.4);
  bands[3].fill(0.8);
  const mix = mixBandEnvelopes(bands, [2, 3]);
  for (const v of mix) assert.ok(Math.abs(v - 0.6) < 1e-6);
});

// --- True dynamics for EnergyCurves (globalBandReferences) ---------------

test('globalBandReferences: a band that only ever whispers gets a real (not full-scale) reference', () => {
  const rate = 86;
  const n = rate * 10;
  const loud = new Float32Array(n).fill(0.8); // one band roars the whole time
  const quiet = new Float32Array(n).fill(0.05); // another only ever whispers
  const [refLoud, refQuiet] = globalBandReferences([loud, quiet]);
  assert.ok(Math.abs(refLoud - 0.8) < 0.05, `expected the loud band's own reference near its true level, got ${refLoud}`);
  // Floored at 25% of the loudest band's reference -- not left to read its
  // own whisper as "full scale for this band".
  assert.ok(Math.abs(refQuiet - 0.25 * refLoud) < 0.01, `expected the sparse-band floor, got ${refQuiet}`);
});

test('globalBandReferences: the reference tracks the true 95th-percentile level, not a decayed max', () => {
  const rate = 86;
  const env = new Float32Array(rate * 20);
  for (let i = 0; i < env.length; i++) env[i] = i < rate * 15 ? 0.1 : 0.9; // quiet 15s, then loud
  const [ref] = globalBandReferences([env]);
  assert.ok(ref > 0.8, `expected the reference to reflect the loud stretch's true level, got ${ref}`);
});

test('quiet-intro / loud-chorus: EnergyCurves built from raw+reference reads them proportionally, unlike an AGC-normalized fill', () => {
  const rate = 86;
  const introFrames = rate * 15, chorusFrames = rate * 15;
  const raw = [new Float32Array(introFrames + chorusFrames)];
  for (let i = 0; i < introFrames; i++) raw[0][i] = 0.05; // a real whisper
  for (let i = introFrames; i < raw[0].length; i++) raw[0][i] = 0.9; // a real wall of sound
  const normAgc = normalizeBands(raw, rate); // the OLD path's per-band running-max AGC

  const [ref] = globalBandReferences(raw);
  const trueIntro = clamp(raw[0][10] / ref, 0, 1);
  const trueChorus = clamp(raw[0][introFrames + 10] / ref, 0, 1);
  assert.ok(trueChorus > trueIntro * 5, `true dynamics: chorus (${trueChorus}) must read far louder than the intro (${trueIntro})`);

  // The AGC path is exactly the failure mode this replaces: both sections
  // normalize toward 1 against their OWN local follower, erasing the gap
  // true dynamics preserve.
  const agcIntro = normAgc[0][introFrames - 10];
  const agcChorus = normAgc[0][introFrames + rate * 5]; // well after the AGC has caught up to the louder section
  assert.ok(agcIntro > 0.5, `AGC: the intro alone should have decayed its own follower down to near its own peak, got ${agcIntro}`);
  assert.ok(Math.abs(agcChorus - agcIntro) < 0.5, `AGC: intro and chorus should read similarly against their own local followers, got intro ${agcIntro} vs chorus ${agcChorus}`);
});
