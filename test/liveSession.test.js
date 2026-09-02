// A rolling stand-in for a timeline, built from what has been heard so far.
//
// The offline path hands startTimeline a finished object. Listening has none
// of that at the moment the listener taps -- the song has not happened yet.
// These pin what the stand-in must still guarantee, and what it must be
// honest about NOT knowing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveSession, NOMINAL_SONG_MS } from '../src/audio/LiveSession.js';

const SR = 48000, FFT = 2048, BINS = FFT / 2;
const frameAt = (hz, amp = 1) => {
  const m = new Float32Array(BINS);
  m[Math.round(hz / ((SR / 2) / BINS))] = amp;
  return m;
};

test('there is something to start the show with before a note is heard', () => {
  const s = new LiveSession();
  const d = s.startData();
  assert.ok(Array.isArray(d.timeline) && d.timeline.length === 0,
    'no synthesised notes -- the microphone is the only source of truth, and a '
    + 'fabricated timeline would be a second, wrong one competing with it');
  assert.ok(d.durationMs > 0, 'a duration is needed even though it is a guess');
  assert.equal(d.live, true);
  assert.equal(d.estimatedDuration, true,
    'a guessed duration must never be mistaken for a measured one');
});

test('the bar grid is always populated ahead of the clock', () => {
  // Anything reading the grid has to find a NEXT bar, or beat-quantized
  // scheduling stalls.
  const s = new LiveSession();
  let t = 0;
  for (let i = 0; i < 120; i++, t += 16) s.tick(frameAt(200, 1), t);
  assert.ok(s.barGrid.length > 0);
  const last = s.barGrid[s.barGrid.length - 1].ms;
  assert.ok(last > t, `the grid must lead the clock: last bar ${last} vs now ${t}`);
  // Monotonic and indexed.
  for (let i = 1; i < s.barGrid.length; i++) {
    assert.ok(s.barGrid[i].ms > s.barGrid[i - 1].ms, 'bars must advance');
    assert.equal(s.barGrid[i].index, s.barGrid[i - 1].index + 1);
  }
});

test('the grid does not grow without bound over a long listen', () => {
  // A page left listening for an hour must not accumulate an array forever.
  const s = new LiveSession();
  let t = 0;
  for (let i = 0; i < 4000; i++, t += 100) s.tick(frameAt(200, 1), t);
  assert.ok(s.barGrid.length <= 512, `grid grew to ${s.barGrid.length}`);
  assert.ok(s.barGrid.length > 8, 'but it still holds a usable window');
});

test('sections are appended as they are noticed, and always cover the clock', () => {
  const s = new LiveSession();
  let t = 0, lastPushed = 0;
  for (let i = 0; i < 900; i++, t += 16) { s.tick(frameAt(80, 1), t); lastPushed = t; }
  assert.equal(s.sections.length, 1, 'one section so far');
  for (let i = 0; i < 300; i++, t += 16) { s.tick(frameAt(9000, 1), t); lastPushed = t; }
  assert.equal(s.sections.length, 2, 'the change should have been noticed');
  // No gaps and no overlaps: the schedule has to be continuous.
  for (let i = 1; i < s.sections.length; i++) {
    assert.equal(s.sections[i - 1].endMs, s.sections[i].startMs,
      'sections must be contiguous');
  }
  assert.ok(s.sections[s.sections.length - 1].endMs >= lastPushed,
    'the last section must run to the most recent frame it was given');
});

test('progress is a saturating guess, not a measurement', () => {
  const s = new LiveSession({ nominalMs: 10000 });
  s.tick(frameAt(200, 1), 0);
  assert.equal(s.progress01(0), 0);
  assert.ok(Math.abs(s.progress01(5000) - 0.5) < 1e-9);
  assert.equal(s.progress01(10000), 1);
  // A long listen must not drive anything past its own end.
  assert.equal(s.progress01(999999), 1, 'saturates rather than exceeding 1');
  assert.equal(new LiveSession().progress01(1000), 0, 'nothing heard yet is 0');
});

test('tempo settles from what is heard and is never zero', () => {
  const s = new LiveSession();
  assert.equal(s.bpm, 120, 'a sane default before anything is known');
  let t = 0;
  // A pulse every 30 frames at 16ms -> ~125bpm territory.
  for (let i = 0; i < 800; i++, t += 16) s.tick(frameAt(80, i % 30 === 0 ? 1 : 0.02), t);
  assert.ok(s.bpm > 40 && s.bpm < 220, `tempo should stay sane, got ${s.bpm}`);
});

test('it survives being fed nothing at all', () => {
  const s = new LiveSession();
  assert.doesNotThrow(() => {
    for (let i = 0; i < 60; i++) s.tick(null, i * 16);
    for (let i = 0; i < 60; i++) s.tick(new Float32Array(BINS), 1000 + i * 16);
  });
  assert.ok(Number.isFinite(s.energy01));
  assert.ok(Number.isFinite(s.bpm));
  assert.ok(s.sections.length >= 1, 'a silent room is still one section');
});

test('the nominal length is a stated constant, not a magic number inline', () => {
  assert.ok(NOMINAL_SONG_MS > 60000, 'long enough that a normal song does not saturate early');
  assert.equal(new LiveSession().startData().durationMs, NOMINAL_SONG_MS);
});
