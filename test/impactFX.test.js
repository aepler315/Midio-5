import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImpactFX } from '../src/sim/ImpactFX.js';

function fakeCtx2d() {
  const noop = () => {};
  const strokeAlphas = [];
  const compositeOps = [];
  return {
    strokeAlphas,
    compositeOps,
    save: noop, restore: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop, fill: noop,
    fillRect: noop, ellipse: noop, arc: noop,
    createRadialGradient() { return { addColorStop: noop }; },
    set fillStyle(v) {},
    set lineWidth(v) {},
    set globalAlpha(v) {},
    set globalCompositeOperation(v) { compositeOps.push(v); },
    set strokeStyle(v) {
      const m = /rgba\([^,]+,[^,]+,[^,]+,([\d.]+)\)/.exec(v);
      if (m) strokeAlphas.push(parseFloat(m[1]));
    },
  };
}

test('trigger() never throws once the ring pool is exhausted', () => {
  const fx = new ImpactFX(1);
  // The ring pool caps at 16 (see ImpactFX.js constructor); each trigger()
  // spawns one ring, so the 17th call finds ObjectPool.spawn() returning
  // null and used to throw dereferencing ring.jitter.
  assert.doesNotThrow(() => {
    for (let i = 0; i < 40; i++) fx.trigger(i * 10, 500, 0.8, null);
  });
});

test('judgment() never throws once the ring pool is exhausted', () => {
  const fx = new ImpactFX(1);
  assert.doesNotThrow(() => {
    for (let i = 0; i < 40; i++) fx.judgment(i * 10, 500, 'perfect');
  });
});

test('draw() caps flash-heavy alpha (crater, dust ring, ignition) when reducedFlash is set', () => {
  const fx = new ImpactFX(1);
  fx.trigger(0, 500, 1, null);
  fx.ignite(0, 500);
  fx.step(0.01); // age the pools slightly off their alpha=peak initial frame

  const normalCtx = fakeCtx2d();
  fx.draw(normalCtx, 0, 0, false);
  const reducedCtx = fakeCtx2d();
  fx.draw(reducedCtx, 0, 0, true);

  assert.ok(normalCtx.strokeAlphas.length > 0, 'expected at least one stroked ring/ignition');
  const normalMax = Math.max(...normalCtx.strokeAlphas);
  const reducedMax = Math.max(...reducedCtx.strokeAlphas);
  assert.ok(reducedMax <= normalMax, 'reducedFlash must never exceed the normal alpha');
  assert.ok(reducedMax <= 0.4 + 1e-9, 'reducedFlash must cap alpha at the flash cap');
});

test('draw() falls the ignition ring back to source-over compositing under reducedFlash', () => {
  // The ignition ring draws additively ('lighter'); on its own each capped
  // layer stays under FLASH_CAP, but overlapping additive layers (this ring
  // plus RippleFX's rings/pulses/puffs, all landing on the same ground
  // point) can still sum past it. Falling back to source-over is what
  // actually stops that stack, so assert the composite op itself changes.
  const fx = new ImpactFX(1);
  fx.ignite(0, 500);
  fx.step(0.01);

  const normalCtx = fakeCtx2d();
  fx.draw(normalCtx, 0, 0, false);
  assert.ok(normalCtx.compositeOps.includes('lighter'), 'normal draw uses additive compositing');

  const reducedCtx = fakeCtx2d();
  fx.draw(reducedCtx, 0, 0, true);
  assert.ok(!reducedCtx.compositeOps.includes('lighter'), 'reducedFlash must not use additive compositing');
  assert.ok(reducedCtx.compositeOps.includes('source-over'), 'reducedFlash falls back to source-over');
});

test('splat() thins its blob count under a lower particleMul', () => {
  // Previously splat() ignored particleMul entirely -- a shed device kept
  // full splat cost while trigger()/judgment() thinned by 40%.
  const full = new ImpactFX(3);
  full.splat(0, 500, 1);
  const shed = new ImpactFX(3);
  shed.splat(0, 500, 0.6);
  assert.ok(shed.splats.active[0].blobs.length < full.splats.active[0].blobs.length);
  assert.ok(shed.splats.active[0].blobs.length >= 2, 'never thins below a visible minimum');
});

test('sputter() accumulates motes slower under a lower particleMul', () => {
  // Previously the telegraph sputter ran at a fixed rate regardless of perf
  // level -- the ambient effect keeping full spawn rate while the landing
  // burst it surrounds thinned out is exactly backwards.
  const full = new ImpactFX(4);
  full.sputter(0, 500, 1, 1); // 1 sim-second at full rate
  const fullCount = full.motes.active.length;

  const shed = new ImpactFX(4);
  shed.sputter(0, 500, 1, 0.6);
  const shedCount = shed.motes.active.length;

  assert.ok(shedCount < fullCount, `shed sputter (${shedCount}) should spawn fewer motes than full (${fullCount})`);
});
