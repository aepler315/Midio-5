import test from 'node:test';
import assert from 'node:assert/strict';
import { BiomeManager } from '../src/world/BiomeManager.js';
import { dayNight } from '../src/world/DayNight.js';
import { compileLandscapeSources } from '../src/world/alpine/RangeNarrative.js';
import { createRangeSkyComposition } from '../src/world/alpine/RangeSkyComposition.js';

const canvas = { width: 1280, height: 720 };
const palette = { fx: '', sky: ['#10182b', '#20334a', '#42566d'] };

function manager() {
  const m = new BiomeManager({
    conductor: { barGrid: [], onBar: () => () => {}, on: () => () => {} },
    durationMs: 60000, canvasWidth: canvas.width, canvasHeight: canvas.height,
    groundY: 625, songSeed: 315, worldId: 'range',
  });
  m._rangeSky = createRangeSkyComposition(m.spaceRidge, canvas);
  m._perf = { phenomenaFull: false };
  return m;
}

// Record actual point fills, including the batched faint stars. Testing the
// shared painter alone missed the narrative sky's early return.
function skyPoints(m, options = {}, scale = 1) {
  const points = [], stack = [];
  let path = [];
  const ctx = {
    globalAlpha: 1,
    getTransform() { return { a: scale, b: 0, c: 0, d: scale }; },
    save() { stack.push(this.globalAlpha); },
    restore() { this.globalAlpha = stack.pop(); },
    createLinearGradient() { return { addColorStop() {} }; },
    beginPath() { path = []; },
    rect(x, y, w, h) { path.push([x, y, w, h]); },
    fill() { for (const p of path) this.fillRect(...p); },
    fillRect(x, y, w, h) {
      if (w <= 4 && w === h && this.globalAlpha > 0) points.push([x, y, this.globalAlpha, w * scale]);
    },
  };
  const { night } = dayNight(m.tSec * 1000, m._dayNightCycleMs);
  m._drawSky(ctx, canvas, palette, palette, 0, night, options);
  return points;
}

test('production Range sky paints a dense catalogue throughout the moon cycle, even at low quality', () => {
  const m = manager();
  const sources = compileLandscapeSources({ durationMs: 60000 });
  for (const timeMs of [0, 12000, 30000, 48000, 60000, 90000]) {
    m.tSec = timeMs / 1000;
    m.rangeNarrative = sources.sample(timeMs);
    const points = skyPoints(m);
    assert.ok(points.length > 3000, `${timeMs}ms: only ${points.length} stars drawn`);
    for (let column = 0; column < 4; column++) {
      assert.ok(points.filter(([x]) => x >= column * 320 && x < (column + 1) * 320).length > 300,
        `stars must span the sky, column ${column} at ${timeMs}ms`);
    }
  }
});

test('Range stars remain present during quiet openings and respect the astronomy opt-out', () => {
  const m = manager();
  m.rangeNarrative = compileLandscapeSources().sample(0);
  m.tSec = 0;
  const full = skyPoints(m);
  assert.ok(full.length > 3000);
  for (const gain of [0, 0.01, 0.3]) {
    m.openingGain = gain;
    assert.deepEqual(skyPoints(m), full, `opening gain ${gain} must not fade the night sky`);
  }
  assert.deepEqual(skyPoints(m, { astronomical: false }), []);
});

test('stage stars retain their output cores when the actual sky is fitted to small screens', () => {
  const m = manager();
  m.rangeNarrative = compileLandscapeSources().sample(30000);
  m.tSec = 30;
  const baseline = skyPoints(m);
  m.rangePerformance = true;
  assert.deepEqual(skyPoints(m), baseline, 'full-size sky retains its catalogue and light');
  for (const scale of [.5, 360 / 1280, 1.5]) {
    const points = skyPoints(m, {}, scale);
    assert.equal(points.length, baseline.length, 'fitting must not discard stars');
    assert.ok(points.every(p => p[3] >= 1), 'dots survive the output sampling grid');
    assert.deepEqual(points.map(p => p[2]), baseline.map(p => p[2]), 'no extra brightness or flashing');
  }
  assert.ok(skyPoints(m, {}, .125).every(p => p[3] === .5), 'extreme thumbnail enlargement is bounded');
});
