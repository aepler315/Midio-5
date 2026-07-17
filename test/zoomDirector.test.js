import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZoomDirector, ZOOM_MIN, ZOOM_MAX, ZOOM_NEUTRAL, pinchZoomDelta,
} from '../src/sim/ZoomDirector.js';

const STEP = 1 / 120;

test('value eases toward target with a real lag (not instant), starts at the neutral resting zoom', () => {
  const z = new ZoomDirector();
  assert.equal(z.value, ZOOM_NEUTRAL);
  z.nudge(ZOOM_MAX); // clamp will pin target at ZOOM_MAX
  z.update(0, STEP);
  assert.ok(z.value > ZOOM_NEUTRAL, 'should have started moving');
  assert.ok(z.value < ZOOM_NEUTRAL + (ZOOM_MAX - ZOOM_NEUTRAL) * 0.1, 'a single 8.3ms step must not have arrived yet');
});

test('nudge stays clamped within [ZOOM_MIN, ZOOM_MAX]; toggle snaps between neutral and ZOOM_MAX', () => {
  const z = new ZoomDirector();
  z.nudge(-100);
  assert.equal(z.target, ZOOM_MIN);
  z.nudge(100);
  assert.equal(z.target, ZOOM_MAX);
  z.toggle();
  assert.equal(z.target, ZOOM_NEUTRAL, 'toggle backs off to the resting zoom, not the far zoomed-out end');
  z.toggle();
  assert.equal(z.target, ZOOM_MAX);
});

test('a sustained (repeated) nudge toward max reaches it and holds while input keeps coming', () => {
  const z = new ZoomDirector();
  let t = 0;
  // Mirrors a genuinely held key/wheel: nudge every frame, same as main.js.
  for (let i = 0; i < 600; i++) { z.nudge(ZOOM_MAX); z.update(t, STEP); t += 8.33; }
  assert.ok(z.value > ZOOM_MAX - 0.05, `expected value to approach ZOOM_MAX, got ${z.value}`);

  for (let i = 0; i < 600; i++) { z.nudge(-ZOOM_MAX); z.update(t, STEP); t += 8.33; }
  assert.ok(z.value < ZOOM_MIN + 0.05, `expected value to approach ZOOM_MIN, got ${z.value}`);
});

test('pinchZoomDelta: spreading zooms in, pinching together zooms out, no-op with invalid distances', () => {
  assert.ok(pinchZoomDelta(100, 150, 0.01) > 0, 'spreading fingers should zoom in');
  assert.ok(pinchZoomDelta(150, 100, 0.01) < 0, 'pinching together should zoom out');
  assert.equal(pinchZoomDelta(0, 150, 0.01), 0);
  assert.equal(pinchZoomDelta(150, 0, 0.01), 0);
  assert.equal(pinchZoomDelta(-10, 150, 0.01), 0);
});

test('ZOOM_MIN now allows zooming out below 1 (the world pulling back, not just leaning in)', () => {
  assert.ok(ZOOM_MIN < 1, `expected ZOOM_MIN < 1, got ${ZOOM_MIN}`);
});

// --- World-adaptation auto-return -----------------------------------------

test('after input stops, the target eases back to neutral and lands there within the adaptation window', () => {
  const z = new ZoomDirector();
  let t = 0;
  z.nudge(ZOOM_MAX);
  z.update(t, STEP); // one nudge, then input stops entirely
  t += 8.33;

  // Idle stretch: still zoomed in, no adaptation yet (< 2s idle).
  for (let i = 0; i < 100; i++) { z.update(t, STEP); t += 8.33; } // ~0.83s
  assert.ok(z.target > ZOOM_NEUTRAL + 0.5, 'should not have started adapting yet');
  assert.equal(z.adaptEnv, 0);

  // Push well past idle (2s) + the full adaptation duration (6.5s).
  for (let i = 0; i < 1200; i++) { z.update(t, STEP); t += 8.33; } // ~10s more
  assert.ok(Math.abs(z.target - ZOOM_NEUTRAL) < 0.05, `expected target back near neutral, got ${z.target}`);
  assert.ok(Math.abs(z.value - ZOOM_NEUTRAL) < 0.1, `expected value to have eased home too, got ${z.value}`);
  assert.equal(z.adaptEnv, 0, 'adaptation should have fully completed and cleared');
});

test('adaptEnv rises and falls across the morph (peaks mid-adaptation), and adaptDir reflects the return direction', () => {
  const z = new ZoomDirector();
  let t = 0;
  z.nudge(ZOOM_MAX);
  z.update(t, STEP);
  t += 8.33;

  // With no bar grid (nextBarMs=null), idle-crossing and adaptation start
  // happen in the same update() call -- one continuous loop observes both.
  let sawStart = false, peak = 0;
  for (let i = 0; i < 1100; i++) {
    z.update(t, STEP);
    if (z.adaptJustStarted) { sawStart = true; assert.equal(z.adaptDir, 1, 'returning from a lean-in'); }
    peak = Math.max(peak, z.adaptEnv);
    t += 8.33;
  }
  assert.ok(sawStart, 'expected adaptation to start');
  assert.ok(peak > 0.7, `expected adaptEnv to rise well above 0 mid-morph, got peak ${peak}`);
});

test('a new nudge mid-adaptation cancels it and re-arms the idle clock', () => {
  const z = new ZoomDirector();
  let t = 0;
  z.nudge(ZOOM_MAX);
  z.update(t, STEP);
  t += 8.33;
  for (let i = 0; i < 900; i++) { z.update(t, STEP); t += 8.33; } // well into adaptation
  assert.ok(z.adaptEnv > 0, 'expected adaptation to be underway');

  z.nudge(-0.3); // fresh input mid-morph
  z.update(t, STEP);
  assert.equal(z.adaptEnv, 0, 'a fresh nudge must cancel the in-flight adaptation');
  const targetAfterNudge = z.target;
  t += 8.33;
  for (let i = 0; i < 100; i++) { z.update(t, STEP); t += 8.33; } // short idle, well under 2s
  assert.ok(Math.abs(z.target - targetAfterNudge) < 1e-9, 'target should hold where the new input put it');
});

test('adaptation start defers to the provided next-bar downbeat, not a raw timeout', () => {
  const z = new ZoomDirector();
  let t = 0;
  z.nudge(ZOOM_MAX);
  z.update(t, STEP);
  t += 8.33;
  const farBarMs = t + 5000; // a downbeat well after the idle threshold clears
  let startedBeforeBar = false;
  for (let i = 0; i < 260; i++) { // clears the 2s idle window, but stays short of farBarMs
    z.update(t, STEP, farBarMs);
    if (z.adaptJustStarted) startedBeforeBar = true;
    t += 8.33;
  }
  assert.ok(!startedBeforeBar, 'must not start before the deferred bar boundary');
  assert.ok(t < farBarMs, 'sanity: test still short of the bar');

  for (let i = 0; i < 50 && !z.adaptJustStarted; i++) { z.update(farBarMs + i, STEP, farBarMs); }
  assert.ok(z._adapting || z.adaptEnv > 0, 'should have started once the bar boundary arrived');
});
