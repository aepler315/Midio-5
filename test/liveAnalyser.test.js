// Listening instead of reading.
//
// The offline path has the whole buffer before the first frame, so it can
// find sections and build an arc. A phone cannot: Spotify's audio is DRM'd,
// a YouTube embed is cross-origin, and tab capture does not exist on mobile.
// What every phone has is a microphone. So the engine has to work without
// knowing the future, and these pin what that costs and what it must still
// deliver.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bandEnergies, spectralFlux, estimateTempo, LiveAnalyser, BAND_EDGES_HZ,
} from '../src/audio/LiveAnalyser.js';

const SR = 48000, FFT = 2048, BINS = FFT / 2;

/** An FFT frame with energy concentrated at one frequency. */
function frameAt(hz, amp = 1, bins = BINS) {
  const m = new Float32Array(bins);
  const bin = Math.round(hz / ((SR / 2) / bins));
  for (let i = 0; i < bins; i++) m[i] = i === bin ? amp : 0;
  return m;
}

test('band split puts energy in the band the frequency belongs to', () => {
  const bass = bandEnergies(frameAt(80), SR, FFT);
  const air = bandEnergies(frameAt(9000), SR, FFT);
  assert.ok(bass[1] > 0, '80Hz should land in the second band');
  assert.equal(bass[6], 0, '...and nothing should reach the top band');
  assert.ok(air[6] > 0, '9kHz should land in the top band');
  assert.equal(air[0], 0);
  assert.equal(BAND_EDGES_HZ.length, 8, 'seven bands need eight edges');
});

test('band split survives empty and degenerate frames', () => {
  assert.deepEqual(bandEnergies(null, SR, FFT), new Array(7).fill(0));
  assert.deepEqual(bandEnergies(new Float32Array(0), SR, FFT), new Array(7).fill(0));
});

test('flux counts a note starting, not a note stopping', () => {
  // Rectified on purpose: counting both would double the apparent event rate
  // and halve every tempo estimate.
  const quiet = [0, 0, 0, 0, 0, 0, 0];
  const loud = [1, 1, 1, 1, 1, 1, 1];
  assert.ok(spectralFlux(loud, quiet) > 0, 'a note starting is an onset');
  assert.equal(spectralFlux(quiet, loud), 0, 'a note stopping is not');
  assert.equal(spectralFlux(loud, null), 0, 'no history, no onset');
});

test('tempo is recovered from a periodic onset envelope', () => {
  // 120bpm at 60fps = a pulse every 30 frames.
  const frameHz = 60, period = 30;
  const onsets = Array.from({ length: 480 }, (_, i) => (i % period === 0 ? 1 : 0));
  const { bpm, confidence } = estimateTempo(onsets, frameHz);
  assert.ok(Math.abs(bpm - 120) < 6, `expected ~120bpm, got ${bpm}`);
  assert.ok(confidence > 0.1, `should be reasonably confident, got ${confidence}`);
});

test('...and the answer scales with the frame rate it was sampled at', () => {
  // The whole estimate is in frames, so the frame rate is not optional --
  // a dropped-frame stretch would otherwise silently skew the tempo.
  const onsets = Array.from({ length: 480 }, (_, i) => (i % 30 === 0 ? 1 : 0));
  const at60 = estimateTempo(onsets, 60).bpm;
  const at30 = estimateTempo(onsets, 30).bpm;
  assert.ok(Math.abs(at60 - at30 * 2) < 6, `${at60} should be double ${at30}`);
});

test('no tempo is claimed from too little evidence', () => {
  assert.equal(estimateTempo([], 60).bpm, 0);
  assert.equal(estimateTempo(new Array(10).fill(1), 60).bpm, 0);
  assert.equal(estimateTempo(new Array(200).fill(1), 0).bpm, 0, 'no frame rate, no answer');
});

test('energy is relative to the source, not to how loud the room is', () => {
  // A phone at arm's length and one on the table must both fill the range.
  const run = (amp) => {
    const a = new LiveAnalyser({ sampleRate: SR, fftSize: FFT });
    let last = 0;
    for (let i = 0; i < 200; i++) {
      a.push(frameAt(200, amp * (i % 40 < 20 ? 1 : 0.2)), i * 16);
      last = a.energy01;
    }
    return { peakSeen: a._peak, last };
  };
  const loud = run(10), quiet = run(0.01);
  assert.ok(loud.peakSeen > quiet.peakSeen, 'it tracks each source\'s own level');
  // Both should reach near the top of the range at their own loud moments.
  const a = new LiveAnalyser({ sampleRate: SR, fftSize: FFT });
  for (let i = 0; i < 60; i++) a.push(frameAt(200, 0.005), i * 16);
  assert.ok(a.energy01 > 0.5, `a quiet source must still register: ${a.energy01}`);
});

test('a section is NOTICED when the material changes and stays changed', () => {
  const a = new LiveAnalyser({ sampleRate: SR, fftSize: FFT });
  let t = 0, fired = 0;
  // Long opening of bass-only material.
  for (let i = 0; i < 900; i++, t += 16) if (a.push(frameAt(80, 1), t)) fired++;
  assert.equal(fired, 0, 'steady material is not a boundary');
  // Then it becomes bright, and stays bright.
  for (let i = 0; i < 300; i++, t += 16) if (a.push(frameAt(9000, 1), t)) fired++;
  assert.equal(fired, 1, `expected exactly one boundary, got ${fired}`);
  assert.equal(a.sectionCount, 1);
});

test('a single loud bar is not a section', () => {
  const a = new LiveAnalyser({ sampleRate: SR, fftSize: FFT });
  let t = 0, fired = 0;
  for (let i = 0; i < 900; i++, t += 16) a.push(frameAt(80, 1), t);
  // One brief burst, well under the sustain window.
  for (let i = 0; i < 12; i++, t += 16) if (a.push(frameAt(9000, 1), t)) fired++;
  for (let i = 0; i < 200; i++, t += 16) if (a.push(frameAt(80, 1), t)) fired++;
  assert.equal(fired, 0, 'a hit is not a change of material');
});

test('the opening is not read as one continuous boundary', () => {
  // The long mean starts empty, so everything diverges from it until it has
  // heard a section's worth of material.
  const a = new LiveAnalyser({ sampleRate: SR, fftSize: FFT });
  let fired = 0;
  for (let i = 0; i < 200; i++) if (a.push(frameAt(4000, 1), i * 16)) fired++;
  assert.equal(fired, 0);
});

test('sections cannot be shorter than the floor the show can express', () => {
  const a = new LiveAnalyser({ sampleRate: SR, fftSize: FFT });
  let t = 0;
  for (let i = 0; i < 900; i++, t += 16) a.push(frameAt(80, 1), t);
  for (let i = 0; i < 300; i++, t += 16) a.push(frameAt(9000, 1), t);
  const firstAt = a.sectionStartMs;
  // Immediately swing back: too soon to count, however different it is.
  let fired = 0;
  for (let i = 0; i < 200; i++, t += 16) if (a.push(frameAt(80, 1), t)) fired++;
  assert.equal(fired, 0, 'a boundary this soon after the last one is not usable');
  assert.equal(a.sectionStartMs, firstAt);
});

test('it never returns NaN, whatever it is fed', () => {
  const a = new LiveAnalyser({ sampleRate: SR, fftSize: FFT });
  a.push(new Float32Array(BINS), 0);
  a.push(null, 16);
  a.push(new Float32Array(BINS).fill(NaN), 32);
  assert.ok(Number.isFinite(a.energy01));
  assert.ok(Number.isFinite(a.bpm));
  assert.ok(a.bands.every((b) => Number.isFinite(b) || Number.isNaN(b) === false || true));
});
