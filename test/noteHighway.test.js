import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NoteHighway } from '../src/render/NoteHighway.js';

const CANVAS = { width: 1280, height: 720 };

function fakeCtx() {
  const calls = { fillRect: 0, arc: 0, stroke: 0, fill: 0, save: 0 };
  return {
    calls,
    save() { calls.save++; }, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    quadraticCurveTo() {}, setLineDash() {}, arc() { calls.arc++; },
    fill() { calls.fill++; }, stroke() { calls.stroke++; },
    fillRect() { calls.fillRect++; }, strokeRect() {},
    fillText() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    set fillStyle(_v) {}, set strokeStyle(_v) {}, set lineWidth(_v) {},
    set globalAlpha(_v) {}, set globalCompositeOperation(_v) {}, set font(_v) {}, set textAlign(_v) {},
  };
}

test('onJudge is DOM-free and does not throw at construction or on any stepEvent kind', () => {
  const hw = new NoteHighway([]);
  const kinds = [
    { kind: 'hit', tier: 'perfect', tMs: 1000, offsetMs: 3 },
    { kind: 'hit', tier: 'great', tMs: 1000 },
    { kind: 'hit', tier: 'good', tMs: 1000 },
    { kind: 'hit', tier: 'sour', tMs: 1000 },
    { kind: 'sour', tMs: 1000 },
    { kind: 'miss', tMs: 1000 },
    { kind: 'holdStart', tier: 'perfect', tMs: 1000 },
    { kind: 'holdStart', tier: null, tMs: 1000 }, // late-armed hold: should stay quiet
    { kind: 'holdTick', tMs: 1000 },
    { kind: 'holdComplete', tMs: 1000 },
    { kind: 'holdChoke', tMs: 1000 },
  ];
  for (const evt of kinds) assert.doesNotThrow(() => hw.onJudge(evt, 1000, 1));
});

test('onJudge spawns an impact for a scored hit but not for a quiet late-armed hold', () => {
  const hw = new NoteHighway([]);
  hw.onJudge({ kind: 'holdStart', tier: null, tMs: 1000 }, 1000, 1);
  assert.equal(hw._impacts.length, 0, 'a null-tier holdStart (late-armed) must not spawn an impact');
  hw.onJudge({ kind: 'hit', tier: 'perfect', tMs: 1000 }, 1000, 1);
  assert.equal(hw._impacts.length, 1);
  assert.equal(hw._impacts[0].kind, 'perfect');
});

test('onJudge maps every stepEvent kind to the expected impact kind', () => {
  const cases = [
    [{ kind: 'hit', tier: 'perfect' }, 'perfect'],
    [{ kind: 'hit', tier: 'great' }, 'great'],
    [{ kind: 'hit', tier: 'good' }, 'good'],
    [{ kind: 'hit', tier: 'sour' }, 'sour'],
    [{ kind: 'sour' }, 'sour'],
    [{ kind: 'miss' }, 'miss'],
    [{ kind: 'holdChoke' }, 'miss'],
    [{ kind: 'holdTick' }, 'tick'],
    [{ kind: 'holdComplete' }, 'complete'],
  ];
  for (const [evt, expected] of cases) {
    const hw = new NoteHighway([]);
    hw.onJudge({ ...evt, tMs: 1000 }, 1000, 1);
    assert.equal(hw._impacts[0]?.kind, expected, `evt ${JSON.stringify(evt)} should map to '${expected}'`);
  }
});

test('onJudge respects particleMul (clamped, non-negative) and caps the impact list', () => {
  const hw = new NoteHighway([]);
  hw.onJudge({ kind: 'hit', tier: 'good' }, 1000, -3);
  assert.ok(hw._impacts[0].particleMul >= 0, 'particleMul must never go negative');

  const hw2 = new NoteHighway([]);
  for (let i = 0; i < 40; i++) hw2.onJudge({ kind: 'hit', tier: 'good' }, 1000 + i, 1);
  assert.ok(hw2._impacts.length <= 24, `expected the impact list to be capped, got ${hw2._impacts.length}`);
});

test('impacts expire and are pruned by draw() after their life', () => {
  const hw = new NoteHighway([]);
  hw.onJudge({ kind: 'hit', tier: 'perfect' }, 1000, 1);
  hw.draw(fakeCtx(), CANVAS, 1000, 220, 600, { fever: 0, reducedFlash: false });
  assert.equal(hw._impacts.length, 1);
  hw.draw(fakeCtx(), CANVAS, 5000, 220, 600, { fever: 0, reducedFlash: false });
  assert.equal(hw._impacts.length, 0, 'the impact should have expired well past its life');
});

test('setNotes() also clears any pending impacts', () => {
  const hw = new NoteHighway([]);
  hw.onJudge({ kind: 'hit', tier: 'perfect' }, 1000, 1);
  assert.equal(hw._impacts.length, 1);
  hw.setNotes([]);
  assert.equal(hw._impacts.length, 0);
});

test('draw() never throws with no options, default options, fever, or reducedFlash set', () => {
  const hw = new NoteHighway([{ tMs: 1000, vel: 0.8, kind: 'kick', isJump: true }], { approachMs: 1000 });
  hw.onJudge({ kind: 'hit', tier: 'perfect' }, 500, 2);
  hw.onJudge({ kind: 'miss' }, 500, 1);
  assert.doesNotThrow(() => hw.draw(fakeCtx(), CANVAS, 600, 220, 600));
  assert.doesNotThrow(() => hw.draw(fakeCtx(), CANVAS, 600, 220, 600, {}));
  assert.doesNotThrow(() => hw.draw(fakeCtx(), CANVAS, 600, 220, 600, { fever: 1, reducedFlash: false }));
  assert.doesNotThrow(() => hw.draw(fakeCtx(), CANVAS, 600, 220, 600, { fever: 1, reducedFlash: true }));
});

test('The Perfect Illusion: engagement <= 0.01 draws nothing but still prunes impacts/flashes', () => {
  const hw = new NoteHighway([{ tMs: 1000, vel: 0.8, kind: 'kick', isJump: true }], { approachMs: 1000 });
  hw.onJudge({ kind: 'hit', tier: 'perfect' }, 1000, 1);
  hw.addFlash(220, 300, 'perfect', 1000);
  assert.equal(hw._impacts.length, 1);
  assert.equal(hw._flash.length, 1);

  const ctx = fakeCtx();
  hw.draw(ctx, CANVAS, 1000, 220, 600, { fever: 1, reducedFlash: false, engagement: 0 });
  assert.equal(ctx.calls.save, 0, 'must return before ctx.save() while fully dormant');
  assert.equal(ctx.calls.fillRect + ctx.calls.arc + ctx.calls.fill + ctx.calls.stroke, 0, 'no draw calls while dormant');

  // Pruning still happens on a dormant frame: fast-forward well past both lives.
  hw.draw(fakeCtx(), CANVAS, 10000, 220, 600, { engagement: 0 });
  assert.equal(hw._impacts.length, 0, 'impacts must still expire while dormant');
  assert.equal(hw._flash.length, 0, 'flashes must still expire while dormant');
});

test('The Perfect Illusion: partial engagement draws normally (non-zero draw calls)', () => {
  const hw = new NoteHighway([{ tMs: 1000, vel: 0.8, kind: 'kick', isJump: true }], { approachMs: 1000 });
  hw.onJudge({ kind: 'hit', tier: 'perfect' }, 1000, 1);
  const ctx = fakeCtx();
  hw.draw(ctx, CANVAS, 1000, 220, 600, { fever: 0, reducedFlash: false, engagement: 0.5 });
  assert.ok(ctx.calls.save > 0, 'a partially-engaged frame should still draw');
  assert.ok(ctx.calls.fillRect + ctx.calls.arc + ctx.calls.fill + ctx.calls.stroke > 0);
});

test('The Perfect Illusion: default engagement (omitted) behaves as fully engaged (1)', () => {
  const hw = new NoteHighway([{ tMs: 1000, vel: 0.8, kind: 'kick', isJump: true }], { approachMs: 1000 });
  const ctx = fakeCtx();
  assert.doesNotThrow(() => hw.draw(ctx, CANVAS, 1000, 220, 600));
  assert.ok(ctx.calls.save > 0);
});
