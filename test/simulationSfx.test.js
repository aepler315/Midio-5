// SfxSynth was fully authored and tuned (judgment/miss/holdTick/
// holdComplete/holdChoke, each key-matched to the song's detected tonic)
// but nothing in the codebase ever called it -- `sfx` appeared exactly
// twice: its declaration and its assignment in main.js. Every hit, miss,
// hold tick and choke played in total silence. Simulation._applyJudgeEvents
// is where the matching VISUAL feedback (impactFX, camera shake) already
// fires per judgment tier; these tests check that sfx is now wired in
// alongside it, using a bare-prototype instance (this method's dependencies
// are plain data + a handful of trivial method calls, so a full Simulation
// isn't needed) with `this.sfx` swapped for a call-recording stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/Simulation.js';

function recordingSfx() {
  const calls = [];
  return {
    calls,
    judgment(...args) { calls.push(['judgment', ...args]); },
    miss(...args) { calls.push(['miss', ...args]); },
    holdTick(...args) { calls.push(['holdTick', ...args]); },
    holdComplete(...args) { calls.push(['holdComplete', ...args]); },
    holdChoke(...args) { calls.push(['holdChoke', ...args]); },
  };
}

/** A bare-prototype Simulation with just enough state for
 *  _applyJudgeEvents to run without constructing the whole sim graph. */
function bareSimWithEvents(stepEvents) {
  const sim = Object.create(Simulation.prototype);
  sim.perf = null;
  sim.fever = { level: 0, onJudge() {} };
  sim.judge = { stepEvents };
  sim.latency = { onJudgedHit() {} };
  sim._lastHoldComboMs = -Infinity;
  sim.comboSystem = { onLanding() {}, sustain() {}, displayM: 1 };
  sim.performer = { onStreak() {}, goldFlash: 0 };
  sim.scoreKeeper = { noteStreak() {}, applyEvent() {} };
  sim.jump = { airborne: true, onPlayerTap() {} }; // airborne: true skips the holdTick ground-hop branch
  sim.impactFX = { judgment() {}, splat() {}, ignite() {} };
  sim.camera = { shake() {} };
  sim.vibe = { tonic: 4, tonicConfidence: 0.8 };
  sim.worldX = 100;
  sim.midio = { groundY: 500 };
  sim.sfx = recordingSfx();
  return sim;
}

test('a perfect hit rings the judgment chime with the song\'s tonic', () => {
  const sim = bareSimWithEvents([{ kind: 'hit', tier: 'perfect', tMs: 1000 }]);
  sim._applyJudgeEvents();
  assert.deepEqual(sim.sfx.calls, [['judgment', 'perfect', 4, 0.8]]);
});

test('a sour hit plays the sour cue, whether it arrives as hit/sour-tier or a standalone sour event', () => {
  const a = bareSimWithEvents([{ kind: 'hit', tier: 'sour', tMs: 1000 }]);
  a._applyJudgeEvents();
  assert.deepEqual(a.sfx.calls, [['judgment', 'sour', 4, 0.8]]);

  const b = bareSimWithEvents([{ kind: 'sour', tMs: 1000 }]);
  b._applyJudgeEvents();
  assert.deepEqual(b.sfx.calls, [['judgment', 'sour', 4, 0.8]]);
});

test('a late-armed hold (tier null) makes no judgment sound -- the glow ramp is its own cue', () => {
  const sim = bareSimWithEvents([{ kind: 'holdStart', tier: null, tMs: 1000 }]);
  sim._applyJudgeEvents();
  assert.deepEqual(sim.sfx.calls, []);
});

test('a miss gets its own quiet cue', () => {
  const sim = bareSimWithEvents([{ kind: 'miss', tMs: 1000 }]);
  sim._applyJudgeEvents();
  assert.deepEqual(sim.sfx.calls, [['miss']]);
});

test('each hold tick climbs the pentatonic by its own tick index', () => {
  const sim = bareSimWithEvents([
    { kind: 'holdTick', tMs: 1000, tickIdx: 0, tickCount: 3 },
    { kind: 'holdTick', tMs: 1100, tickIdx: 1, tickCount: 3 },
  ]);
  sim._applyJudgeEvents();
  assert.deepEqual(sim.sfx.calls, [
    ['holdTick', 0, 4, 0.8],
    ['holdTick', 1, 4, 0.8],
  ]);
});

test('a completed hold chimes its resolve chord', () => {
  const sim = bareSimWithEvents([{ kind: 'holdComplete', tMs: 1000 }]);
  sim._applyJudgeEvents();
  assert.deepEqual(sim.sfx.calls, [['holdComplete', 4, 0.8]]);
});

test('an early release chokes the riser', () => {
  const sim = bareSimWithEvents([{ kind: 'holdChoke', tMs: 1000 }]);
  sim._applyJudgeEvents();
  assert.deepEqual(sim.sfx.calls, [['holdChoke']]);
});

test('sfx being null (pre-bootAudio) never throws -- every call site is optional-chained', () => {
  const sim = bareSimWithEvents([
    { kind: 'hit', tier: 'great', tMs: 1000 },
    { kind: 'miss', tMs: 1100 },
    { kind: 'holdTick', tMs: 1200, tickIdx: 0, tickCount: 1 },
    { kind: 'holdComplete', tMs: 1300 },
    { kind: 'holdChoke', tMs: 1400 },
    { kind: 'sour', tMs: 1500 },
  ]);
  sim.sfx = null;
  assert.doesNotThrow(() => sim._applyJudgeEvents());
});
