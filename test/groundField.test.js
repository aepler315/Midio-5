import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroundField } from '../src/world/GroundField.js';
import { Conductor } from '../src/core/Conductor.js';
import { makeNoteEvent, Role } from '../src/core/NoteEvent.js';

const BASE_Y = 480;
const STEP_S = 1000 / 120 / 1000;

function fakeEnergyCurves(value) {
  return { sample: () => value };
}

// Band 1 drives the bass-buzz micro-vibration; every other band drives the
// EQ-bar height. Splitting them lets tests build a real EQ offset without
// the buzz's own small jitter muddying flatten's exact-proportionality math.
function fakeEnergyCurvesBanded(bassValue, otherValue) {
  return { sample: (band) => (band === 1 ? bassValue : otherValue) };
}

test('bass buzz shivers the render bars over time but never touches the physics height', () => {
  const gf = new GroundField(BASE_Y, { durationMs: 0 });
  let t = 0;
  // Settle springs under sustained high bass so the buzz EMA charges up.
  for (let i = 0; i < 600; i++) { gf.update(t, STEP_S, 0, fakeEnergyCurves(1)); t += 8.33; }

  const physicsBefore = gf.heightAt(100);
  const ySamples = new Set();
  for (let i = 0; i < 30; i++) {
    gf.update(t, STEP_S, 0, fakeEnergyCurves(1));
    const bars = gf.visibleBars(0, 220, 1280);
    ySamples.add(bars[2].y.toFixed(3));
    // Physics reference must stay put (modulo spring settle residue) while the visual bars shiver.
    assert.ok(Math.abs(gf.heightAt(100) - physicsBefore) < 0.01);
    t += 8.33;
  }
  assert.ok(ySamples.size > 5, `expected the bar height to oscillate across steps, saw ${ySamples.size} distinct values`);
});

test('the Unraveling: flatten visually settles the EQ bars toward baseGroundY, but never touches heightAt (physics)', () => {
  const gf = new GroundField(BASE_Y, { durationMs: 0 });
  let t = 0;
  // Let the springs settle under strong non-bass energy (bass=0 so the
  // buzz micro-vibration stays silent) so slices sit away from
  // baseGroundY purely from the EQ-offset before we test flattening.
  const energy = fakeEnergyCurvesBanded(0, 1);
  for (let i = 0; i < 600; i++) { gf.update(t, STEP_S, 0, energy); t += 8.33; }

  const physicsHeight = gf.heightAt(100);
  const barsBefore = gf.visibleBars(0, 220, 1280);
  assert.ok(barsBefore.some((b) => Math.abs(b.y - BASE_Y) > 1), 'slices should be visibly offset before flattening');

  gf.flatten = 1;
  const barsFlat = gf.visibleBars(0, 220, 1280);
  for (const b of barsFlat) assert.ok(Math.abs(b.y - BASE_Y) < 0.05, `expected slice ${b.x} to lie flat at baseGroundY, got y=${b.y}`);

  // Physics reference is untouched by flatten, at any value.
  assert.ok(Math.abs(gf.heightAt(100) - physicsHeight) < 1e-9);
});

test('flatten interpolates smoothly between the offset and flat bar heights', () => {
  const gf = new GroundField(BASE_Y, { durationMs: 0 });
  let t = 0;
  const energy = fakeEnergyCurvesBanded(0, 1);
  for (let i = 0; i < 600; i++) { gf.update(t, STEP_S, 0, energy); t += 8.33; }

  gf.flatten = 0;
  const yFull = gf.visibleBars(0, 220, 1280)[2].y;
  gf.flatten = 0.5;
  const yHalf = gf.visibleBars(0, 220, 1280)[2].y;
  gf.flatten = 1;
  const yFlat = gf.visibleBars(0, 220, 1280)[2].y;

  const offsetFull = Math.abs(yFull - BASE_Y);
  const offsetHalf = Math.abs(yHalf - BASE_Y);
  assert.ok(Math.abs(offsetHalf - offsetFull * 0.5) < 0.01, `expected the half-flattened offset to be half the full offset, got full=${offsetFull} half=${offsetHalf}`);
  assert.ok(Math.abs(yFlat - BASE_Y) < 0.05);
});

test('bass buzz is phase-staggered across neighboring slices, not lockstep', () => {
  const gf = new GroundField(BASE_Y, { durationMs: 0 });
  let t = 0;
  for (let i = 0; i < 600; i++) { gf.update(t, STEP_S, 0, fakeEnergyCurves(1)); t += 8.33; }
  const bars = gf.visibleBars(0, 220, 1280);
  const offsets = bars.slice(0, 5).map((b) => b.y);
  const distinct = new Set(offsets.map((y) => y.toFixed(2)));
  assert.ok(distinct.size >= 4, 'neighboring slices should sit at different buzz phases');
});

function buildConductor(durationMs, kickPeriodMs = 500) {
  const timeline = [];
  for (let t = 0; t < durationMs; t += kickPeriodMs) {
    timeline.push(makeNoteEvent({ tMs: t, pitch: 36, vel: 0.8, role: Role.RHYTHM, kick: true, src: 'audio' }));
  }
  const conductor = new Conductor();
  conductor.load({ timeline, barGrid: [], durationMs });
  return conductor;
}

test('GroundField generates slices ahead of worldX and trims ones far behind', () => {
  const gf = new GroundField(BASE_Y, { durationMs: 0 });
  gf.update(0, STEP_S, 0, fakeEnergyCurves(0.5));
  const initialCount = gf.slices.length;
  assert.ok(initialCount > 5);

  // Scroll far forward -- old slices should get trimmed, new ones generated.
  for (let i = 0; i < 500; i++) gf.update(i * 8.33, STEP_S, i * 20, fakeEnergyCurves(0.5));
  assert.ok(gf.slices[0].worldXStart > 0, 'slices behind worldX should have been trimmed');
});

test('GroundField.heightAt settles toward the energy-driven target over time', () => {
  const gf = new GroundField(BASE_Y, { durationMs: 0 });
  let t = 0;
  for (let i = 0; i < 300; i++) { gf.update(t, STEP_S, 0, fakeEnergyCurves(1)); t += 8.33; }
  const y = gf.heightAt(0);
  // High energy should have lifted this slice noticeably above baseline.
  assert.ok(y < BASE_Y - 10, `expected the ground to rise with high energy, got ${y}`);
});

test('GroundField never schedules a gag for a very short song', () => {
  const gf = new GroundField(BASE_Y, { durationMs: 5000, songSeed: 1 });
  assert.equal(gf._gagQueue.length, 0);
});

test('GroundField schedules 1-2 gags in the back half of a long song', () => {
  const gf = new GroundField(BASE_Y, { durationMs: 120000, songSeed: 1 });
  assert.ok(gf._gagQueue.length >= 1 && gf._gagQueue.length <= 2);
  for (const tMs of gf._gagQueue) {
    assert.ok(tMs >= 120000 * 0.5 && tMs <= 120000 * 0.92);
  }
});

test('GroundField gag sinks a run of slices then recovers with justRecovered firing once', () => {
  const durationMs = 20000;
  const conductor = buildConductor(durationMs, 500);
  const gf = new GroundField(BASE_Y, { conductor, durationMs, songSeed: 3 });
  // Force a gag to fire immediately for a deterministic test.
  gf._gagQueue = [1000];

  let worldX = 0;
  let t = 0;
  const dtMs = 8.33;
  let sawSink = false;
  let recoverCount = 0;
  const minYSeen = { v: Infinity };

  while (t < durationMs) {
    conductor.dispatchUpTo(t);
    gf.update(t, dtMs / 1000, worldX, fakeEnergyCurves(0.3));
    worldX += 220 * (dtMs / 1000); // baseline scroll speed
    const y = gf.heightAt(worldX);
    minYSeen.v = Math.min(minYSeen.v, worldX); // just to keep worldX referenced
    if (gf.justRecovered) recoverCount++;
    t += dtMs;
    if (t > 1000 && t < 6000) {
      // Check whether any slice near current worldX is visibly sagging (y > baseline).
      if (y > BASE_Y + 20) sawSink = true;
    }
    if (recoverCount > 0 && t > 8000) break;
  }

  assert.ok(sawSink, 'expected the ground to visibly sag during the gag window');
  assert.ok(recoverCount >= 1, 'expected justRecovered to fire at least once');
});

test('pulseAt sinks the nearest slice by the given amount and recovers on schedule', () => {
  const gf = new GroundField(BASE_Y, { durationMs: 0 });
  let t = 0;
  gf.update(t, STEP_S, 0, fakeEnergyCurves(0));
  gf.pulseAt(t, 50, 40, t + 300); // sink 40px at worldX=50, recover at t+300ms

  let sawSink = false;
  while (t < 1500) {
    t += 8.33;
    gf.update(t, STEP_S, 0, fakeEnergyCurves(0));
    if (gf.heightAt(50) > BASE_Y + 15) sawSink = true;
  }
  assert.ok(sawSink, 'the pulsed slice should visibly sink toward the requested depth');
  // After recovering, it should settle back near baseline (no residual gag state).
  assert.ok(Math.abs(gf.heightAt(50) - BASE_Y) < 5, `expected settle near baseline, got ${gf.heightAt(50)}`);
});

test('pulseAt with a negative sag rises the slice (a mole-ridge bump)', () => {
  const gf = new GroundField(BASE_Y, { durationMs: 0 });
  let t = 0;
  gf.update(t, STEP_S, 0, fakeEnergyCurves(0));
  gf.pulseAt(t, 50, -7, t + 220);

  let minY = Infinity;
  while (t < 400) {
    t += 8.33;
    gf.update(t, STEP_S, 0, fakeEnergyCurves(0));
    minY = Math.min(minY, gf.heightAt(50));
  }
  assert.ok(minY < BASE_Y - 1, `expected the ground to rise for a negative pulse, min height ${minY}`);
});

test('pulseAt fires justRecovered once, like the scripted gag', () => {
  const gf = new GroundField(BASE_Y, { durationMs: 0 });
  let t = 0;
  gf.update(t, STEP_S, 0, fakeEnergyCurves(0));
  gf.pulseAt(t, 50, 30, t + 200);

  let recoverCount = 0;
  while (t < 1200) {
    t += 8.33;
    gf.update(t, STEP_S, 0, fakeEnergyCurves(0));
    if (gf.justRecovered) recoverCount++;
  }
  assert.equal(recoverCount, 1);
});

test('a second pulseAt on the same slice before the first resolves still recovers cleanly', () => {
  const gf = new GroundField(BASE_Y, { durationMs: 0 });
  let t = 0;
  gf.update(t, STEP_S, 0, fakeEnergyCurves(0));
  gf.pulseAt(t, 50, 40, t + 1000);
  t += 100;
  gf.update(t, STEP_S, 0, fakeEnergyCurves(0));
  gf.pulseAt(t, 50, -7, t + 220); // re-pulse before the first has recovered

  let ranWithoutThrowing = true;
  try {
    while (t < 2000) {
      t += 8.33;
      gf.update(t, STEP_S, 0, fakeEnergyCurves(0));
    }
  } catch {
    ranWithoutThrowing = false;
  }
  assert.ok(ranWithoutThrowing);
  assert.ok(Math.abs(gf.heightAt(50) - BASE_Y) < 5, 'should still settle back near baseline eventually');
});
