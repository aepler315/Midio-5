// Midio's always-on motion. He was the only one of the trio who stood still
// between events, which is what forced a walk cycle onto a nine-vertex
// crystal shard. These pin the properties that make the motion CONSTANT --
// the thing that actually retires the gait -- rather than the exact curve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  midioHoverPx, midioPrecessDeg, midioCoreSpinDeg, midioMotion,
  HOVER_LIFT_PX, PRECESS_BASE_DEG, PRECESS_ENERGY_DEG, CORE_SPIN_BASE_DPS,
} from '../src/render/MidioMotion.js';

test('he never touches the ground line -- there is no gait to animate', () => {
  // Negative is up. The lift has to hold even in dead silence, or he settles
  // onto the ground and needs feet again.
  for (let t = 0; t < 40; t += 0.13) {
    assert.ok(midioHoverPx(t, 0) <= -HOVER_LIFT_PX * 0.5,
      `t=${t.toFixed(2)} let him sink to ${midioHoverPx(t, 0)}`);
  }
});

test('the hover never settles, at any energy -- it is motion, not a pose', () => {
  for (const e of [0, 0.5, 1]) {
    const seen = new Set();
    for (let t = 0; t < 25; t += 0.05) seen.add(midioHoverPx(t, e).toFixed(2));
    assert.ok(seen.size > 40, `energy=${e} produced only ${seen.size} distinct heights`);
  }
});

test('energy raises the hover swing without ever letting him touch down', () => {
  const span = (e) => {
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < 30; t += 0.02) { const v = midioHoverPx(t, e); if (v < lo) lo = v; if (v > hi) hi = v; }
    return { lo, hi, span: hi - lo };
  };
  const calm = span(0), loud = span(1);
  assert.ok(loud.span > calm.span * 1.4, `loud should swing wider: ${calm.span} -> ${loud.span}`);
  assert.ok(loud.hi < 0 && calm.hi < 0, 'the top of the swing is still above the ground line');
});

test('precession sways both ways and stays well short of falling over', () => {
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < 60; t += 0.03) {
    const v = midioPrecessDeg(t, 1);
    if (v < lo) lo = v; if (v > hi) hi = v;
  }
  assert.ok(lo < -1 && hi > 1, 'must sway to both sides, not lean one way');
  const bound = PRECESS_BASE_DEG + PRECESS_ENERGY_DEG;
  assert.ok(hi <= bound + 1e-6 && lo >= -bound - 1e-6, `sway ${lo}..${hi} exceeded its own bound ${bound}`);
});

test('the core spin only ever advances -- it can never stall on a beat', () => {
  let prev = -Infinity;
  for (let t = 0; t < 30; t += 0.05) {
    const v = midioCoreSpinDeg(t, 0);
    assert.ok(v >= prev, `spin went backwards at t=${t}`);
    prev = v;
  }
  // And it keeps turning in silence: that is the "powered, not adrift" cue.
  assert.ok(midioCoreSpinDeg(10, 0) >= 10 * CORE_SPIN_BASE_DPS - 1e-6);
  assert.ok(midioCoreSpinDeg(10, 1) > midioCoreSpinDeg(10, 0), 'energy spins it faster');
});

test('reduced motion scales everything toward rest, and 0 is a full stop', () => {
  // The accessibility toggle is exactly what this is for.
  const full = midioMotion(3.3, 1, 1);
  const reduced = midioMotion(3.3, 1, 0.25);
  assert.ok(Math.abs(reduced.hoverPx) < Math.abs(full.hoverPx));
  assert.ok(Math.abs(reduced.precessDeg) < Math.abs(full.precessDeg));
  assert.ok(reduced.coreSpinDeg < full.coreSpinDeg);
  const off = midioMotion(3.3, 1, 0);
  assert.deepEqual(off, { hoverPx: 0, precessDeg: 0, coreSpinDeg: 0 });
});

test('every term is finite across a long run at every energy', () => {
  for (const e of [0, 0.37, 1]) {
    for (let t = 0; t < 600; t += 7.3) {
      const m = midioMotion(t, e);
      assert.ok(Number.isFinite(m.hoverPx) && Number.isFinite(m.precessDeg) && Number.isFinite(m.coreSpinDeg));
    }
  }
});
