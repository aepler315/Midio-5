import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimpleSynth } from '../src/audio/SimpleSynth.js';
import { Role } from '../src/core/NoteEvent.js';

function fakeAudioEngine() {
  const calls = { oscillators: 0, gains: 0, filters: 0, panners: 0 };
  const gainParam = () => ({
    value: 0,
    setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
  });
  const ctx = {
    currentTime: 0,
    createOscillator: () => {
      calls.oscillators++;
      return {
        type: '',
        frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        detune: { value: 0 },
        connect(dest) { return dest; }, start() {}, stop() {},
      };
    },
    createGain: () => {
      calls.gains++;
      return { gain: gainParam(), connect(dest) { return dest; } };
    },
    createBiquadFilter: () => {
      calls.filters++;
      return {
        type: '', frequency: { value: 0 }, Q: { value: 0 }, connect(dest) { return dest; },
      };
    },
    createStereoPanner: () => {
      calls.panners++;
      return { pan: { value: 0 }, connect(dest) { return dest; } };
    },
    createBuffer: (ch, len, sr) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => ({ buffer: null, connect: () => ({ connect() {} }), start() {} }),
  };
  return { ae: { ctx, master: {} }, calls };
}

function note(o) {
  return {
    tMs: 0, durMs: 200, pitch: 60, vel: 0.6, role: Role.MELODY, kick: false,
    src: 'midi', channel: 0, pan: 0, program: -1, lane: null, ...o,
  };
}

test('noteOn plays a melodic note as one oscillator through one gain, unfiltered', () => {
  const { ae, calls } = fakeAudioEngine();
  const synth = new SimpleSynth(ae);
  synth.noteOn(note({}));
  assert.equal(calls.oscillators, 1);
  assert.equal(calls.filters, 0);
  assert.equal(calls.gains, 1);
});

test('RHYTHM notes use the dedicated drum voices', () => {
  const { ae, calls } = fakeAudioEngine();
  const synth = new SimpleSynth(ae);
  synth.noteOn(note({ channel: 9, role: Role.RHYTHM, pitch: 36 }));
  assert.equal(calls.filters, 0, 'the kick voice is a pitched sweep, not filtered noise');
  assert.equal(calls.oscillators, 1);
});
