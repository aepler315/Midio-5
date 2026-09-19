// The Sync pass turns tapping into the Bluetooth delay. The premise is that
// the player's taps are canon, so most of these tests are about not
// corrupting that signal: a tap aimed at nothing is not a measurement, and
// offsets collected under different trims are not comparable until they are
// put in the same units.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SyncCalibrator, nearestOnsetOffsetMs, matchWindowMs, trimmedMedian, spreadMs,
  syncStatusText, MAX_TRIM_MS, TAP_SESSION_GAP_MS, positiveTrimCeilingMs, collapseFlams, FLAM_GAP_MS, flamGapMs,
} from '../src/sim/SyncCalibrator.js';
import { MAX_LATENCY_MS } from '../src/core/ChoreoClock.js';

/** Kicks on a 500ms grid, i.e. 120bpm. */
const grid = (count = 40, period = 500, from = 0) =>
  Array.from({ length: count }, (_, i) => from + i * period);

test('a tap is measured against the nearest kick, signed', () => {
  const kicks = grid();
  assert.equal(nearestOnsetOffsetMs(kicks, 1000, 250), 0);
  assert.equal(nearestOnsetOffsetMs(kicks, 1120, 250), 120);   // late
  assert.equal(nearestOnsetOffsetMs(kicks, 1470, 250), -30);   // early, next kick
  // Exactly between two kicks still resolves to one of them: they are a
  // clean 500ms apart, so which one was meant is not in doubt -- only how
  // late the tap was, and 250ms is outside the window anyway.
  assert.equal(Math.abs(nearestOnsetOffsetMs(kicks, 1249, 250)), 249);
});

test('a tap aimed at nothing is not a measurement', () => {
  // A tap during a rest or a fill has no kick to be measured against.
  // Feeding it in as a zero would quietly drag the estimate toward "no
  // correction needed" -- the one answer it cannot have earned.
  const kicks = [0, 500, 1000];
  assert.equal(nearestOnsetOffsetMs(kicks, 3000, 250), null);
  assert.equal(nearestOnsetOffsetMs([], 100, 250), null);
  assert.equal(nearestOnsetOffsetMs(null, 100, 250), null);
  assert.equal(nearestOnsetOffsetMs(kicks, NaN, 250), null);
});

test('the search is correct at both ends of the song', () => {
  const kicks = grid(10);
  assert.equal(nearestOnsetOffsetMs(kicks, -40, 250), -40);          // before the first
  assert.equal(nearestOnsetOffsetMs(kicks, 4540, 250), 40);          // after the last
  assert.equal(nearestOnsetOffsetMs(kicks, 100000, 250), null);      // far past it
  assert.equal(nearestOnsetOffsetMs([1234], 1200, 250), -34);        // single onset
});

test('the match window is half a beat, railed for absurd tempos', () => {
  assert.equal(matchWindowMs(500), 250);
  assert.equal(matchWindowMs(200), 100);
  assert.equal(matchWindowMs(2000), 400);   // a very slow beat still caps
  assert.equal(matchWindowMs(60), 80);      // a very fast one still has room
  assert.equal(matchWindowMs(undefined), 250);
});

test('one wild tap during a real pass does not move the answer', () => {
  const steady = [100, 104, 98, 102, 101, 99, 103, 100];
  assert.ok(Math.abs(trimmedMedian(steady) - 100) < 3);
  assert.ok(Math.abs(trimmedMedian([...steady, 420]) - 100) < 3);
  // With too few values to trim, the plain median is the honest answer.
  assert.equal(trimmedMedian([10, 20, 30]), 20);
  assert.equal(trimmedMedian([]), 0);
  assert.equal(spreadMs([100, 100, 100]), 0);
  assert.ok(spreadMs([0, 100, 200]) > 0);
});

test('a player tapping 150ms late gets a +150ms trim, and it converges', () => {
  // A Bluetooth speaker delaying the sound by 150ms: the player hears each
  // kick late and taps late by the same amount.
  const kicks = grid();
  const cal = new SyncCalibrator(0);
  const LATENCY = 150;

  let last = null;
  for (let i = 4; i < 12; i++) {
    // The tap is stamped on a clock that already has the current trim
    // subtracted -- which is exactly why the trim in force has to be added
    // back before the taps can be pooled.
    const heardAt = kicks[i] + LATENCY;
    last = cal.tap(heardAt - cal.trimMs, kicks, 500);
  }
  assert.equal(last.trimMs, LATENCY);
  // Positive is the direction the control calls "delay the visuals".
  assert.ok(last.trimMs > 0);
  assert.equal(last.taps, 8);
  assert.ok(last.spreadMs <= 1);
});

test('the estimate stays right even though the trim moves under it', () => {
  // The failure this guards: once the trim updates after every tap, each
  // offset is a residual against a DIFFERENT trim. Pooling the raw offsets
  // would converge somewhere between zero and the truth.
  const kicks = grid();
  const cal = new SyncCalibrator(0);
  const LATENCY = 200;
  const trimsSeen = [];
  for (let i = 4; i < 14; i++) {
    trimsSeen.push(cal.trimMs);
    cal.tap(kicks[i] + LATENCY - cal.trimMs, kicks, 500);
  }
  // The trim really did move during collection -- otherwise this test is
  // not exercising the thing it exists for.
  assert.ok(new Set(trimsSeen).size > 1, `trim never moved: ${trimsSeen}`);
  assert.equal(cal.trimMs, LATENCY);
});

test('tapping early delays the audio instead', () => {
  const kicks = grid();
  const cal = new SyncCalibrator(0);
  let last = null;
  for (let i = 4; i < 12; i++) last = cal.tap(kicks[i] - 60 - cal.trimMs, kicks, 500);
  assert.equal(last.trimMs, -60);
  assert.match(syncStatusText(last), /audio delayed/);
});

test('the value moves on the very first tap', () => {
  // Asked for explicitly: the delay is set in real time after each tap, not
  // after some quorum of them.
  const kicks = grid();
  const cal = new SyncCalibrator(0);
  const first = cal.tap(kicks[4] + 120, kicks, 500);
  assert.equal(first.trimMs, 120);
  assert.equal(first.taps, 1);
  assert.equal(first.changed, true);
  assert.match(syncStatusText(first), /keep tapping/);
});

test('an existing trim is the starting point, not something to rediscover', () => {
  const kicks = grid();
  // Already corrected for 100ms, and the sound is still 40ms late.
  const cal = new SyncCalibrator(100);
  let last = null;
  for (let i = 4; i < 12; i++) last = cal.tap(kicks[i] + 140 - cal.trimMs, kicks, 500);
  assert.equal(last.trimMs, 140);
});

test('a tap that measures nothing leaves the trim exactly where it was', () => {
  const kicks = [0, 500, 1000];
  const cal = new SyncCalibrator(75);
  assert.equal(cal.tap(9000, kicks, 500), null);
  assert.equal(cal.trimMs, 75);
  assert.equal(cal.taps, 0);
  assert.equal(cal.tap(NaN, kicks, 500), null);
});

test('coming back later is a new judgement, not a continuation of the old one', () => {
  // Two grids far enough apart that they do not overlap -- overlapping
  // onsets would read as flams and be rejected, which is a different test.
  const kicks = grid(40);
  const cal = new SyncCalibrator(0);
  for (let i = 4; i < 12; i++) cal.tap(kicks[i] + 150 - cal.trimMs, kicks, 500);
  assert.equal(cal.trimMs, 150);

  // A long silence, then a fresh pass that disagrees. The old taps must not
  // hold the new ones back.
  const later = 60_000;
  const lateKicks = grid(40, 500, later);
  const all = [...kicks, ...lateKicks].sort((a, b) => a - b);
  let last = null;
  for (let i = 4; i < 14; i++) {
    const tapMs = lateKicks[i] + 20 - cal.trimMs;
    if (i === 4) assert.ok(tapMs - (kicks[11] + 150) > TAP_SESSION_GAP_MS);
    last = cal.tap(tapMs, all, 500);
  }
  assert.equal(last.taps <= 10, true);
  assert.equal(cal.trimMs, 20);
});

test('the trim can never leave its rail, however hard the taps push', () => {
  const kicks = grid(400, 2000); // slow enough that a huge offset still matches
  const cal = new SyncCalibrator(0);
  let last = null;
  for (let i = 4; i < 14; i++) last = cal.tap(kicks[i] + 400 - cal.trimMs, kicks, 2000);
  assert.ok(last.trimMs <= MAX_TRIM_MS);
  assert.ok(Math.abs(cal.trimMs) <= MAX_TRIM_MS);

  const pinned = new SyncCalibrator(99999);
  assert.equal(pinned.trimMs, MAX_TRIM_MS);
  pinned.reset(-99999);
  assert.equal(pinned.trimMs, -MAX_TRIM_MS);
});

test('reset starts over from the trim the player already has', () => {
  const kicks = grid();
  const cal = new SyncCalibrator(0);
  for (let i = 4; i < 12; i++) cal.tap(kicks[i] + 150 - cal.trimMs, kicks, 500);
  cal.reset(30);
  assert.equal(cal.trimMs, 30);
  assert.equal(cal.taps, 0);
});

test('the readout says which way the correction goes, in the control’s own words', () => {
  assert.equal(syncStatusText(null), null);
  assert.match(syncStatusText({ trimMs: 150, taps: 6, spreadMs: 8 }), /150ms \(visuals delayed\).*settled/);
  assert.match(syncStatusText({ trimMs: -90, taps: 6, spreadMs: 8 }), /90ms \(audio delayed\)/);
  assert.match(syncStatusText({ trimMs: 0, taps: 6, spreadMs: 4 }), /none/);
  // Still wandering: say so rather than implying the number is final.
  assert.match(syncStatusText({ trimMs: 120, taps: 6, spreadMs: 70 }), /±70ms, keep tapping/);
  assert.match(syncStatusText({ trimMs: 120, taps: 2, spreadMs: 2 }), /keep tapping/);
});

test('the positive ceiling is what the visual clock will actually honour', () => {
  // A positive trim is added to the lag handed to visualNow, which clamps
  // the total. Anything past that ceiling raises the number and moves
  // nothing -- so it is not a valid answer to converge on.
  assert.equal(positiveTrimCeilingMs(0), MAX_LATENCY_MS);
  assert.equal(positiveTrimCeilingMs(42), MAX_LATENCY_MS - 42);
  assert.equal(positiveTrimCeilingMs(MAX_LATENCY_MS + 100), 0);
  assert.equal(positiveTrimCeilingMs(-5), MAX_LATENCY_MS);
  assert.equal(positiveTrimCeilingMs(NaN), MAX_LATENCY_MS);
  assert.ok(positiveTrimCeilingMs(0) <= MAX_TRIM_MS);
});

test('a trim the visual clock cannot apply is refused, not chased', () => {
  // The runaway this exists for, seen in a browser: with the clock clamping
  // total lag at 350ms, a loop measuring its own residual kept raising the
  // trim -- 376ms and climbing -- because past the clamp the correction
  // stopped taking effect and the error never closed.
  const kicks = grid(400, 2000);
  const ceiling = positiveTrimCeilingMs(42);
  // Already most of the way to the ceiling, and the taps ask for more.
  const cal = new SyncCalibrator(ceiling - 40);
  let last = null;
  for (let i = 4; i < 14; i++) {
    last = cal.tap(kicks[i] + 200, kicks, 2000, { maxPositiveTrimMs: ceiling });
  }
  assert.equal(last.trimMs, ceiling);
  assert.equal(last.railed, true);
  // And it says so, rather than letting someone tap harder at a number that
  // has stopped moving.
  assert.match(syncStatusText(last), /as far as the visuals can be delayed/);

  // Below the ceiling nothing is railed and the readout is the normal one.
  const easy = new SyncCalibrator(0);
  let ok = null;
  for (let i = 4; i < 14; i++) ok = easy.tap(kicks[i] + 100 - easy.trimMs, kicks, 2000, { maxPositiveTrimMs: ceiling });
  assert.equal(ok.railed, false);
  assert.equal(ok.trimMs, 100);
});

test('the ceiling never pins the negative side, which corrects elsewhere', () => {
  // Delaying the audio goes through a DelayNode with a full second of
  // range, so the visual clock's clamp has no say over it. Even with the
  // positive ceiling at zero, the negative direction runs to its own rail.
  const kicks = grid(400, 2000);
  const cal = new SyncCalibrator(-200);
  let last = null;
  for (let i = 4; i < 14; i++) {
    last = cal.tap(kicks[i] - 380, kicks, 2000, { maxPositiveTrimMs: 0 });
  }
  assert.equal(last.trimMs, -MAX_TRIM_MS);
  assert.equal(last.railed, false);
});

test('a tap further than half a beat from any kick belongs to no kick', () => {
  // Which is why a single pass cannot discover an error of a full beat:
  // past the window the tap is nearer its neighbour, and attributing it
  // here would fold a whole beat into the estimate.
  const kicks = grid(40, 2000);
  const cal = new SyncCalibrator(0);
  assert.equal(cal.tap(kicks[4] + 900, kicks, 2000), null);
  assert.ok(cal.tap(kicks[4] + 390, kicks, 2000));
});

test('a flam collapses to the beat it ornaments, not to two beats', () => {
  // The real shape, measured off a 120bpm fixture: kicks arrive in pairs
  // 81ms apart, not on a grid. Matching against the raw list picks
  // whichever half is nearer and drags every tap in the neighbourhood
  // toward zero -- so the list is collapsed instead, keeping the first of
  // each cluster, which is where the beat actually is.
  assert.deepEqual(collapseFlams([1000, 1081, 2000, 2081, 3000, 3081]), [1000, 2000, 3000]);
  // A clean grid is left exactly as it is.
  assert.deepEqual(collapseFlams([1000, 2000, 3000]), [1000, 2000, 3000]);
  // A run of hits inside one window collapses to its start, not pairwise.
  assert.deepEqual(collapseFlams([0, 40, 80, 110, 400], 150), [0, 400]);
  assert.deepEqual(collapseFlams([]), []);
  assert.deepEqual(collapseFlams(null), []);
  assert.deepEqual(collapseFlams([500], FLAM_GAP_MS), [500]);
});

test('a tap after a flam measures from the beat, not from its tail', () => {
  const flammed = [1000, 1081, 2000, 2081, 3000, 3081];
  const cal = new SyncCalibrator(0);
  // Raw, the nearest onset to 1150 is the tail at 1081 -- 69ms. The beat
  // it was aimed at is at 1000, and 150ms is the answer.
  assert.equal(nearestOnsetOffsetMs(flammed, 1150, 250), 69);
  const result = cal.tap(1150, flammed, 1000);
  assert.equal(result.offsetMs, 150);
  assert.equal(result.trimMs, 150);
});

test('a common Bluetooth lag is still measurable on an ordinary grid', () => {
  // The rejection above must not cost the case the feature exists for.
  // 100-200ms is the usual Bluetooth round-trip, and at 120bpm the kicks
  // are 500ms apart, so a 200ms tap is unambiguous however close to
  // halfway it looks.
  const kicks = grid(40);
  assert.equal(nearestOnsetOffsetMs(kicks, kicks[6] + 200, 250), 200);
  const cal = new SyncCalibrator(0);
  let last = null;
  for (let i = 4; i < 14; i++) last = cal.tap(kicks[i] + 200 - cal.trimMs, kicks, 500);
  assert.equal(last.trimMs, 200);
});

test('a fast double-kick is a pattern, not an ornament', () => {
  // A fixed gap cannot tell the two apart. The onset detector reports hits
  // 60ms apart, and a 100ms double-kick figure is real music -- collapsing
  // it would measure a player who tapped the second hit as 100ms late and
  // persist a delay they never had. Double-kick figures live in fast music,
  // so a threshold that is a fraction of the beat separates them.
  const ornament = flamGapMs(713);   // the ~120bpm case the flam was seen in
  const fast = flamGapMs(300);       // 200bpm, where double-kicks live
  assert.ok(81 < ornament, 'the observed 81ms flam must still collapse');
  assert.ok(100 > fast, 'a 100ms double-kick at 200bpm must survive');
  assert.equal(flamGapMs(undefined), Math.min(FLAM_GAP_MS, 100));

  const doubleKick = [0, 100, 300, 400, 600, 700];
  assert.deepEqual(collapseFlams(doubleKick, flamGapMs(300)), doubleKick);
  // And the same spacing in slow music still reads as an ornament.
  assert.deepEqual(collapseFlams([0, 100, 1000, 1100], flamGapMs(1000)), [0, 1000]);
});

test('a tap is measured against the tempo it was played at', () => {
  // The collapse is cached, so a tempo change has to invalidate it --
  // otherwise the first beat length a pass saw would decide the grid for
  // the rest of the song.
  const onsets = [0, 100, 300, 400, 600, 700, 900, 1000];
  const cal = new SyncCalibrator(0);
  // Fast: both hits of each pair stand, so the tap belongs to the nearer.
  assert.equal(cal.tap(410, onsets, 300).offsetMs, 10);
  cal.reset(0);
  // Slow: the pair is an ornament, so the tap is measured from its start.
  assert.equal(cal.tap(410, onsets, 2000).offsetMs, 110);
});
