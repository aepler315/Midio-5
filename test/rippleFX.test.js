import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rippleRadius, rippleAlpha, rippleLifeMs, groundPulseX, RippleFX } from '../src/sim/RippleFX.js';

test('rippleRadius grows monotonically within life, scales with I, and is finite', () => {
  for (const I of [0, 0.3, 0.7, 1]) {
    let prev = -1;
    const life = rippleLifeMs(I);
    for (let age = 0; age <= life; age += 40) {
      const r = rippleRadius(age, I);
      assert.ok(Number.isFinite(r));
      assert.ok(r >= prev - 1e-9, `radius must not shrink: ${r} < ${prev} at age=${age}, I=${I}`);
      prev = r;
    }
  }
  assert.ok(rippleRadius(9999, 1) > rippleRadius(9999, 0), 'harder landings ripple farther');
});

test('rippleAlpha fades to (near) zero by the end of life and is bounded', () => {
  for (const I of [0, 0.5, 1]) {
    const life = rippleLifeMs(I);
    const start = rippleAlpha(0, I);
    assert.ok(start > 0 && start <= 1);
    assert.ok(rippleAlpha(life, I) === 0, 'alpha must reach zero at end of life');
    assert.ok(rippleAlpha(life * 0.5, I) < start, 'alpha must decrease over time');
  }
});

test('groundPulseX moves outward monotonically and scales with I', () => {
  let prev = -1;
  for (let age = 0; age <= 700; age += 50) {
    const d = groundPulseX(age, 0.8);
    assert.ok(Number.isFinite(d));
    assert.ok(d >= prev - 1e-9);
    prev = d;
  }
  assert.ok(groundPulseX(300, 1) >= groundPulseX(300, 0));
});

test('RippleFX: trigger spawns staggered rings and a pulse; they all drain over time', () => {
  const fx = new RippleFX();
  fx.trigger(1000, 540, 0.9);
  assert.equal(fx.rings.active.length, 3, 'expects RIPPLE_RINGS staggered rings');
  assert.equal(fx.pulses.active.length, 1);
  // Staggered starts: ring ages should differ (negative delay before they show).
  const ages = fx.rings.active.map((r) => r.age);
  assert.ok(new Set(ages).size > 1, 'rings must be staggered, not simultaneous');
  for (let i = 0; i < 60; i++) fx.update(50); // 3s, well past any life
  assert.equal(fx.rings.active.length, 0);
  assert.equal(fx.pulses.active.length, 0);
});

test('RippleFX.draw runs without throwing and only draws finite geometry', () => {
  const fx = new RippleFX();
  fx.trigger(500, 540, 0.6);
  const calls = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, stroke() {}, moveTo(x, y) { calls.push(x, y); }, lineTo(x, y) { calls.push(x, y); },
    ellipse(x, y, rx, ry) { calls.push(x, y, rx, ry); },
    set globalCompositeOperation(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
  };
  assert.doesNotThrow(() => fx.draw(ctx, 500, 220, false));
  assert.ok(calls.length > 0);
  for (const v of calls) assert.ok(Number.isFinite(v));
});
