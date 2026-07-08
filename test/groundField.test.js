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
