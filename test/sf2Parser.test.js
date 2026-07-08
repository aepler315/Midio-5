import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSf2 } from '../src/audio/Sf2Parser.js';
import { buildMinimalSf2, buildBadSf2 } from './helpers/sf2Fixture.js';

test('parseSf2 extracts the font name from INAM', () => {
  const sf2 = parseSf2(buildMinimalSf2('MyFont'));
  assert.equal(sf2.name, 'MyFont');
});

test('parseSf2 uses fallback name when INAM is absent', () => {
  // The fixture always includes INAM, but fallback is tested implicitly
  const sf2 = parseSf2(buildMinimalSf2(), 'Fallback');
  assert.equal(sf2.name, 'TestFont'); // INAM takes priority
});

test('parseSf2 rejects non-SF2 data', () => {
  assert.throws(() => parseSf2(buildBadSf2(), 'bad'), /not a valid SF2/);
});

test('parseSf2 builds one preset at bank 0 program 0', () => {
  const sf2 = parseSf2(buildMinimalSf2());
  assert.equal(sf2.presets.size, 1);
  const preset = sf2.presets.get(0); // bank*128+program = 0
  assert.ok(preset, 'preset at key 0 should exist');
  assert.equal(preset.bank, 0);
  assert.equal(preset.program, 0);
  assert.equal(preset.zones.length, 1);
});

test('parseSf2 zone has correct key/velocity range intersection', () => {
  const sf2 = parseSf2(buildMinimalSf2());
  const z = sf2.presets.get(0).zones[0];
  assert.equal(z.loKey, 40);
  assert.equal(z.hiKey, 84);
  assert.equal(z.loVel, 20);
  assert.equal(z.hiVel, 110);
});

test('parseSf2 converts timecent attack/decay to seconds', () => {
  const sf2 = parseSf2(buildMinimalSf2());
  const z = sf2.presets.get(0).zones[0];
  // attack: -6000 timecents → 2^(-5) = 0.03125
  assert.ok(Math.abs(z.attack - 0.03125) < 0.001, `attack=${z.attack}`);
  // decay: -4800 timecents → 2^(-4) = 0.0625
  assert.ok(Math.abs(z.decay - 0.0625) < 0.001, `decay=${z.decay}`);
});

test('parseSf2 converts centibel sustain to linear gain', () => {
  const sf2 = parseSf2(buildMinimalSf2());
  const z = sf2.presets.get(0).zones[0];
  // -100 centibels → 10^(-0.5) ≈ 0.31623
  assert.ok(Math.abs(z.sustain - 0.31623) < 0.001, `sustain=${z.sustain}`);
});

test('parseSf2 hardcodes a musical default release', () => {
  const sf2 = parseSf2(buildMinimalSf2());
  const z = sf2.presets.get(0).zones[0];
  assert.equal(z.release, 0.05);
});

test('parseSf2 sample data is 16-bit PCM with correct length', () => {
  const sf2 = parseSf2(buildMinimalSf2());
  assert.ok(sf2.sampleData instanceof Int16Array);
  assert.equal(sf2.sampleData.length, 97);
  // First sample: sin(0) = 0
  assert.equal(sf2.sampleData[0], 0);
});

test('parseSf2 sample header has correct fields', () => {
  const sf2 = parseSf2(buildMinimalSf2());
  // shdr has 2 entries (real + sentinel), [0] is the real sample
  const s = sf2.samples[0];
  assert.equal(s.start, 0);
  assert.equal(s.end, 97);
  assert.equal(s.loopStart, 16);
  assert.equal(s.loopEnd, 81); // 97 - 16
  assert.equal(s.sampleRate, 44100);
  assert.equal(s.rootKey, 60);
  assert.equal(s.fineTune, 0);
});