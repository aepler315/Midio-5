import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApotheosisDirector } from '../src/sim/ApotheosisDirector.js';

function ctx({ epic = 0, surge = 0, calmLevel = 0 } = {}) {
  return { vibe: { epic }, hype: { surge }, calm: { level: calmLevel } };
}

test('charge accrues +1 per clean landing and +2 per milestone', () => {
  const a = new ApotheosisDirector();
  a.onCleanLanding();
  assert.equal(a.charge, 1);
  a.onCleanLanding();
  a.onMilestone();
  assert.equal(a.charge, 4);
});

test('charge decays at 0.15/s while inactive and stops decaying once active', () => {
  const a = new ApotheosisDirector();
  a.charge = 5;
  a.update(1000, 1, ctx());
  assert.ok(Math.abs(a.charge - 4.85) < 1e-9, `expected ~4.85, got ${a.charge}`);

  // Never decays below 0.
  a.charge = 0.05;
  a.update(2000, 1, ctx());
  assert.equal(a.charge, 0);
});

test('does not trigger below the charge threshold even with music fully ready', () => {
  const a = new ApotheosisDirector();
  a.charge = 7.99;
  a.update(1000, 0, ctx({ epic: 0.9 }));
  assert.equal(a.active, false);
});

test('triggers once charge >= 8 AND (epic > 0.4 OR surge > 0.3), and resets charge to 0', () => {
  const a = new ApotheosisDirector();
  a.charge = 8;
  a.update(1000, 0, ctx({ epic: 0.5 }));
  assert.equal(a.active, true);
  assert.equal(a.justTriggered, true);
  assert.equal(a.charge, 0);
  assert.equal(a.triggerCount, 1);
});

test('does not trigger at full charge if neither epic nor surge clears its gate', () => {
  const a = new ApotheosisDirector();
  a.charge = 8;
  a.update(1000, 0, ctx({ epic: 0.2, surge: 0.1 }));
  assert.equal(a.active, false);
});

test('surge alone (epic low) is sufficient to trigger', () => {
  const a = new ApotheosisDirector();
  a.charge = 8;
  a.update(1000, 0, ctx({ epic: 0, surge: 0.35 }));
  assert.equal(a.active, true);
});

test('never triggers during deep calm even at full charge and high epic', () => {
  const a = new ApotheosisDirector();
  a.charge = 20;
  a.update(1000, 0, ctx({ epic: 0.9, surge: 0.9, calmLevel: 0.8 }));
  assert.equal(a.active, false, 'deep calm (>=0.75) must block the transform outright');
});

test('deactivates automatically after the 8s active window and starts the cooldown', () => {
  const a = new ApotheosisDirector();
  a.forceTrigger(0);
  assert.equal(a.active, true);
  a.update(7999, 0.001, ctx());
  assert.equal(a.active, true, 'should still be active just before the window ends');
  a.update(8000, 0.001, ctx());
  assert.equal(a.active, false);
  assert.equal(a.justEnded, true);
});

test('cooldown blocks a second trigger for 45s after ending, even at full charge', () => {
  const a = new ApotheosisDirector();
  a.forceTrigger(0);
  a.update(8000, 0.001, ctx()); // ends, cooldown starts at t=8000
  a.charge = 8;
  a.update(8000 + 44999, 0, ctx({ epic: 0.9 }));
  assert.equal(a.active, false, 'still inside the 45s cooldown');
  a.update(8000 + 45000, 0, ctx({ epic: 0.9 }));
  assert.equal(a.active, true, 'cooldown should have elapsed');
});

test('never triggers a third time in one song (max 2)', () => {
  const a = new ApotheosisDirector();
  let t = 0;
  assert.equal(a.forceTrigger(t), true);
  t += 8000; a.update(t, 0.001, ctx());
  t += 45000;
  assert.equal(a.forceTrigger(t), true);
  assert.equal(a.triggerCount, 2);
  t += 8000; a.update(t, 0.001, ctx());
  t += 45000;
  assert.equal(a.forceTrigger(t), false, 'a third trigger must be refused');
  a.charge = 999;
  a.update(t, 0.001, ctx({ epic: 0.9 }));
  assert.equal(a.active, false);
});

test('progress ramps 0->1 over exactly MORPH_SEC (0.6s) after a trigger, and holds at 1 while active', () => {
  const a = new ApotheosisDirector();
  a.forceTrigger(0);
  assert.equal(a.progress, 0, 'progress must not jump on the trigger frame itself');
  a.update(300, 0.3, ctx());
  assert.ok(Math.abs(a.progress - 0.5) < 1e-9, `expected 0.5 halfway through the morph, got ${a.progress}`);
  a.update(600, 0.3, ctx());
  assert.equal(a.progress, 1);
  a.update(5000, 4.4, ctx());
  assert.equal(a.progress, 1, 'progress holds at 1 for the rest of the active window');
});

test('progress ramps back 1->0 over MORPH_SEC after the active window ends, never a jump', () => {
  // Step at a realistic sim cadence (120Hz) so the frame that crosses the
  // active-window boundary has a normal small dt, not an artificially huge one.
  const a = new ApotheosisDirector();
  const STEP_MS = 1000 / 120;
  let t = 0;
  a.forceTrigger(t);
  while (a.progress < 1) { t += STEP_MS; a.update(t, STEP_MS / 1000, ctx()); }
  assert.equal(a.progress, 1);

  while (t + STEP_MS < 8000) { t += STEP_MS; a.update(t, STEP_MS / 1000, ctx()); }
  assert.equal(a.active, true, 'should still be active on the last frame before the window ends');
  const beforeEnd = a.progress;

  t += STEP_MS; // this step crosses the 8000ms boundary
  a.update(t, STEP_MS / 1000, ctx());
  assert.equal(a.active, false);
  assert.ok(beforeEnd - a.progress < 0.05, 'progress must not jump when the active window ends');

  while (a.progress > 0) { t += STEP_MS; a.update(t, STEP_MS / 1000, ctx()); }
  assert.equal(a.progress, 0);
});

test('forceTrigger refuses to double-trigger while already active', () => {
  const a = new ApotheosisDirector();
  assert.equal(a.forceTrigger(0), true);
  assert.equal(a.forceTrigger(100), false);
});
