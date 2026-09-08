import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/render/Renderer.js';

// Composite operations that clear the destination OUTSIDE the region being
// drawn. In a loop that blits many small cells onto one canvas, any of these
// makes each cell erase every cell before it -- the finished frame keeps only
// the last blit. That shipped once as heat distortion using 'copy': measured
// in Chromium, 63 grid blits left 0.2% of the canvas opaque, which reads as a
// blank stage with only the DOM chrome still visible.
const DESTRUCTIVE_OPS = new Set([
  'copy', 'source-in', 'source-out', 'destination-in', 'destination-atop',
]);

/** Records the composite op in force at each drawImage onto the main canvas. */
function makeCtx(record) {
  return {
    globalCompositeOperation: 'source-over',
    _stack: [],
    save() { this._stack.push(this.globalCompositeOperation); },
    restore() { this.globalCompositeOperation = this._stack.pop() ?? 'source-over'; },
    drawImage() { record.push(this.globalCompositeOperation); },
  };
}

function makeHeatCanvas() {
  const inner = { globalCompositeOperation: 'source-over', drawImage() {} };
  return { width: 0, height: 0, getContext: () => inner };
}

/** A drop at full strength, biome/fire quiet -- enough to run the pass. */
function makeSim() {
  return {
    perf: { heavyPostFx: true },
    timeMs: 1000,
    hype: { dropAtMs: 1000 }, // dropImpactStrength peaks at 1 exactly at the drop
    biomes: { currentFxAlpha: () => 0 },
    fire: null,
    midio: { groundY: 625 },
    reducedFlash: false,
  };
}

function runPass() {
  const blitOps = [];
  const ctx = makeCtx(blitOps);
  const canvas = { width: 1280, height: 720 };
  const self = { _heatCanvas: makeHeatCanvas() };
  Renderer.prototype._drawHeatDistortion.call(
    self, ctx, canvas, makeSim(), { midioDrawX: 300 }, { width: 1280, height: 720 },
  );
  return { blitOps, ctx };
}

test('heat distortion actually blits the frame back through its warp grid', () => {
  const { blitOps } = runPass();
  assert.ok(blitOps.length > 10, `expected a grid of blits, got ${blitOps.length}`);
});

test('heat distortion never blits cells under a destructive composite op', () => {
  const { blitOps } = runPass();
  for (const op of blitOps) {
    assert.ok(
      !DESTRUCTIVE_OPS.has(op),
      `a per-cell blit ran under '${op}', which discards the rest of the canvas -- `
      + 'every earlier cell is erased and the frame ends up blank',
    );
  }
});

test('heat distortion leaves the composite op as it found it', () => {
  const { ctx } = runPass();
  assert.equal(ctx.globalCompositeOperation, 'source-over');
});

test('heat distortion sheds entirely when the perf governor has cut heavy post-FX', () => {
  const blitOps = [];
  const ctx = makeCtx(blitOps);
  const sim = makeSim();
  sim.perf = { heavyPostFx: false };
  Renderer.prototype._drawHeatDistortion.call(
    { _heatCanvas: makeHeatCanvas() }, ctx, { width: 1280, height: 720 }, sim,
    { midioDrawX: 300 }, { width: 1280, height: 720 },
  );
  assert.equal(blitOps.length, 0);
});
