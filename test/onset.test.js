import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRhythmOnsets, estimateTempo, extractPseudoLane } from '../src/audio/OnsetDetector.js';
import { Role } from '../src/core/NoteEvent.js';

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
