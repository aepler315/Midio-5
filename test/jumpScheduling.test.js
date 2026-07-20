// Chart-scheduled landings: a jump should land ON the next audible kick
// whenever one is a plausible target, instead of only ever guessing from
// the beat-period EMA (which only ever matches a perfectly steady beat).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduledJumpD, nextLandingKickMs, LANDING_MIN_GAP_MS, D_MIN, D_MAX,
} from '../src/sim/JumpController.js';

test('scheduledJumpD lands exactly on the next kick when the gap is a plausible target', () => {
  assert.equal(scheduledJumpD(1000, 1500, 500), 500, 'unclamped gap wins outright');
  assert.equal(scheduledJumpD(1000, 1900, 500), 900, 'a syncopated gap still schedules exactly');
});

test('scheduledJumpD clamps a too-close or too-far gap to [D_MIN, D_MAX]', () => {
  assert.equal(scheduledJumpD(1000, 1000 + LANDING_MIN_GAP_MS - 1, 500), 500, 'a gap under the floor falls back to the EMA, not a tiny D');
  assert.equal(scheduledJumpD(1000, 1000 + D_MIN - 50, 500), D_MIN, 'a real but short gap clamps up to D_MIN, never below it');
  assert.equal(scheduledJumpD(1000, 1000 + D_MAX + 400, 500), D_MAX, 'a real but long gap clamps down to D_MAX');
});

test('scheduledJumpD falls back to the beat-period EMA when there is no plausible next kick', () => {
  assert.equal(scheduledJumpD(1000, null, 500), 500, 'no kick in range at all');
  assert.equal(scheduledJumpD(1000, 3500, 500), 500, 'a kick so far out it reads as a rest, not a target');
});

test('nextLandingKickMs skips duplicate/too-close kicks and returns the first plausible target', () => {
  const kickTimes = [1000, 1050, 1080, 1600, 2200];
  // From takeoff=1000, scanning from index 1: 1050 (gap 50) and 1080 (gap
  // 80) are both too close (dedupe/layered onsets); 1600 (gap 600) is the
  // first real candidate.
  assert.equal(nextLandingKickMs(kickTimes, 1000, 1), 1600);
});

test('nextLandingKickMs returns null when nothing in the list qualifies', () => {
  assert.equal(nextLandingKickMs([1000, 1050], 1000, 1), null);
  assert.equal(nextLandingKickMs([], 1000, 0), null);
  assert.equal(nextLandingKickMs([1000], 1000, 5), null, 'fromIdx past the end');
});
