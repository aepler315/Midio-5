// The player's beat anchor: phase should follow taps immediately, but the
// inferred PERIOD must be sluggish -- a couple of fast taps must never
// yank the grid to sixteenths, and even sustained sixteenth tapping should
// level out to eighths, never commit to sixteenths outright.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BeatAnchor } from '../src/sim/BeatAnchor.js';

const SONG_BEAT_MS = 500; // 120bpm quarter note

/** Taps a steady inter-onset-interval `n` times starting at `startMs`. */
function tapSteady(anchor, startMs, ioiMs, n) {
  let t = startMs;
  for (let i = 0; i < n; i++) {
    anchor.tap(t);
    t += ioiMs;
  }
  return t;
}

test('one tap sets the phase; the grid lands on it', () => {
  const a = new BeatAnchor(SONG_BEAT_MS);
  a.tap(12345);
  assert.equal(a.anchorMs, 12345);
  assert.equal(a.phaseRad(12345), 0);
  assert.equal(a.nextGridMs(12345), 12345 + a.periodMs);
});

test('two fast (16th-note) taps do not change the period', () => {
  const a = new BeatAnchor(SONG_BEAT_MS);
  const before = a.periodMs;
  a.tap(0);
  a.tap(SONG_BEAT_MS / 4); // a single 16th-note gap
  assert.equal(a.periodMs, before, 'period must not move on two close taps');
});

test('sustained sixteenth-note tapping levels out to eighths, never sixteenths', () => {
  const a = new BeatAnchor(SONG_BEAT_MS);
  // Many bars of steady 16th-note taps (16th = songBeat/4).
  tapSteady(a, 0, SONG_BEAT_MS / 4, 400);
  assert.equal(a.periodMs, SONG_BEAT_MS * 0.5, 'committed level must clamp to eighth notes (0.5x), not sixteenths');
});

test('sustained eighth-note tapping only commits after the hysteresis streak', () => {
  const a = new BeatAnchor(SONG_BEAT_MS);
  // 8th-note taps are level 0.5, "speeding up" from the default level 1 --
  // COMMIT_TAPS_UP (12) consecutive metrical taps are required.
  let t = 0;
  for (let i = 0; i < 8; i++) {
    a.tap(t);
    t += SONG_BEAT_MS / 2;
    assert.equal(a.periodMs, SONG_BEAT_MS, `period must still be the default before the commit streak completes (tap ${i})`);
  }
  // Keep tapping until it commits.
  for (let i = 0; i < 20 && a.periodMs === SONG_BEAT_MS; i++) {
    a.tap(t);
    t += SONG_BEAT_MS / 2;
  }
  assert.equal(a.periodMs, SONG_BEAT_MS * 0.5, 'sustained 8th-note tapping should eventually commit to the 8th-note level');
});

test('period stays inside [songBeat/2, songBeat*4]', () => {
  const a = new BeatAnchor(SONG_BEAT_MS);
  // Drive it hard toward the fast end with sustained 16ths.
  tapSteady(a, 0, SONG_BEAT_MS / 4, 400);
  assert.ok(a.periodMs >= SONG_BEAT_MS * 0.5 - 1e-6, 'period must not go below half the song beat');

  // Drive it toward the slow end with sustained whole-note-ish taps.
  const b = new BeatAnchor(SONG_BEAT_MS);
  tapSteady(b, 0, SONG_BEAT_MS * 4, 60);
  assert.ok(b.periodMs <= SONG_BEAT_MS * 4 + 1e-6, 'period must not exceed 4x the song beat');
});

test('confidence decays to 0 after tapping stops', () => {
  const a = new BeatAnchor(SONG_BEAT_MS);
  tapSteady(a, 0, SONG_BEAT_MS, 10);
  const lastTapMs = a._lastTapMs;
  assert.ok(a.confidence > 0, 'sustained steady taps should build confidence');
  a.update(lastTapMs + 120000); // 2 minutes of silence
  assert.ok(a.confidence < 0.01, `confidence should have decayed away, got ${a.confidence}`);
});

test('a long gap starts a fresh session: phase snaps, period value is kept', () => {
  const a = new BeatAnchor(SONG_BEAT_MS);
  tapSteady(a, 0, SONG_BEAT_MS, 20);
  const periodBefore = a.periodMs;
  const freshTapMs = a._lastTapMs + 10000; // well past SESSION_GAP_MS
  a.tap(freshTapMs);
  assert.equal(a.anchorMs, freshTapMs, 'a session-gap tap should snap the anchor directly to it');
  assert.equal(a.periodMs, periodBefore, 'the period value itself should survive a session reset');
});
