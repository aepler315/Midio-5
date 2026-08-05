import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncMonitor, circularVariance } from '../src/sim/SyncMonitor.js';

const BEAT = 500;

/** Feed n kicks, then advance the monitor to `nowMs`. */
function feed(sm, kicks, beatMs = BEAT) {
  for (const t of kicks) sm.onKick(t, beatMs, 0);
}

/** Kicks landing on the grid, with `jitterMs` of human looseness. */
function gridKicks(n, jitterMs = 0, beatMs = BEAT) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const wobble = jitterMs === 0 ? 0 : ((i * 37) % 100) / 100 * 2 * jitterMs - jitterMs;
    out.push(i * beatMs + wobble);
  }
  return out;
}

/** Kicks with no relationship to the grid at all. */
function scatteredKicks(n, beatMs = BEAT) {
  const out = [];
  let t = 0;
  for (let i = 0; i < n; i++) { t += beatMs * (0.4 + ((i * 61) % 100) / 100); out.push(t); }
  return out;
}

test('circularVariance wraps at the beat boundary instead of treating it as maximal error', () => {
  // 1ms before the beat and 1ms after it are adjacent, not opposite.
  const eps = (2 * Math.PI * 1) / BEAT;
  assert.ok(circularVariance([eps, 2 * Math.PI - eps]) < 0.01);
  // Uniform scatter approaches 1.
  const uniform = Array.from({ length: 24 }, (_, i) => (i / 24) * 2 * Math.PI);
  assert.ok(circularVariance(uniform) > 0.95);
});

test('grid-locked kicks never prompt, however long the song runs', () => {
  const sm = new SyncMonitor();
  feed(sm, gridKicks(16, 18)); // a human drummer's looseness
  for (let t = 0; t < 200000; t += 1000) {
    sm.update(t, { anchorConfidence: 0 });
    assert.equal(sm.promptPending, false, `prompted at ${t}ms on a locked grid`);
  }
  assert.equal(sm.incoherent, false);
  assert.ok(sm.scatter < 0.55, `scatter ${sm.scatter}`);
});

test('scattered kicks are detected, but only prompt after the sustain window', () => {
  const sm = new SyncMonitor();
  feed(sm, scatteredKicks(16));
  sm.update(1000, { anchorConfidence: 0 });
  assert.equal(sm.incoherent, true, 'should recognize the grid is wrong immediately');
  assert.equal(sm.promptPending, false, 'but must not prompt over the opening');

  let promptedAt = null;
  for (let t = 1000; t < 120000; t += 500) {
    sm.update(t, { anchorConfidence: 0 });
    if (sm.consumePrompt()) { promptedAt = t; break; }
  }
  assert.ok(promptedAt !== null, 'should eventually offer');
  // Both guards must hold, and they run concurrently: at least 20s of
  // sustained badness AND never inside the song's first 15s. Badness here
  // starts at t=0, so the sustain window is the binding one.
  assert.ok(promptedAt >= 20000, `prompted too early at ${promptedAt}ms`);
  assert.ok(promptedAt >= 15000, 'never prompts over the opening');
});

test('a confident beat anchor suppresses the prompt entirely -- the player already fixed it', () => {
  const sm = new SyncMonitor();
  feed(sm, scatteredKicks(16));
  for (let t = 0; t < 200000; t += 500) {
    sm.update(t, { anchorConfidence: 0.9 });
    assert.equal(sm.promptPending, false, `prompted at ${t}ms despite a confident anchor`);
  }
});

test('prompts are capped per song and spaced by the reprompt gap', () => {
  const sm = new SyncMonitor();
  feed(sm, scatteredKicks(16));
  const times = [];
  for (let t = 0; t < 600000; t += 500) {
    sm.update(t, { anchorConfidence: 0 });
    if (sm.consumePrompt()) times.push(t);
  }
  assert.ok(times.length <= 2, `prompted ${times.length} times; cap is 2`);
  if (times.length === 2) {
    assert.ok(times[1] - times[0] >= 90000, `reprompt gap was only ${times[1] - times[0]}ms`);
  }
});

test('suppress holds the prompt without losing the accumulated badness', () => {
  const sm = new SyncMonitor();
  feed(sm, scatteredKicks(16));
  for (let t = 0; t < 60000; t += 500) sm.update(t, { anchorConfidence: 0, suppress: true });
  assert.equal(sm.promptPending, false, 'nothing fires while suppressed');
  // The sustain clock kept running, so releasing the suppression prompts at once.
  sm.update(60500, { anchorConfidence: 0 });
  assert.equal(sm.promptPending, true);
});

test('onCalibrated stops the stretch that would have prompted', () => {
  const sm = new SyncMonitor();
  feed(sm, scatteredKicks(16));
  for (let t = 0; t < 30000; t += 500) sm.update(t, { anchorConfidence: 0 });
  sm.onCalibrated();
  sm.update(30500, { anchorConfidence: 0 });
  assert.equal(sm.promptPending, false, 'a fresh stretch must be earned after calibrating');
});

test('a raised prompt latches until consumed -- frame ordering cannot lose it', () => {
  const sm = new SyncMonitor();
  feed(sm, scatteredKicks(16));
  let raised = false;
  for (let t = 0; t < 60000; t += 500) {
    sm.update(t, { anchorConfidence: 0 });
    if (sm.promptPending) { raised = true; break; }
  }
  assert.ok(raised, 'should raise a prompt');
  // Further update() calls must not clear it -- this is exactly what a
  // one-frame flag got wrong: sim.step() ran update() again and wiped the
  // offer before the UI ever read it.
  for (let t = 60000; t < 70000; t += 500) sm.update(t, { anchorConfidence: 0 });
  assert.equal(sm.promptPending, true, 'the latch survives intervening updates');
  assert.equal(sm.consumePrompt(), true, 'consumed exactly once');
  assert.equal(sm.consumePrompt(), false, 'and not twice');
});

test('onCalibrated drops an offer still in flight', () => {
  const sm = new SyncMonitor();
  feed(sm, scatteredKicks(16));
  for (let t = 0; t < 60000; t += 500) sm.update(t, { anchorConfidence: 0 });
  assert.equal(sm.promptPending, true);
  sm.onCalibrated();
  assert.equal(sm.consumePrompt(), false, 'the player already acted; do not ask');
});
