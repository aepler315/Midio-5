import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSf2 } from '../src/audio/Sf2Parser.js';
import { buildTestSf2, FIXTURE_SAMPLE_COUNT } from './helpers/sf2Fixture.js';

test('parseSf2 reads the INAM name', () => {
  const font = parseSf2(buildTestSf2(), 'fallback');
  assert.equal(font.name, 'TestFont');
});

test('parseSf2 falls back to the given name when INAM is absent', () => {
  // Chop the INFO list out by rebuilding? Simpler: a fresh buffer with the
  // INAM bytes blanked still has the chunk, so instead verify the fallback
  // path via the API contract: an empty INAM would trim to '' and fall back.
  const buf = buildTestSf2();
  const bytes = new Uint8Array(buf);
  // INAM content = 'TestFont\0\0' -- find and zero it.
  const idx = new TextDecoder().decode(bytes).indexOf('TestFont');
  bytes.fill(0, idx, idx + 8);
  const font = parseSf2(buf, 'fallback');
  assert.equal(font.name, 'fallback');
});

test('parseSf2 reads sample headers and pops the EOS terminal', () => {
  const font = parseSf2(buildTestSf2());
  assert.equal(font.samples.length, 1);
  const s = font.samples[0];
  assert.equal(s.name, 'Sine0');
  assert.equal(s.start, 0);
  assert.equal(s.end, FIXTURE_SAMPLE_COUNT);
  assert.equal(s.loopStart, 8);
  assert.equal(s.loopEnd, 56);
  assert.equal(s.sampleRate, 22050);
  assert.equal(s.originalKey, 60);
  assert.equal(s.correction, -5);
});

test('parseSf2 exposes the 16-bit sample pool', () => {
  const font = parseSf2(buildTestSf2());
  assert.equal(font.sampleData.length, FIXTURE_SAMPLE_COUNT);
  const expected3 = Math.round(Math.sin((3 / FIXTURE_SAMPLE_COUNT) * Math.PI * 8) * 12000);
  assert.equal(font.sampleData[3], expected3);
  assert.ok(font.sampleData.some((v) => v > 8000), 'sine peaks present');
});

test('parseSf2 flattens preset zones: range intersect + tuning add + global fold', () => {
  const font = parseSf2(buildTestSf2());
  const piano = font.presets.get(0); // bank 0, program 0
  assert.ok(piano, 'piano preset present');
  assert.equal(piano.name, 'Piano Test');
  assert.equal(piano.zones.length, 2);

  const [a, b] = piano.zones;
  // Zone A: inst 40..80 intersect preset 60..100 -> 60..80.
  assert.equal(a.keyLo, 60);
  assert.equal(a.keyHi, 80);
  assert.equal(a.velLo, 0);
  assert.equal(a.velHi, 127);
  // Preset fine (+10) adds onto instrument fine (+5).
  assert.equal(a.fine, 15);
  assert.equal(a.modes, 0);
  // Global instrument zone's release (1200 timecents = 2s) folded in.
  assert.ok(Math.abs(a.release - 2) < 1e-9, `release ${a.release}`);
  // Untouched defaults survive.
  assert.ok(Math.abs(a.attack - 0.002) < 1e-9);
  assert.equal(a.sustain, 1);
  assert.equal(a.sampleIdx, 0);

  // Zone B: inst 81..127 intersect preset 60..100 -> 81..100, looped.
  assert.equal(b.keyLo, 81);
  assert.equal(b.keyHi, 100);
  assert.equal(b.fine, 10); // inst zone B has no fine of its own
  assert.equal(b.modes, 1);
  assert.ok(Math.abs(b.release - 2) < 1e-9);
});

test('parseSf2 keys drum presets by bank 128', () => {
  const font = parseSf2(buildTestSf2());
  const drums = font.presets.get(128 * 128 + 0);
  assert.ok(drums, 'bank-128 preset present');
  assert.equal(drums.name, 'Drums Test');
  // Full-range preset zone intersects both instrument zones unchanged.
  assert.equal(drums.zones.length, 2);
  assert.equal(drums.zones[0].keyLo, 40);
  assert.equal(drums.zones[0].keyHi, 80);
  assert.equal(drums.zones[0].fine, 5);
  assert.equal(drums.zones[1].keyLo, 81);
  assert.equal(drums.zones[1].keyHi, 127);
});

test('parseSf2 rejects non-sf2 buffers', () => {
  assert.throws(() => parseSf2(new ArrayBuffer(64)), /not an sf2/);
  // A valid RIFF/sfbk shell with no chunks is missing everything.
  const shell = new Uint8Array(12);
  shell.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  new DataView(shell.buffer).setUint32(4, 4, true);
  shell.set([0x73, 0x66, 0x62, 0x6b], 8); // sfbk
  assert.throws(() => parseSf2(shell.buffer), /missing/);
});
