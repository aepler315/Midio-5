// Ridge shading flicker: _drawRidgeVolume's catchlight/shade gradients used
// to anchor their top stop to `crestY`, a live global extremum over a ridge
// that dances and scrolls every frame (see _crestPoints -- "moves every
// frame"). The exact same failure mode was already diagnosed and fixed for
// the snow line by anchoring to `bakedCrestY` instead; the shading gradients
// never got the same fix, so the "shadow" on every ridge face wobbled up
// and down with the dance -- reported as flickering shadow artifacts.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.Path2D = class Path2D {
  moveTo() {} lineTo() {} closePath() {} bezierCurveTo() {} quadraticCurveTo() {} arc() {} rect() {}
};

class RecordingCtx {
  constructor() {
    this.gradients = []; // [{x0,y0,x1,y1}]
    this._fillStyle = null;
    this._globalCompositeOperation = 'source-over';
  }
  get fillStyle() { return this._fillStyle; }
  set fillStyle(v) { this._fillStyle = v; }
  get globalCompositeOperation() { return this._globalCompositeOperation; }
  set globalCompositeOperation(v) { this._globalCompositeOperation = v; }
  set strokeStyle(v) {} set globalAlpha(v) {} set lineWidth(v) {} set lineJoin(v) {}
  set lineCap(v) {}
  createLinearGradient(x0, y0, x1, y1) {
    this.gradients.push({ x0, y0, x1, y1 });
    const stops = [];
    return { stops, addColorStop: (offset, color) => stops.push({ offset, color }) };
  }
  createRadialGradient() { return this.createLinearGradient(0, 0, 0, 0); }
  beginPath() {} moveTo() {} lineTo() {} closePath() {} fill() {} stroke() {}
  save() {} restore() {} clip() {} rect() {} arc() {} ellipse() {}
  quadraticCurveTo() {} bezierCurveTo() {} translate() {} rotate() {} scale() {}
  drawImage() {} fillRect() {} clearRect() {} strokeRect() {}
}

function makeStrip({ width = 2048, step = 4, height = 320, phase = 0 } = {}) {
  const n = Math.floor(width / step) + 1;
  const heights = new Float32Array(n);
  for (let i = 0; i < n; i++) heights[i] = Math.sin(i * 0.05 + phase) * 0.5 + Math.sin(i * 0.13 + 1.7 + phase) * 0.3;
  const blendCount = Math.max(1, Math.floor(n * 0.12));
  for (let i = 0; i < blendCount; i++) {
    const idx = n - blendCount + i;
    const t = i / blendCount;
    const tt = t * t * (3 - 2 * t);
    heights[idx] = heights[idx] * (1 - tt) + heights[0] * tt;
  }
  return { width, height, ridge: { heights, step, baseline: 0.70, amplitude: 0.34, height } };
}

async function makeManager() {
  const { BiomeManager } = await import('../src/world/BiomeManager.js');
  const bm = Object.create(BiomeManager.prototype);
  bm._crestCache = new Map();
  bm._danceKickMs = -Infinity;
  bm._danceKickAmp = 0;
  bm.orogenyGrowth = 0;
  bm.pullback01 = 0;
  bm._danceGroove = 0.4;
  bm._danceSustain = 0.3;
  bm._eqSmoothed = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  bm._geoFeatures = [];
  bm._perf = null; // heavyPostFx / danceColumnWidth defaults
  bm.groundY = 400;
  bm.h = 540;
  bm._airColor = null; // skip the aerial-perspective fill, irrelevant here
  return bm;
}

const canvas = { width: 960, height: 540 };

test('the ridge-volume shading gradient anchors to a stable summit, not the live dancing crest', async () => {
  const strip = makeStrip({ phase: 0 });
  const bm1 = await makeManager();
  bm1.tSec = 3; // one moment in the dance
  const ctx1 = new RecordingCtx();
  bm1._drawRidgeVolume(ctx1, canvas, strip, 0, 0, 'L2', 1, 1, 1, 1);

  const bm2 = await makeManager();
  bm2.tSec = 11.7; // a very different moment -- the live crest column shifts
  const ctx2 = new RecordingCtx();
  bm2._drawRidgeVolume(ctx2, canvas, strip, 640, 0, 'L2', 1, 1, 1, 1); // also scrolled

  assert.ok(ctx1.gradients.length >= 2, 'expected the catchlight + shade gradients');
  assert.ok(ctx2.gradients.length >= 2);

  const top1 = ctx1.gradients[0].y0;
  const top2 = ctx2.gradients[0].y0;
  assert.ok(
    Math.abs(top1 - top2) < 0.01,
    `shading gradient's top anchor moved between two dance/scroll states (${top1.toFixed(2)} vs ${top2.toFixed(2)}) -- this is the flicker`,
  );
  // And it must equal the strip's own baked (dance-free) summit, not just
  // coincidentally agree between two live samples.
  const geom = bm1._crestPoints(canvas, strip, 0, 0, 'L2', 1, 1);
  assert.ok(Math.abs(top1 - geom.bakedCrestY) < 0.01, 'the anchor should be bakedCrestY, not a live extremum');
});

test('the shading gradient still bottoms out at the range foot (bottomY), unaffected by the fix', async () => {
  const strip = makeStrip({ phase: 0 });
  const bm = await makeManager();
  bm.tSec = 3;
  const ctx = new RecordingCtx();
  bm._drawRidgeVolume(ctx, canvas, strip, 0, 0, 'L2', 1, 1, 1, 1);
  const geom = bm._crestPoints(canvas, strip, 0, 0, 'L2', 1, 1);
  for (const g of ctx.gradients.slice(0, 2)) {
    assert.ok(Math.abs(g.y1 - geom.bottomY) < 0.01);
  }
});
