import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngagementMeter } from '../src/sim/EngagementMeter.js';

const STEP = 1 / 120;

test('EngagementMeter starts visible (level ramps up from t=0 even with no tap yet)', () => {
  const e = new EngagementMeter();
  let t = 0;
  for (let i = 0; i < 30; i++) { e.update(t, STEP); t += 8.33; }
  assert.ok(e.level > 0.5, `expected the layer to be up within the first ~250ms untouched, got ${e.level}`);
});

test('a tap keeps the layer engaged (level near 1) while recent', () => {
  const e = new EngagementMeter();
  let t = 0;
  e.onTap(0);
  for (let i = 0; i < 60; i++) { e.update(t, STEP); t += 8.33; } // ~500ms
  assert.ok(e.level > 0.95, `expected near-full engagement, got ${e.level}`);
});

test('level decays toward 0 well after the engaged window elapses with no further taps', () => {
  const e = new EngagementMeter();
  let t = 0;
  e.onTap(0);
  // 3s engaged window + several fade-out taus (0.8s each) of pure decay.
  for (let i = 0; i < 1200; i++) { e.update(t, STEP); t += 8.33; } // ~10s
  assert.ok(e.level < 0.01, `expected the level to have decayed near 0, got ${e.level}`);
});

test('level is bounded 0..1 throughout', () => {
  const e = new EngagementMeter();
  let t = 0;
  for (let i = 0; i < 2000; i++) {
    if (i % 100 === 0) e.onTap(t);
    e.update(t, STEP);
    assert.ok(e.level >= 0 && e.level <= 1, `level out of bounds at i=${i}: ${e.level}`);
    t += 8.33;
  }
});

test('a re-tap mid-fade recovers quickly (fade-in is much faster than fade-out)', () => {
  const e = new EngagementMeter();
  let t = 0;
  e.onTap(0);
  // Engaged window ends at 3000ms; run well past it into the fade-out.
  for (let i = 0; i < 700; i++) { e.update(t, STEP); t += 8.33; } // ~5.8s
  const faded = e.level;
  assert.ok(faded < 0.5, `should have faded substantially by ~5.8s, got ${faded}`);

  e.onTap(t);
  for (let i = 0; i < 60; i++) { e.update(t, STEP); t += 8.33; } // ~500ms of recovery (well over 3x the 0.15s tau)
  assert.ok(e.level > 0.9, `expected a fast recovery after re-tap, got ${e.level}`);
});

test('onTap never moves lastTapMs backward (out-of-order stamps are ignored)', () => {
  const e = new EngagementMeter();
  e.onTap(1000);
  e.onTap(500); // stale/out-of-order
  assert.equal(e.lastTapMs, 1000);
});
