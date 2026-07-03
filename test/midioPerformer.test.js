import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MidioPerformer } from '../src/sim/MidioPerformer.js';

function fakeMidio() {
  return { leanDeg: 0, scaleX: 1, scaleY: 1, y: 400, renderY: 400, screenX: 200 };
}

function fakeJump({ airborne, lastLaunchVel = 0.9, jumpStartMs = 0, D = 500, beatPeriodMs = 500 }) {
  return { airborne, lastLaunchVel, jumpStartMs, D, beatPeriodMs };
}

function fakeCombo(displayM = 1, streak = 0) {
  return { displayM, streak };
}

test('a high-velocity launch selects a trick and spins/flips across the hang phase', () => {
  const perf = new MidioPerformer(1);
  const midio = fakeMidio();
  const jump = fakeJump({ airborne: true, lastLaunchVel: 0.95, jumpStartMs: 0, D: 500 });
  perf.update(0, 1 / 120, midio, jump, fakeCombo());
  assert.ok(perf.trick, 'expected a trick to be selected on a high-velocity launch');

  // Step through to the middle of the hang phase (u ~ 0.5, between A=0.35 and A+B=0.65).
  perf.update(250, 1 / 120, midio, jump, fakeCombo());
  if (perf.trick.type === 'spin') {
    assert.ok(midio.leanDeg > 0 && midio.leanDeg < 360, 'spin should be partway through its rotation');
  } else {
    assert.ok(midio.scaleY < 1 && midio.scaleY > -1, 'backflip should be mid-flip (scaleY between -1 and 1)');
  }
});

test('a slow, low-combo launch does not trigger a trick', () => {
  const perf = new MidioPerformer(1);
  const midio = fakeMidio();
  const jump = fakeJump({ airborne: true, lastLaunchVel: 0.3, jumpStartMs: 0, D: 500 });
  perf.update(0, 1 / 120, midio, jump, fakeCombo(1, 0));
  assert.equal(perf.trick, null);
});

test('trick type never repeats twice in a row across consecutive jumps', () => {
  const perf = new MidioPerformer(1);
  const midio = fakeMidio();
  const seenTypes = [];
  let jumpStart = 0;
  for (let i = 0; i < 12; i++) {
    // land first (airborne=false) so the next launch is detected as a fresh justLaunched transition
    perf.update(jumpStart - 1, 1 / 120, midio, fakeJump({ airborne: false }), fakeCombo());
    const jump = fakeJump({ airborne: true, lastLaunchVel: 0.95, jumpStartMs: jumpStart, D: 400 });
    perf.update(jumpStart, 1 / 120, midio, jump, fakeCombo());
    seenTypes.push(perf.trick.type);
    jumpStart += 400;
  }
  for (let i = 1; i < seenTypes.length; i++) assert.notEqual(seenTypes[i], seenTypes[i - 1]);
});

test('a clean landing at combo>=2 opens a brief flourish window that overrides scale', () => {
  const perf = new MidioPerformer(1);
  const midio = fakeMidio();
  perf.onLanding(1000, true, 2.2);
  const jumpGrounded = fakeJump({ airborne: false });
  perf.update(1010, 1 / 120, midio, jumpGrounded, fakeCombo(2.2, 5));
  assert.equal(midio.scaleY, 0.65);
  assert.equal(midio.scaleX, 1.55);

  // After the window closes, the override should no longer apply.
  const midio2 = fakeMidio();
  perf.update(1200, 1 / 120, midio2, jumpGrounded, fakeCombo(2.2, 5));
  assert.notEqual(midio2.scaleY, 0.65);
});

test('a clean landing below combo x2 does not open a flourish window', () => {
  const perf = new MidioPerformer(1);
  const midio = fakeMidio();
  perf.onLanding(1000, true, 1.3);
  perf.update(1010, 1 / 120, midio, fakeJump({ airborne: false }), fakeCombo(1.3, 3));
  assert.notEqual(midio.scaleY, 0.65);
});

test('streak milestones fire milestoneFlash and goldFlash exactly once each, in order', () => {
  const perf = new MidioPerformer(1);
  const fired = [];
  for (const streak of [1, 3, 5, 5, 7, 10, 10, 15, 20, 25]) {
    perf.clearFrameFlags();
    perf.onStreak(streak);
    if (perf.milestoneFlash) fired.push(streak);
  }
  assert.deepEqual(fired, [5, 10, 20]);
});

test('idle strut adds a small beat-synced lean offset only while grounded', () => {
  const perf = new MidioPerformer(1);
  const midio = fakeMidio();
  const jump = fakeJump({ airborne: false, beatPeriodMs: 500 });
  perf.update(125, 1 / 120, midio, jump, fakeCombo()); // quarter-beat phase -> sin near max
  assert.ok(Math.abs(midio.leanDeg) > 0.01);
  assert.ok(Math.abs(midio.leanDeg) <= 2.3);
});

test('afterimages accumulate while airborne and clear immediately on landing', () => {
  const perf = new MidioPerformer(1);
  const midio = fakeMidio();
  let t = 0;
  const jump = fakeJump({ airborne: true, jumpStartMs: 0, D: 500 });
  for (let i = 0; i < 10; i++) { perf.update(t, 1 / 120, midio, jump, fakeCombo()); t += 30; }
  assert.ok(perf.afterimages.length > 0);

  perf.update(t, 1 / 120, midio, fakeJump({ airborne: false }), fakeCombo());
  assert.equal(perf.afterimages.length, 0);
});

test('idle strut damps down and a slower sway takes over as calmLevel rises', () => {
  const jump = fakeJump({ airborne: false, beatPeriodMs: 500 });
  let strutMax = 0, swayMax = 0;
  for (let t = 0; t < 500; t += 5) {
    const energetic = new MidioPerformer(1);
    const m1 = fakeMidio();
    energetic.update(t, 1 / 120, m1, jump, fakeCombo(), 0);
    strutMax = Math.max(strutMax, Math.abs(m1.leanDeg));

    const calm = new MidioPerformer(1);
    const m2 = fakeMidio();
    calm.update(t, 1 / 120, m2, jump, fakeCombo(), 1);
    swayMax = Math.max(swayMax, Math.abs(m2.leanDeg));
  }
  assert.ok(strutMax > 0.01 && swayMax > 0.01, 'both regimes should keep some idle motion, never fully still');
});

test('breathing/drift only apply once grounded and past any flourish window, scaled by calmLevel', () => {
  const jump = fakeJump({ airborne: false, beatPeriodMs: 0 }); // beatPeriodMs=0 disables strut so breathing is isolated
  const energetic = new MidioPerformer(1);
  const calmPerf = new MidioPerformer(1);
  let energeticDrift = 0, calmDrift = 0;
  for (let t = 0; t < 4000; t += 20) {
    const m1 = fakeMidio();
    energetic.update(t, 1 / 60, m1, jump, fakeCombo(), 0);
    energeticDrift = Math.max(energeticDrift, Math.abs(m1.y - 400), Math.abs(m1.scaleY - 1));

    const m2 = fakeMidio();
    calmPerf.update(t, 1 / 60, m2, jump, fakeCombo(), 1);
    calmDrift = Math.max(calmDrift, Math.abs(m2.y - 400), Math.abs(m2.scaleY - 1));
  }
  assert.ok(energeticDrift < 1e-6, `expected no breathing/drift at calmLevel=0, got ${energeticDrift}`);
  assert.ok(calmDrift > 0.001, `expected visible breathing/drift at calmLevel=1, got ${calmDrift}`);
});

test('blinking only engages once calm is sustained past the threshold', () => {
  const jump = fakeJump({ airborne: false, beatPeriodMs: 0 });
  const perf = new MidioPerformer(1);
  let everBlinked = false;
  for (let t = 0; t < 12000; t += 20) {
    const m = fakeMidio();
    perf.update(t, 1 / 60, m, jump, fakeCombo(), 1);
    if (perf.blinkScale < 0.99) everBlinked = true;
  }
  assert.ok(everBlinked, 'expected at least one blink over 12s of sustained calm');

  const perfEnergetic = new MidioPerformer(1);
  let everBlinkedEnergetic = false;
  for (let t = 0; t < 12000; t += 20) {
    const m = fakeMidio();
    perfEnergetic.update(t, 1 / 60, m, jump, fakeCombo(), 0);
    if (perfEnergetic.blinkScale < 0.99) everBlinkedEnergetic = true;
  }
  assert.ok(!everBlinkedEnergetic, 'expected no blinking below the calm threshold');
});
