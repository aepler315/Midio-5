import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerfGovernor, MAX_LEVEL } from '../src/render/PerfGovernor.js';

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
  assert.equal(gov.veilEnabled, true);
});

test('sheds one rung after ~60 consecutive over-budget frames, in spec order', () => {
  const gov = new PerfGovernor();
  feedFrames(gov, 59, 20);
  assert.equal(gov.level, 0, 'should not shed before the sustained-frame threshold');
  feedFrames(gov, 1, 20);
  assert.equal(gov.level, 1);
  assert.equal(gov.visionAllowed, false, 'vision loop sheds first');
  assert.equal(gov.particleMul, 1, 'particles untouched at level 1');
});

test('sheds progressively further under sustained pressure', () => {
  const gov = new PerfGovernor();
  let t = 0;
  for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
    t = feedFrames(gov, 60, 20, t);
    assert.equal(gov.level, lvl);
  }
  // Fully shed: every lever off.
  assert.equal(gov.visionAllowed, false);
  assert.equal(gov.particleMul, 0.6);
  assert.equal(gov.crackGlowEnabled, false);
  assert.equal(gov.veilEnabled, false);

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
