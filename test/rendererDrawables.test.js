// Screen-space effects must be handed a real drawable, not the logical view.
//
// Renderer.draw builds a `stage` object -- a plain `{ width, height }` in
// LOGICAL units -- and passes it to every subsystem as `canvas`. That is
// correct for anything that draws shapes, because the context is already
// under the sx/sy transform. But it is not a drawable, so any effect that
// samples the composed frame has to reach for the real backing store
// (`ctx.canvas`) instead.
//
// Two effects got this wrong and threw on every invocation. Because main.js
// wraps the whole draw in a try/catch, the throw was swallowed -- and took
// the entire remainder of that frame with it: the drop-impact pack, bloom,
// the film finish and the HUD strip. On hard hits, which is exactly when the
// hype echo fires. Neither effect had ever rendered.
//
// These tests need no canvas: they record what reaches drawImage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/render/Renderer.js';

const STAGE_W = 1280, STAGE_H = 720;
const DEVICE_W = 2560, DEVICE_H = 1440; // a 2x backing store

/** A context stub that records drawImage and tolerates everything else. */
function recordingCtx() {
  const calls = [];
  const backing = { width: DEVICE_W, height: DEVICE_H, __isCanvas: true };
  const ctx = {
    canvas: backing,
    drawImage: (...args) => calls.push(args),
    save() {}, restore() {}, beginPath() {}, stroke() {}, fill() {},
    roundRect() {}, rect() {}, arc() {}, moveTo() {}, lineTo() {},
    fillRect() {}, closePath() {}, translate() {}, rotate() {}, setTransform() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    strokeStyle: '', fillStyle: '', lineWidth: 1, lineCap: '', lineJoin: '', filter: '',
  };
  return { ctx, calls, backing };
}

/** The logical view draw() hands around -- deliberately NOT a drawable. */
function stageView() {
  return { width: STAGE_W, height: STAGE_H };
}

/** A sim with the hype hard enough that the echo branch runs. */
function hypeSim({ reducedFlash = false, particleMul = 1 } = {}) {
  return {
    timeMs: 10000,
    // surge > 0.45 is what opens the echo branch (see hypeFrameStyle).
    hype: { slam: 1, surge: 1, fast: 1, dropAtMs: 10000 },
    calm: { level: 0 },
    fever: { level: 0 },
    reducedFlash,
    perf: { particleMul, heavyPostFx: true },
    biomes: { currentHaloColor: () => '#ffdca0' },
    midio: { groundY: 540, screenX: 300, renderY: 400 },
  };
}

test('the hype echo samples the real backing store, never the logical view', () => {
  const r = Object.create(Renderer.prototype);
  const { ctx, calls, backing } = recordingCtx();
  const stage = stageView();

  r._drawHypeFrame(ctx, stage, hypeSim());

  assert.ok(calls.length > 0, 'a hard hit should draw an echo at all');
  for (const [src] of calls) {
    assert.notEqual(src, stage, 'the logical stage view is not a drawable');
    assert.equal(src, backing, 'the echo must sample the real canvas');
  }
});

test('...and lands in logical units, so it looks the same at every resolution', () => {
  const r = Object.create(Renderer.prototype);
  const { ctx, calls } = recordingCtx();
  r._drawHypeFrame(ctx, stageView(), hypeSim());

  const [src, dx, dy, dw, dh] = calls[0];
  void src; void dy;
  assert.equal(dw, STAGE_W, 'destination width must be logical, not device');
  assert.equal(dh, STAGE_H, 'destination height must be logical, not device');
  // The offset is a small logical-space nudge, not a device-pixel one.
  assert.ok(Math.abs(dx) > 0 && Math.abs(dx) < 20, `echo offset looks wrong: ${dx}`);
});

test('reduced-flash removes the echo entirely rather than shrinking it', () => {
  const r = Object.create(Renderer.prototype);
  const { ctx, calls } = recordingCtx();
  r._drawHypeFrame(ctx, stageView(), hypeSim({ reducedFlash: true }));
  assert.equal(calls.length, 0, 'a rapid self-blit ghost is exactly what the toggle removes');
});

test('a calm frame never echoes, however the transform is set up', () => {
  const r = Object.create(Renderer.prototype);
  const { ctx, calls } = recordingCtx();
  const sim = hypeSim();
  sim.hype = { slam: 0, surge: 0, fast: 0, dropAtMs: -Infinity };
  sim.calm.level = 1;
  r._drawHypeFrame(ctx, stageView(), sim);
  assert.equal(calls.length, 0);
});

test('the drop shock copies the real canvas and blits back in logical units', () => {
  const r = Object.create(Renderer.prototype);
  // The offscreen buffer the shock composites through. In Node there is no
  // document, so hand it one shaped like the canvas it would create.
  const offCalls = [];
  r._shockCanvas = {
    width: 0, height: 0,
    getContext: () => ({
      drawImage: (...a) => offCalls.push(a),
      fillRect() {}, globalCompositeOperation: '', fillStyle: '',
    }),
  };
  const { ctx, calls, backing } = recordingCtx();
  const stage = stageView();
  const pose = { midioDrawX: 300, midioX: 300 };

  r._drawDropImpact(ctx, stage, hypeSim(), pose);

  assert.ok(offCalls.length > 0, 'the shock should copy the frame');
  for (const [src] of offCalls) {
    assert.equal(src, backing, 'the copy must come from the real canvas');
    assert.notEqual(src, stage, 'not from the logical view');
  }
  // The offscreen buffer matches the backing store, so the copy is 1:1.
  assert.equal(r._shockCanvas.width, DEVICE_W);
  assert.equal(r._shockCanvas.height, DEVICE_H);

  const blits = calls.filter((c) => c.length >= 5);
  assert.ok(blits.length > 0, 'and it must be blitted back');
  for (const [, , , dw, dh] of blits) {
    assert.equal(dw, STAGE_W, 'blitted back into logical space');
    assert.equal(dh, STAGE_H);
  }
});

test('no drop in flight means no shock at all', () => {
  const r = Object.create(Renderer.prototype);
  const { ctx, calls } = recordingCtx();
  const sim = hypeSim();
  sim.hype.dropAtMs = -Infinity; // HypeDirector's initial state
  r._drawDropImpact(ctx, stageView(), sim, { midioDrawX: 300 });
  assert.equal(calls.length, 0);
});
