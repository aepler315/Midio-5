// Mountain overhaul Stage 6 (ship-last, most cuttable): thin multiply bands
// PARALLEL TO THE LOCAL CREST -- each one traces the same live `pts`
// polyline _drawRidgeVolume already reads (already carrying Stage 2's
// per-column deformation), just offset further down, rather than a fixed
// screen-horizontal stripe. L2/L3 only (L4 already carries GeoCrest +
// shoulders, L5 is rolling hills), gated on heavyPostFx.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.Path2D = class Path2D {
  moveTo() {} lineTo() {} closePath() {} bezierCurveTo() {} quadraticCurveTo() {} arc() {} rect() {}
};

class RecordingCtx {
  constructor() {
    this.fillCalls = 0;
    this.multiplyFillCalls = 0;
    this._fillStyle = null;
    this._globalCompositeOperation = 'source-over';
  }
  get fillStyle() { return this._fillStyle; }
  set fillStyle(v) { this._fillStyle = v; }
  get globalCompositeOperation() { return this._globalCompositeOperation; }
  set globalCompositeOperation(v) { this._globalCompositeOperation = v; }
  set strokeStyle(v) {} set globalAlpha(v) {} set lineWidth(v) {} set lineJoin(v) {}
  set lineCap(v) {}
  createLinearGradient() {
    const stops = [];
    return { stops, addColorStop: (offset, color) => stops.push({ offset, color }) };
  }
  createRadialGradient() { return this.createLinearGradient(); }
  beginPath() {} moveTo() {} lineTo() {} closePath() {} stroke() {}
  fill() {
    this.fillCalls++;
    if (this._globalCompositeOperation === 'multiply') this.multiplyFillCalls++;
  }
  save() {} restore() {} clip() {} rect() {} arc() {} ellipse() {}
  quadraticCurveTo() {} bezierCurveTo() {} translate() {} rotate() {} scale() {}
  drawImage() {} fillRect() {} clearRect() {} strokeRect() {}
}

function makeStrip({ width = 2048, step = 4, height = 320 } = {}) {
  const n = Math.floor(width / step) + 1;
  const heights = new Float32Array(n);
  for (let i = 0; i < n; i++) heights[i] = Math.sin(i * 0.05) * 0.5 + Math.sin(i * 0.13 + 1.7) * 0.3;
  const blendCount = Math.max(1, Math.floor(n * 0.12));
  for (let i = 0; i < blendCount; i++) {
    const idx = n - blendCount + i;
    const t = i / blendCount;
    const tt = t * t * (3 - 2 * t);
    heights[idx] = heights[idx] * (1 - tt) + heights[0] * tt;
  }
  return { width, height, ridge: { heights, step, baseline: 0.70, amplitude: 0.34, height } };
}

async function makeManager({ perf = null } = {}) {
  const { BiomeManager } = await import('../src/world/BiomeManager.js');
  const bm = Object.create(BiomeManager.prototype);
  bm._crestCache = new Map();
  bm.tSec = 3;
  bm._danceKickMs = -Infinity;
  bm._danceKickAmp = 0;
  bm.orogenyGrowth = 0;
  bm.pullback01 = 0;
  bm._danceGroove = 0.4;
  bm._danceSustain = 0.3;
  bm._eqSmoothed = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  bm._geoFeatures = [];
  bm._perf = perf;
  bm.groundY = 400;
  bm.h = 540;
  bm._airColor = null;
  return bm;
}

const canvas = { width: 960, height: 540 };

test('L2 gets extra multiply-blended fills for its strata bands', async () => {
  const bm = await makeManager();
  const ctxNoPerf = new RecordingCtx();
  const strip = makeStrip();
  bm._drawRidgeVolume(ctxNoPerf, canvas, strip, 0, 40, 'L2', 1, 1, 1, 1);
  // Existing lit/shade passes also use gradients but only the shade pass
  // multiplies -- strata adds MORE multiply fills on top of that one.
  assert.ok(ctxNoPerf.multiplyFillCalls > 1, `expected strata to add multiply fills, got ${ctxNoPerf.multiplyFillCalls}`);
});

test('L5 (rolling hills) never gets strata bands', async () => {
  const bm = await makeManager();
  const withL2 = new RecordingCtx();
  const withL5 = new RecordingCtx();
  const strip = makeStrip();
  bm._drawRidgeVolume(withL2, canvas, strip, 0, 40, 'L2', 1, 1, 1, 1);
  bm._drawRidgeVolume(withL5, canvas, strip, 0, 40, 'L5', 1, 1, 1, 1);
  assert.ok(withL2.multiplyFillCalls > withL5.multiplyFillCalls, 'L2 should carry strictly more multiply fills than L5');
});

test('strata sheds on the heavyPostFx-off perf rung', async () => {
  const bmOn = await makeManager({ perf: { heavyPostFx: true } });
  const bmOff = await makeManager({ perf: { heavyPostFx: false } });
  const ctxOn = new RecordingCtx();
  const ctxOff = new RecordingCtx();
  const strip = makeStrip();
  bmOn._drawRidgeVolume(ctxOn, canvas, strip, 0, 40, 'L2', 1, 1, 1, 1);
  bmOff._drawRidgeVolume(ctxOff, canvas, strip, 0, 40, 'L2', 1, 1, 1, 1);
  assert.ok(ctxOn.multiplyFillCalls > ctxOff.multiplyFillCalls, 'strata (and shoulders) should shed when heavyPostFx is off');
});

test('never throws on a very short range (not enough span for any band)', async () => {
  const bm = await makeManager();
  const ctx = new RecordingCtx();
  const strip = makeStrip({ height: 20 });
  assert.doesNotThrow(() => bm._drawRidgeVolume(ctx, canvas, strip, 0, 40, 'L2', 1, 1, 1, 1));
});
