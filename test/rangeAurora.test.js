import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpaceRidge } from '../src/world/SpaceRidge.js';
import { BiomeManager } from '../src/world/BiomeManager.js';

function recordingCtx() {
  const fills = [];
  const stack = [];
  return {
    fills, globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: null,
    save() { stack.push([this.globalAlpha, this.globalCompositeOperation]); },
    restore() { [this.globalAlpha, this.globalCompositeOperation] = stack.pop(); },
    translate() {}, scale() {},
    createLinearGradient() { return { addColorStop() {} }; },
    fillRect() { fills.push({ alpha: this.globalAlpha, op: this.globalCompositeOperation }); },
  };
}

const canvas = { width: 1280, height: 720 };
const total = (ctx) => ctx.fills.reduce((sum, f) => sum + f.alpha, 0);

test('the aurora hangs from every ridge segment and is brightest at night', () => {
  const ridge = new SpaceRidge(315);
  const night = recordingCtx(), day = recordingCtx();
  ridge.drawAurora(night, canvas, '#9fe8c0', 10, { night01: 1 });
  ridge.drawAurora(day, canvas, '#9fe8c0', 10, { night01: 0 });
  assert.ok(night.fills.length >= 29 * 6, 'ray columns span the whole ridge');
  assert.ok(night.fills.every(f => f.op === 'lighter'), 'curtain light adds to the sky');
  assert.ok(total(day) > 0 && total(day) < total(night) * 0.5, 'a faint veil by day');
});

test('the aurora stands down with its presentation and is flash-safe', () => {
  const ridge = new SpaceRidge(315);
  const off = recordingCtx(), safe = recordingCtx();
  ridge.drawAurora(off, canvas, '#9fe8c0', 10, { presentation: 0 });
  assert.equal(off.fills.length, 0);
  ridge.drawAurora(safe, canvas, '#9fe8c0', 10, { reducedFlash: true });
  assert.ok(safe.fills.every(f => f.op === 'source-over'));
});

test('reduced motion holds the curtain\'s rays still', () => {
  const ridge = new SpaceRidge(315);
  const a = recordingCtx(), b = recordingCtx();
  ridge.drawAurora(a, canvas, '#9fe8c0', 3, { reducedMotion: true });
  ridge.drawAurora(b, canvas, '#9fe8c0', 9, { reducedMotion: true });
  assert.deepEqual(a.fills, b.fills);
});

test('crest light draws nothing without terrain to land on', () => {
  let drawn = 0;
  const ctx = { save() {}, restore() {}, drawImage() { drawn++; } };
  const mgr = { _horizonEqPoints: () => [{ x: 0, y: 300 }, { x: 1280, y: 320 }], _landscapeGeometry: null };
  BiomeManager.prototype._drawCrestLight.call(mgr, ctx, canvas, 0, null, null, 1, null);
  BiomeManager.prototype._drawCrestLight.call(mgr, ctx, canvas, 0, null, null, 1, { image: null, width: 0, height: 0 });
  assert.equal(drawn, 0);
});

test('nothing painted after the aurora can reach into its tallest flaring rays', () => {
  const ridge = new SpaceRidge(315);
  ridge._tSec = 10;
  ridge._flashes = ridge.nodes.map((_, i) => ({ i, atMs: 10000 }));
  const { pts, maxH } = ridge._samples(canvas);
  const flashes = ridge._flashLevels(10);
  const corridor = ridge.corridor(canvas);
  for (let i = 0; i < pts.length - 1; i++) {
    const x = (pts[i].x + pts[i + 1].x) / 2, y = (pts[i].y + pts[i + 1].y) / 2;
    const tallest = ridge._curtainHeight(canvas, maxH, pts[i], pts[i + 1], flashes, 1);
    assert.ok(corridor(x).top <= y - tallest + 1e-6, `segment ${i} crown stays inside the corridor`);
  }
});
