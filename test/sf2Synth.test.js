import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sf2Synth } from '../src/audio/Sf2Synth.js';
import { Role } from '../src/core/NoteEvent.js';

// _findPreset only touches this.sf2.presets — no AudioContext needed, so it's
// unit-testable in Node directly (Sf2Synth's constructor never touches `ae`).
function synthWithPresets(entries) {
  const synth = new Sf2Synth({});
  synth.sf2 = { presets: new Map(entries) };
  return synth;
}

const presetKey = (bank, program) => bank * 128 + program;
const fakePreset = (bank, program) => ({ bank, program, zones: [] });

test('a real MIDI program on a bank-0 preset is preferred over the role default', () => {
  const synth = synthWithPresets([
    [presetKey(0, 40), fakePreset(0, 40)],   // Violin — the MIDI's real instrument
    [presetKey(0, 0), fakePreset(0, 0)],     // role default (Acoustic Grand Piano)
  ]);
  const preset = synth._findPreset(Role.MELODY, 40);
  assert.equal(preset.program, 40);
});

test('an unknown program (-1) falls back to the role default preset', () => {
  const synth = synthWithPresets([
    [presetKey(0, 0), fakePreset(0, 0)],
    [presetKey(0, 89), fakePreset(0, 89)],
  ]);
  const preset = synth._findPreset(Role.PAD, -1);
  assert.equal(preset.program, 89); // ROLE_PROGRAMS[PAD] = program 89
});

test('a real program the loaded font does not have falls back to the role default', () => {
  const synth = synthWithPresets([
    [presetKey(0, 33), fakePreset(0, 33)], // role default for BASS
  ]);
  const preset = synth._findPreset(Role.BASS, 200); // font has no program 200
  assert.equal(preset.program, 33);
});

test('RHYTHM always resolves in bank 128, honoring the specific drum-kit variant', () => {
  const synth = synthWithPresets([
    [presetKey(128, 0), fakePreset(128, 0)],   // Standard Kit
    [presetKey(128, 16), fakePreset(128, 16)], // Power Kit
    [presetKey(0, 40), fakePreset(0, 40)],     // decoy — must never be picked for RHYTHM
  ]);
  const power = synth._findPreset(Role.RHYTHM, 16);
  assert.equal(power.bank, 128);
  assert.equal(power.program, 16);
});

test('RHYTHM with no program info falls back to the standard kit (bank 128, program 0)', () => {
  const synth = synthWithPresets([
    [presetKey(128, 0), fakePreset(128, 0)],
  ]);
  const preset = synth._findPreset(Role.RHYTHM, -1);
  assert.equal(preset.bank, 128);
  assert.equal(preset.program, 0);
});

test('RHYTHM with an unavailable kit variant falls back to the standard kit', () => {
  const synth = synthWithPresets([
    [presetKey(128, 0), fakePreset(128, 0)],
  ]);
  const preset = synth._findPreset(Role.RHYTHM, 99); // font has no kit 99
  assert.equal(preset.bank, 128);
  assert.equal(preset.program, 0);
});

test('a font with nothing at all resolves to null rather than throwing', () => {
  const synth = synthWithPresets([]);
  assert.equal(synth._findPreset(Role.MELODY, 40), null);
  assert.equal(synth._findPreset(Role.RHYTHM, -1), null);
});

test('an unrecognized role falls back to the MELODY default', () => {
  const synth = synthWithPresets([
    [presetKey(0, 0), fakePreset(0, 0)],
  ]);
  const preset = synth._findPreset('NOT_A_ROLE', -1);
  assert.equal(preset.program, 0);
});
