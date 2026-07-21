import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerfGovernor, MAX_LEVEL, resolvePerfStartLevel } from '../src/render/PerfGovernor.js';

function feedFrames(gov, n, deltaMs, startMs = 0, stepMs = 16.6) {
  let t = startMs;
  for (let i = 0; i < n; i++) { gov.sample(deltaMs, t); t += stepMs; }
  return t;
}

test('stays at level 0 under a healthy frame budget', () => {
  const gov = new PerfGovernor();
  feedFrames(gov, 200, 10);
  assert.equal(gov.level, 0);
  assert.equal(gov.visionAllowed, true);
  assert.equal(gov.particleMul, 1);
  assert.equal(gov.crackGlowEnabled, true);
  assert.equal(gov.bloomEnabled, true);
  assert.equal(gov.veilEnabled, true);
});

test('sheds one rung after sustained over-budget frames, in spec order', () => {
  const gov = new PerfGovernor();
  // deltaMs=20 is 20/15 of budget -- with severity-weighted shedding this
  // crosses the threshold at frame 45, not 60 (see the scaled-shedding
  // tests below for the "barely over budget still takes ~1s" case).
  feedFrames(gov, 44, 20);
  assert.equal(gov.level, 0, 'should not shed before the sustained-severity threshold');
  feedFrames(gov, 1, 20);
  assert.equal(gov.level, 1);
  assert.equal(gov.visionAllowed, false, 'vision loop sheds first');
  assert.equal(gov.particleMul, 1, 'particles untouched at level 1');
});

test('a frame barely over budget still takes ~60 frames (~1s) to shed', () => {
  const gov = new PerfGovernor();
  feedFrames(gov, 59, 15.1);
  assert.equal(gov.level, 0);
  feedFrames(gov, 1, 15.1);
  assert.equal(gov.level, 1);
});

test('a badly over-budget frame sheds a rung in far fewer frames', () => {
  const gov = new PerfGovernor();
  // deltaMs=45 is 3x budget -- severity 3, so 20 frames (not 60) sheds.
  feedFrames(gov, 19, 45);
  assert.equal(gov.level, 0);
  feedFrames(gov, 1, 45);
  assert.equal(gov.level, 1);
});

test('severity is capped so one catastrophic frame cannot shed multiple rungs at once', () => {
  const gov = new PerfGovernor();
  gov.sample(5000, 0); // one huge stall (e.g. a tab coming back into focus)
  assert.equal(gov.level, 0, 'a single frame, however bad, only ever adds capped severity');
});

test('sheds progressively further under sustained pressure', () => {
  const gov = new PerfGovernor();
  let t = 0;
  // Barely-over-budget severity (~1x) so each 60-frame batch sheds exactly
  // one rung with no carry-over into the next, isolating "does the ladder
  // walk down in order" from the severity-scaling behavior (tested above).
  for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
    t = feedFrames(gov, 60, 15.1, t);
    assert.equal(gov.level, lvl);
  }
  // Fully shed: every lever off.
  assert.equal(gov.visionAllowed, false);
  assert.equal(gov.particleMul, 0.6);
  assert.equal(gov.crackGlowEnabled, false);
  assert.equal(gov.bloomEnabled, false);
  assert.equal(gov.veilEnabled, false);
  assert.equal(gov.phenomenaFull, false);
  assert.equal(gov.hazeLayers, 1);
  assert.equal(gov.heavyPostFx, false);

  // Further over-budget frames don't shed past MAX_LEVEL.
  feedFrames(gov, 200, 20, t);
  assert.equal(gov.level, MAX_LEVEL);
});

test('a single over-budget frame does not reset recovery progress unnecessarily, but recovers after 10 clean seconds', () => {
  const gov = new PerfGovernor();
  let t = feedFrames(gov, 60, 20, 0); // shed to level 1
  assert.equal(gov.level, 1);

  // Under 10s of clean frames: no recovery yet.
  t = feedFrames(gov, 100, 5, t, 90); // ~9s of clean frames
  assert.equal(gov.level, 1);

  // Push past the 10s clean threshold.
  t = feedFrames(gov, 20, 5, t, 90); // another ~1.8s
  assert.equal(gov.level, 0);
});

test('deeper rungs (5-6) gate phenomena and the overlay-pass stack, past the original four', () => {
  const gov = new PerfGovernor();
  gov.level = 4;
  assert.equal(gov.phenomenaFull, true, 'still full at the end of the original ladder');
  assert.equal(gov.hazeLayers, 3);
  assert.equal(gov.heavyPostFx, true);

  gov.level = 5;
  assert.equal(gov.phenomenaFull, false, 'rung 5 sheds optional phenomena');
  assert.equal(gov.hazeLayers, 3, 'haze still full at rung 5');
  assert.equal(gov.heavyPostFx, true);

  gov.level = 6;
  assert.equal(gov.phenomenaFull, false);
  assert.equal(gov.hazeLayers, 1, 'rung 6 collapses haze to a single layer');
  assert.equal(gov.heavyPostFx, false, 'rung 6 also drops the heaviest overlay passes');
});

test('constructor accepts a proactive startLevel, clamped to [0, MAX_LEVEL]', () => {
  assert.equal(new PerfGovernor().level, 0, 'defaults to 0');
  assert.equal(new PerfGovernor({ startLevel: 2 }).level, 2);
  assert.equal(new PerfGovernor({ startLevel: -3 }).level, 0, 'clamped at the floor');
  assert.equal(new PerfGovernor({ startLevel: 99 }).level, MAX_LEVEL, 'clamped at the ceiling');
});

test('resolvePerfStartLevel: ?perf=lite|high overrides the device heuristic', () => {
  assert.equal(resolvePerfStartLevel('?perf=lite', { isCoarsePointer: false }), 2);
  assert.equal(resolvePerfStartLevel('?perf=high', { isCoarsePointer: true }), 0);
  assert.equal(resolvePerfStartLevel('perf=lite'), 2, 'works without a leading ?');
});

test('resolvePerfStartLevel: falls back to a coarse-pointer/small-viewport device heuristic', () => {
  assert.equal(resolvePerfStartLevel('', {}), 0, 'a normal desktop starts at full quality');
  assert.equal(resolvePerfStartLevel('', { isCoarsePointer: true }), 1, 'touch devices start a rung down');
  assert.equal(resolvePerfStartLevel('', { isSmallViewport: true }), 1, 'small viewports start a rung down');
});

test('resolvePerfStartLevel tolerates a malformed search string', () => {
  assert.equal(resolvePerfStartLevel(undefined, {}), 0);
});

test('an over-budget frame during a clean streak resets the recovery timer', () => {
  const gov = new PerfGovernor();
  let t = feedFrames(gov, 60, 20, 0); // shed to level 1
  t = feedFrames(gov, 100, 5, t, 90); // ~9s clean, not yet recovered
  assert.equal(gov.level, 1);

  gov.sample(20, t); // one bad frame resets the clean-streak clock
  t += 90;
  t = feedFrames(gov, 100, 5, t, 90); // another ~9s clean — still shy of 10s since reset
  assert.equal(gov.level, 1, 'recovery timer should have restarted after the interruption');
});
