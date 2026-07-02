// Item 5 — the ground field + "almost-falls" gag. Pure logic (no canvas), so it
// runs in `npm test`. Asserts gag timing/bounds and that heightAt stays within
// the readable surface bounds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroundField } from '../src/world/GroundField.js';

// Flat energy (0.5 everywhere) → zero terrain offset, so only the gag moves
// the surface. Keeps the bounds assertion clean.
const flatEnergy = { sample: () => 0.5, sampleAll: () => [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5] };

function barGrid(bars, barMs) {
  return Array.from({ length: bars + 1 }, (_, i) => ({ tick: i * 4, ms: i * barMs, numerator: 4, denominator: 4 }));
}

test('heightAt stays within baseY ± (MAX_OFFSET + GAG_MAX_SAG) at all times', () => {
  const bars = 32, barMs = 2000, durationMs = bars * barMs;
  const g = new GroundField({ baseY: 480, durationMs, barGrid: barGrid(bars, barMs), beatMs: 500, obstacleTimes: [], seed: 7 });
  const STEP = 1000 / 120;
  let worldX = 0;
  for (let t = STEP; t <= durationMs + 2000; t += STEP) {
    g.update(t, STEP / 1000, flatEnergy, worldX);
    worldX += 220 * (STEP / 1000);
    // sample across the screen-relevant world range
    for (let dx = -200; dx <= 1000; dx += 100) {
      const y = g.heightAt(worldX + dx, t);
      assert.ok(y >= 480 - 92 && y <= 480 + 92, `heightAt ${y.toFixed(1)} out of bounds at t=${Math.round(t)} dx=${dx}`);
    }
  }
});

test('the gag fires in the second half and runs sag→hold→recover', () => {
  const bars = 32, barMs = 2000, durationMs = bars * barMs; // 64s
  const g = new GroundField({ baseY: 480, durationMs, barGrid: barGrid(bars, barMs), beatMs: 500, obstacleTimes: [], seed: 7 });
  const STEP = 1000 / 120;
  let worldX = 0;
  let sagStart = null, holdStart = null, recoverStart = null, idleAgain = null;
  let prev = 'idle';
  for (let t = STEP; t <= durationMs + 3000; t += STEP) {
    g.update(t, STEP / 1000, flatEnergy, worldX);
    worldX += 220 * (STEP / 1000);
    if (prev !== 'sag' && g.gagState === 'sag') sagStart = t;
    if (prev !== 'hold' && g.gagState === 'hold') holdStart = t;
    if (prev !== 'recover' && g.gagState === 'recover') recoverStart = t;
    if (prev !== 'idle' && g.gagState === 'idle' && recoverStart !== null) idleAgain = t;
    prev = g.gagState;
  }
  assert.ok(sagStart !== null, 'a gag should fire');
  assert.ok(sagStart >= 0.5 * durationMs, `gag at ${sagStart} must be in the second half (>= ${0.5 * durationMs})`);
  assert.ok(sagStart <= durationMs, 'gag must be before the end');
  assert.ok(holdStart - sagStart >= 1450 && holdStart - sagStart <= 1550, `sag phase ~1500ms, got ${holdStart - sagStart}`);
  assert.ok(recoverStart - holdStart >= 480 && recoverStart - holdStart <= 520, `hold ~1 beat (500ms), got ${recoverStart - holdStart}`);
  assert.ok(idleAgain !== null, 'gag should return to idle after recover');
});

test('the gag is not scheduled within 2 beats of an obstacle', () => {
  const bars = 32, barMs = 2000, durationMs = bars * barMs, beatMs = 500;
  // Put an obstacle within 2 beats of EVERY second-half bar boundary → no gag
  // can be placed without violating the exclusion → zero gags scheduled.
  const obstacleTimes = [];
  for (let i = Math.floor(bars / 2); i <= bars; i++) obstacleTimes.push(i * barMs + 50);
  const g = new GroundField({ baseY: 480, durationMs, barGrid: barGrid(bars, barMs), beatMs, obstacleTimes, seed: 7 });
  const STEP = 1000 / 120;
  let anyGag = false;
  for (let t = STEP; t <= durationMs + 3000; t += STEP) {
    g.update(t, STEP / 1000, flatEnergy, 0);
    if (g.gagState !== 'idle') anyGag = true;
  }
  assert.equal(anyGag, false, 'no gag should fire when every candidate time is within 2 beats of an obstacle');
});

test('the recovery overshoots (ground bumps above baseY) then settles', () => {
  const bars = 16, barMs = 2000, durationMs = bars * barMs;
  const g = new GroundField({ baseY: 480, durationMs, barGrid: barGrid(bars, barMs), beatMs: 500, obstacleTimes: [], seed: 3 });
  const STEP = 1000 / 120;
  // Find the gag, then watch the ground at Midio's position through recover.
  let worldX = 0, t = STEP, recoverSeen = false, overshoot = false;
  while (t <= durationMs + 3000) {
    g.update(t, STEP / 1000, flatEnergy, worldX);
    if (g.gagState === 'recover') {
      recoverSeen = true;
      // During recover the elastic term goes negative → ground rises above baseY.
      if (g.heightAt(worldX, t) < 480 - 1) overshoot = true;
    }
    worldX += 220 * (STEP / 1000);
    t += STEP;
  }
  assert.ok(recoverSeen, 'should reach a recover phase');
  assert.ok(overshoot, 'recover should overshoot above baseY at least once');
});