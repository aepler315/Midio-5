import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ComposerStrip, iconFor, popBump, stratifyCap, STAFF_ROWS, diatonicIndex, estimateTonicPc,
} from '../src/render/ComposerStrip.js';
import { RainbowBrush } from '../src/render/RainbowBrush.js';
import { ImpactFX } from '../src/sim/ImpactFX.js';
import { Role } from '../src/core/NoteEvent.js';

function note(tMs, role, pitch = 60, vel = 0.7, kick = false) {
  return { tMs, role, pitch, vel, kick };
}

const BAR_GRID = Array.from({ length: 16 }, (_, i) => ({ ms: i * 2000 }));

test('ComposerStrip pages span four bars and bucket notes by time', () => {
  const timeline = [note(100, Role.MELODY), note(7900, Role.BASS), note(8100, Role.PAD)];
  const strip = new ComposerStrip(timeline, BAR_GRID, 32000);
  assert.equal(strip.pageMs, 8000);
  assert.equal(strip.pages[0].length, 2);
  assert.equal(strip.pages[1].length, 1);
  assert.equal(strip.pageIndexAt(7999), 0);
  assert.equal(strip.pageIndexAt(8000), 1);
  assert.ok(Math.abs(strip.playheadFrac(4000) - 0.5) < 1e-9);
});

test('ComposerStrip caps dense pages at 64 icons, keeping the loudest, back in time order', () => {
  const timeline = [];
  for (let i = 0; i < 200; i++) timeline.push(note(i * 30, Role.MELODY, 60 + (i % 12), (i % 100) / 100));
  const strip = new ComposerStrip(timeline, BAR_GRID, 32000);
  const page = strip.pages[0];
  assert.equal(page.length, 64);
  for (let i = 1; i < page.length; i++) assert.ok(page[i].tMs >= page[i - 1].tMs, 'page must stay in time order');
  // Everything kept should be at least as loud as the loudest discarded... spot-check: no kept note below vel 0.15.
  for (const evt of page) assert.ok(evt.vel >= 0.15);
});

test('a dense uniform-velocity page keeps notes across the WHOLE viewport, not just its first half', () => {
  // Regression: velocity rescaling clamps many real MIDIs to vel=1.0 across
  // the board; the old loudest-first cap (stable sort) then kept the first
  // 64 notes IN TIME ORDER, so icons only ever appeared at the start of
  // each page — the "strip only shows notes in its first half" bug.
  const timeline = [];
  for (let i = 0; i < 300; i++) timeline.push(note(i * 26, Role.MELODY, 60 + (i % 12), 1.0));
  const strip = new ComposerStrip(timeline, BAR_GRID, 32000); // pageMs 8000
  const page = strip.pages[0];
  assert.equal(page.length, 64);
  const fx = page.map((e) => e.tMs / strip.pageMs);
  assert.ok(Math.max(...fx) > 0.85, `latest kept icon at fx=${Math.max(...fx)} — right side empty`);
  for (let q = 0; q < 4; q++) {
    const inQuarter = fx.filter((f) => f >= q / 4 && f < (q + 1) / 4).length;
    assert.ok(inQuarter >= 8, `page quarter ${q} nearly empty (${inQuarter} icons)`);
  }
});

test('stratifyCap still prefers the loudest notes within each time slot', () => {
  const events = [];
  for (let i = 0; i < 128; i++) {
    events.push(note(i * 62.5, Role.MELODY, 60, i % 2 ? 0.9 : 0.3)); // loud/soft alternating
  }
  const kept = stratifyCap(events, 32, 0, 8000);
  assert.equal(kept.length, 32);
  const loudShare = kept.filter((e) => e.vel > 0.5).length / kept.length;
  assert.ok(loudShare >= 0.9, `loud notes should dominate the kept set, got ${loudShare}`);
});

test('ComposerStrip staff rows quantize pitch: higher pitch sits higher on the staff', () => {
  const timeline = [note(0, Role.MELODY, 50), note(10, Role.MELODY, 60), note(20, Role.MELODY, 70)];
  const strip = new ComposerStrip(timeline, BAR_GRID, 32000);
  const lo = strip.staffRow(50), mid = strip.staffRow(60), hi = strip.staffRow(70);
  assert.ok(hi <= mid && mid <= lo, `expected descending rows, got ${hi}, ${mid}, ${lo}`);
  for (const r of [lo, mid, hi]) assert.ok(Number.isInteger(r) && r >= 0 && r <= STAFF_ROWS - 1);
});

test('diatonicIndex: ascending pitch never decreases in diatonic step (C4 < D4 < E4)', () => {
  const tonicPc = 0; // C
  const c4 = diatonicIndex(60, tonicPc); // C4
  const d4 = diatonicIndex(62, tonicPc); // D4
  const e4 = diatonicIndex(64, tonicPc); // E4
  assert.ok(c4.step < d4.step && d4.step < e4.step, `expected ascending steps, got ${c4.step}, ${d4.step}, ${e4.step}`);
  assert.equal(c4.accidental, false);
  assert.equal(d4.accidental, false);
  assert.equal(e4.accidental, false);
  // A full octave up is exactly 7 diatonic steps.
  const c5 = diatonicIndex(72, tonicPc);
  assert.equal(c5.step - c4.step, 7);
});

test('diatonicIndex: accidentals flagged relative to the tonic\'s major scale', () => {
  const tonicPc = 0; // C major: C D E F G A B natural, C#/D#/F#/G#/A# accidental
  assert.equal(diatonicIndex(60, 0).accidental, false); // C
  assert.equal(diatonicIndex(61, 0).accidental, true);  // C#
  assert.equal(diatonicIndex(62, 0).accidental, false); // D
  assert.equal(diatonicIndex(65, 0).accidental, false); // F
  assert.equal(diatonicIndex(66, 0).accidental, true);  // F#
  void tonicPc;
});

test('diatonicIndex: step is monotone non-decreasing across a full chromatic run', () => {
  let prevStep = -Infinity;
  for (let p = 40; p <= 100; p++) {
    const { step } = diatonicIndex(p, 3); // arbitrary tonic (D#/Eb)
    assert.ok(step >= prevStep, `step decreased at pitch ${p}`);
    prevStep = step;
  }
});

test('estimateTonicPc: weighted by duration*velocity, ignores RHYTHM, empty -> C', () => {
  assert.equal(estimateTonicPc([]), 0);
  assert.equal(estimateTonicPc([{ role: Role.RHYTHM, pitch: 36, durMs: 90, vel: 1 }]), 0);
  // A long, loud C should dominate a handful of short, quiet others.
  const timeline = [
    { role: Role.MELODY, pitch: 60, durMs: 4000, vel: 0.9 }, // C, dominant
    { role: Role.MELODY, pitch: 67, durMs: 50, vel: 0.2 },   // G, brief
    { role: Role.RHYTHM, pitch: 42, durMs: 4000, vel: 1 },   // percussion, must be ignored
  ];
  assert.equal(estimateTonicPc(timeline), 0);
});

test('rowInfo: ledger flag fires only outside the drawn staff', () => {
  const timeline = [note(0, Role.MELODY, 60), note(10, Role.MELODY, 62), note(20, Role.MELODY, 64)];
  const strip = new ComposerStrip(timeline, BAR_GRID, 32000);
  const near = strip.rowInfo(60);
  assert.equal(near.ledger, false);
  const farAbove = strip.rowInfo(60 + 12 * 6); // six octaves up
  assert.equal(farAbove.ledger, true);
  assert.ok(farAbove.row >= 0 && farAbove.row <= STAFF_ROWS - 1, 'row must still clamp into range');
});

test('RHYTHM notes are excluded from the pitch percentile clip', () => {
  const timeline = [
    note(0, Role.MELODY, 60), note(10, Role.MELODY, 62), note(20, Role.MELODY, 64),
    note(30, Role.RHYTHM, 20, 0.8, true), // absurd low GM pitch, must not skew the staff
  ];
  const strip = new ComposerStrip(timeline, BAR_GRID, 32000);
  const melodicRows = [60, 62, 64].map((p) => strip.staffRow(p));
  for (const r of melodicRows) assert.ok(r >= 0 && r <= STAFF_ROWS - 1);
  // The rhythm note's absurd pitch must not have widened pMin/pMax toward it.
  assert.ok(strip.sMid > diatonicIndex(20, strip.tonicPc).step);
});

test('ComposerStrip constructor stays DOM-free', () => {
  assert.doesNotThrow(() => new ComposerStrip(
    [note(0, Role.MELODY, 60), note(10, Role.RHYTHM, 36, 0.8, true)], BAR_GRID, 32000,
  ));
});

test('icon language maps every role, with the kick getting the wheel', () => {
  assert.equal(iconFor({ role: Role.RHYTHM, kick: true }), 'wheel');
  assert.equal(iconFor({ role: Role.RHYTHM, kick: false }), 'drum');
  assert.equal(iconFor({ role: Role.MELODY }), 'star');
  assert.equal(iconFor({ role: Role.BASS }), 'heart');
  assert.equal(iconFor({ role: Role.PAD }), 'flower');
});

test('popBump peaks right at the onset and dies away outside the pop window', () => {
  assert.ok(popBump(30) > 0.95);
  assert.ok(popBump(30) > popBump(120));
  assert.equal(popBump(-200), 0);
  assert.equal(popBump(400), 0);
});

test('RainbowBrush paints only while airborne, respects stroke spacing, caps and expires dabs', () => {
  const brush = new RainbowBrush();
  brush.update(0, false, 0, 400);
  assert.equal(brush.dabs.length, 0);

  // Airborne sweep: dabs at ~9px spacing along the stroke.
  for (let i = 0; i <= 90; i++) brush.update(i * 10, true, i * 3, 400 - i);
  const afterSweep = brush.dabs.length;
  assert.ok(afterSweep > 10 && afterSweep < 91, `spacing should thin the stroke, got ${afterSweep}`);

  // Hovering in place adds nothing.
  for (let i = 0; i < 50; i++) brush.update(1000 + i, true, 270, 310);
  assert.equal(brush.dabs.length, afterSweep);

  // Cap: an endless stroke can't exceed the ring buffer.
  for (let i = 0; i < 5000; i++) brush.update(2000 + i, true, 300 + i * 10, 400);
  assert.ok(brush.dabs.length <= 320);
});

test('paint splats spawn chunky blobs and age out through the pool', () => {
  const fx = new ImpactFX(3);
  fx.splat(1000, 480);
  assert.equal(fx.splats.active.length, 1);
  const splat = fx.splats.active[0];
  assert.ok(splat.blobs.length >= 6);
  for (const b of splat.blobs) assert.ok(Number.isFinite(b.dx + b.dy + b.s));

  for (let i = 0; i < 400; i++) fx.step(1 / 120); // 3.3s > 2.8s life
  assert.equal(fx.splats.active.length, 0);
});
