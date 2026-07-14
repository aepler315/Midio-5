import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTapChart, buildQuarterGrid, mergeTaps, dedupeTimes, DIFFICULTIES,
} from '../src/sim/TapChart.js';
import { Role, makeNoteEvent } from '../src/core/NoteEvent.js';
import {
  NoteHighway, gradeForDelta, HIT_WINDOW_PERFECT_MS, HIT_WINDOW_GREAT_MS, HIT_WINDOW_OK_MS,
} from '../src/render/NoteHighway.js';
import { TapScorer } from '../src/sim/TapScorer.js';

function kick(tMs, vel = 0.8) {
  return makeNoteEvent({
    tMs, durMs: 90, pitch: 36, vel, role: Role.RHYTHM, kick: true, src: 'audio',
  });
}
function hat(tMs, vel = 0.4) {
  return makeNoteEvent({
    tMs, durMs: 40, pitch: 42, vel, role: Role.RHYTHM, kick: false, src: 'audio',
  });
}

const BPM = 120;
const BEAT = 500;
const BAR = 2000;
const bars = 4;
const durationMs = bars * BAR;
const barGrid = Array.from({ length: bars }, (_, i) => ({ ms: i * BAR, tick: i * 4 }));
// Four-on-the-floor kicks + 8th hats.
const timeline = [];
for (let t = 0; t < durationMs; t += BEAT) {
  timeline.push(kick(t));
  timeline.push(hat(t + BEAT / 2));
}

test('DIFFICULTIES lists easy/medium/hard', () => {
  assert.deepEqual([...DIFFICULTIES], ['easy', 'medium', 'hard']);
});

test('easy is a quarter-note metronome (1 2 3 4)', () => {
  const chart = buildTapChart({
    timeline, barGrid, bpm: BPM, beatPeriodMs: BEAT, durationMs, difficulty: 'easy',
  });
  assert.ok(chart.length >= bars * 4 - 1);
  // Every note is a beat, spaced ~one beat apart.
  for (let i = 1; i < chart.length; i++) {
    const gap = chart[i].tMs - chart[i - 1].tMs;
    assert.ok(Math.abs(gap - BEAT) < 5, `gap ${gap} should be ~${BEAT}`);
  }
  // Jump tags land on kicks (every beat in 4-on-floor).
  assert.ok(chart.some((n) => n.isJump));
});

test('medium = kicks ∪ quarters (no denser than that)', () => {
  // Sparse kicks: only on beat 1 of each bar.
  const sparse = [];
  for (let b = 0; b < bars; b++) sparse.push(kick(b * BAR));
  const chart = buildTapChart({
    timeline: sparse, barGrid, bpm: BPM, beatPeriodMs: BEAT, durationMs, difficulty: 'medium',
  });
  // 4 bars * 4 quarters = 16; kicks already on quarters so still 16.
  assert.equal(chart.length, bars * 4);
  // Every bar-start is a jump note.
  const jumps = chart.filter((n) => n.isJump);
  assert.equal(jumps.length, bars);
});

test('hard is denser than medium, includes kicks as jumps', () => {
  const easy = buildTapChart({ timeline, barGrid, bpm: BPM, beatPeriodMs: BEAT, durationMs, difficulty: 'easy' });
  const medium = buildTapChart({ timeline, barGrid, bpm: BPM, beatPeriodMs: BEAT, durationMs, difficulty: 'medium' });
  const hard = buildTapChart({ timeline, barGrid, bpm: BPM, beatPeriodMs: BEAT, durationMs, difficulty: 'hard' });
  assert.ok(hard.length >= medium.length);
  assert.ok(medium.length >= easy.length * 0.9); // medium at least ~quarters
  // Hard should approach 16th density in driven sections.
  assert.ok(hard.length > medium.length, 'hard denser than medium');
  const jumpCount = hard.filter((n) => n.isJump).length;
  assert.ok(jumpCount >= bars * 4 - 1); // nearly every kick tagged
});

test('buildQuarterGrid falls back without barGrid', () => {
  const q = buildQuarterGrid([], BEAT, 4000, [{ tMs: 0, vel: 1 }]);
  assert.ok(q.length >= 8);
  assert.ok(Math.abs(q[1] - q[0] - BEAT) < 1e-6);
});

test('mergeTaps coalesces near-duplicates preferring kicks', () => {
  const merged = mergeTaps([
    [{ tMs: 1000, vel: 0.5, kind: 'beat', isJump: false }],
    [{ tMs: 1010, vel: 0.9, kind: 'kick', isJump: true }],
  ], 28);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].kind, 'kick');
  assert.equal(merged[0].isJump, true);
  assert.equal(merged[0].tMs, 1010);
});

test('dedupeTimes', () => {
  assert.deepEqual(dedupeTimes([0, 5, 40, 41, 100], 20), [0, 40, 100]);
});

test('NoteHighway x hits Midio at note time', () => {
  const hw = new NoteHighway([{ tMs: 2000, vel: 1, kind: 'kick', isJump: true }], { approachMs: 1000 });
  const hitX = 220;
  const stageW = 1280;
  assert.ok(Math.abs(hw.noteX(2000, 2000, hitX, stageW) - hitX) < 0.01);
  // 500ms early → halfway from right edge corridor.
  const xEarly = hw.noteX(2000, 1500, hitX, stageW);
  assert.ok(xEarly > hitX);
  assert.ok(xEarly < stageW);
});

test('NoteHighway tryHit grades windows correctly', () => {
  const hw = new NoteHighway([{ tMs: 1000, vel: 1, kind: 'beat', isJump: false }]);
  assert.equal(hw.tryHit(1000).grade, 'perfect');
  const hw2 = new NoteHighway([{ tMs: 1000, vel: 1, kind: 'beat', isJump: false }]);
  assert.equal(hw2.tryHit(1000 + HIT_WINDOW_PERFECT_MS + 5).grade, 'great');
  const hw3 = new NoteHighway([{ tMs: 1000, vel: 1, kind: 'beat', isJump: false }]);
  assert.equal(hw3.tryHit(1000 + HIT_WINDOW_GREAT_MS + 5).grade, 'ok');
  const hw4 = new NoteHighway([{ tMs: 1000, vel: 1, kind: 'beat', isJump: false }]);
  assert.equal(hw4.tryHit(1000 + HIT_WINDOW_OK_MS + 20), null);
});

test('NoteHighway autoMissPast marks late notes', () => {
  const hw = new NoteHighway([
    { tMs: 100, vel: 1, kind: 'beat', isJump: false },
    { tMs: 500, vel: 1, kind: 'beat', isJump: false },
  ]);
  const misses = hw.autoMissPast(100 + HIT_WINDOW_OK_MS + 1);
  assert.equal(misses.length, 1);
  assert.equal(hw.tryHit(500)?.grade, 'perfect');
});

test('gradeForDelta thresholds', () => {
  assert.equal(gradeForDelta(0), 'perfect');
  assert.equal(gradeForDelta(HIT_WINDOW_PERFECT_MS), 'perfect');
  assert.equal(gradeForDelta(HIT_WINDOW_GREAT_MS), 'great');
  assert.equal(gradeForDelta(HIT_WINDOW_OK_MS), 'ok');
  assert.equal(gradeForDelta(HIT_WINDOW_OK_MS + 1), 'miss');
});

test('TapScorer accumulates score and accuracy', () => {
  const s = new TapScorer();
  s.register('perfect');
  s.register('great');
  s.register('miss');
  assert.equal(s.perfect, 1);
  assert.equal(s.great, 1);
  assert.equal(s.miss, 1);
  assert.equal(s.streak, 0); // broken by miss
  assert.equal(s.maxStreak, 2);
  assert.ok(s.score > 0);
  assert.ok(s.accuracy > 0 && s.accuracy < 1);
});
