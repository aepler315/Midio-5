import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RainbowBrush } from '../src/render/RainbowBrush.js';

function fakeCtx2d() {
  const compositeOps = [];
  return {
    compositeOps,
    save() {}, restore() {},
    fillRect() {},
    set globalCompositeOperation(v) { compositeOps.push(v); },
    set globalAlpha(v) {},
    set fillStyle(v) {},
  };
}

test('draw() falls back to source-over compositing under reducedFlash', () => {
  // Dabs stack additively during a dense flurry of jumps and can overlap
  // ImpactFX/RippleFX layers at the same landing point -- reducedFlash must
  // fall the whole trail back to normal compositing, not just cap alpha.
  const brush = new RainbowBrush();
  brush.update(0, true, 100, 500);
  brush.update(16, true, 110, 495);

  const normalCtx = fakeCtx2d();
  brush.draw(normalCtx, 100, 300, 16, 1, false);
  assert.ok(normalCtx.compositeOps.includes('lighter'), 'normal draw uses additive compositing');

  const reducedCtx = fakeCtx2d();
  brush.draw(reducedCtx, 100, 300, 16, 1, true);
  assert.ok(!reducedCtx.compositeOps.includes('lighter'), 'reducedFlash must not use additive compositing');
  assert.ok(reducedCtx.compositeOps.includes('source-over'), 'reducedFlash falls back to source-over');
});
