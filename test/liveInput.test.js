// The microphone path: one tap, no account, works with whatever the listener
// is already playing. These pin the decisions that make it work at all --
// especially the constraints, which are the difference between a usable
// signal and one the browser has actively processed into uselessness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LiveInput, RAW_AUDIO_CONSTRAINTS, liveInputSupported, describeMicError,
  looksLikeSilence, SILENCE_PEAK_FLOOR,
} from '../src/audio/LiveInput.js';

function fakeNav(onConstraints) {
  return {
    mediaDevices: {
      getUserMedia: async (c) => {
        if (onConstraints) onConstraints(c);
        return { getTracks: () => [{ stop() {} }] };
      },
    },
  };
}

function FakeAudioContext() {
  return {
    state: 'running',
    sampleRate: 48000,
    createMediaStreamSource: () => ({ connect() {} }),
    createAnalyser: () => ({
      fftSize: 2048,
      frequencyBinCount: 1024,
      smoothingTimeConstant: 0.8,
      getFloatFrequencyData(arr) { arr.fill(-50); },
    }),
    close() {},
  };
}

test('voice processing is switched OFF -- the single most important line', () => {
  // Browsers default microphone input to call processing: echo cancellation
  // SUBTRACTS the music (it is, from the browser's point of view, echo of
  // the speaker), noise suppression gates it, and auto gain pumps it. With
  // any of the three on, the signal reaching the beat detector is actively
  // hostile.
  assert.equal(RAW_AUDIO_CONSTRAINTS.echoCancellation, false);
  assert.equal(RAW_AUDIO_CONSTRAINTS.noiseSuppression, false);
  assert.equal(RAW_AUDIO_CONSTRAINTS.autoGainControl, false);
});

test('...and they actually reach getUserMedia', () => {
  let seen = null;
  const li = new LiveInput();
  return li.start({ nav: fakeNav((c) => { seen = c; }), AudioCtx: FakeAudioContext })
    .then(() => {
      assert.ok(seen && seen.audio, 'audio constraints must be requested');
      assert.equal(seen.audio.echoCancellation, false);
      assert.equal(seen.video, false, 'never ask for the camera');
    });
});

test('support detection does not throw on a browser without any of it', () => {
  assert.equal(liveInputSupported(null), false);
  assert.equal(liveInputSupported({}), false);
  assert.equal(liveInputSupported({ mediaDevices: {} }), false);
  assert.equal(liveInputSupported(fakeNav()), true);
});

test('a refused permission produces something worth reading', () => {
  // "NotAllowedError" is accurate and useless. Each case maps to a different
  // thing the listener should actually do.
  const denied = describeMicError({ name: 'NotAllowedError' });
  assert.match(denied, /settings/i, 'tell them where to fix it');
  assert.match(describeMicError({ name: 'NotFoundError' }), /no microphone/i);
  assert.match(describeMicError({ name: 'NotReadableError' }), /using the microphone/i);
  assert.ok(describeMicError({ message: 'weird' }).length > 0, 'unknown errors still say something');
  assert.ok(describeMicError(null).length > 0, 'and null does not throw');
});

test('smoothing is far below the Web Audio default', () => {
  // Heavy smoothing is what makes an onset detector blind, and onsets are
  // the entire tempo estimate.
  assert.ok(new LiveInput().smoothing < 0.7, 'the 0.8 default would flatten every onset');
});

test('read() returns null before start and frames after', async () => {
  const li = new LiveInput();
  assert.equal(li.read(), null, 'nothing to read before permission');
  await li.start({ nav: fakeNav(), AudioCtx: FakeAudioContext });
  const frame = li.read();
  assert.ok(frame && frame.length === 1024);
  // -50dB should map into the usable range, not to 0 or 1.
  assert.ok(frame[0] > 0.1 && frame[0] < 0.9, `got ${frame[0]}`);
});

test('silence maps to zero rather than to a floor value', async () => {
  const li = new LiveInput();
  await li.start({ nav: fakeNav(), AudioCtx: FakeAudioContext });
  li.analyser.getFloatFrequencyData = (arr) => arr.fill(-Infinity);
  const frame = li.read();
  assert.ok(frame.every((v) => v === 0), 'a silent room must read as silence');
});

test('stop() releases the device', async () => {
  let stopped = 0;
  const nav = {
    mediaDevices: {
      getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }),
    },
  };
  const li = new LiveInput();
  await li.start({ nav, AudioCtx: FakeAudioContext });
  assert.equal(li.active, true);
  li.stop();
  // A page holding an open microphone shows a recording indicator and costs
  // battery -- releasing it is not optional housekeeping.
  assert.equal(stopped, 1, 'the track must actually be stopped');
  assert.equal(li.active, false);
  assert.equal(li.read(), null);
  assert.doesNotThrow(() => li.stop(), 'stopping twice is harmless');
});

test('starting twice does not open a second microphone', async () => {
  let opens = 0;
  const nav = {
    mediaDevices: {
      getUserMedia: async () => { opens++; return { getTracks: () => [{ stop() {} }] }; },
    },
  };
  const li = new LiveInput();
  await li.start({ nav, AudioCtx: FakeAudioContext });
  await li.start({ nav, AudioCtx: FakeAudioContext });
  assert.equal(opens, 1);
});

test('an unusable browser fails with a sentence, not a TypeError', async () => {
  const li = new LiveInput();
  await assert.rejects(() => li.start({ nav: {}, AudioCtx: FakeAudioContext }), /cannot listen/i);
  await assert.rejects(() => li.start({ nav: fakeNav(), AudioCtx: null }), /Web Audio/i);
});

test('a room that never gets loud is reported, not left as a still picture', () => {
  // Headphones are the common cause and cannot be detected directly. But
  // "nothing musical has arrived in several seconds" is a good enough proxy
  // to say something, instead of letting someone conclude the app is broken.
  assert.equal(looksLikeSilence(0.5, 2000, 0.9), false, 'do not complain immediately');
  assert.equal(looksLikeSilence(0.9, 20000, 0.9), false, 'music playing is fine');
  assert.equal(looksLikeSilence(0.001, 20000, SILENCE_PEAK_FLOOR / 2), true);
  assert.equal(looksLikeSilence(0.5, 20000, 0), true, 'no peak at all is silence');
});
