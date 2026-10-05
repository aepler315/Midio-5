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
function skyPoints(m, options = {}) {
  const points = [], stack = [];
  let path = [];
  const ctx = {
    globalAlpha: 1,
    save() { stack.push(this.globalAlpha); },
    restore() { this.globalAlpha = stack.pop(); },
    createLinearGradient() { return { addColorStop() {} }; },
    beginPath() { path = []; },
    rect(x, y, w, h) { path.push([x, y, w, h]); },
    fill() { for (const p of path) this.fillRect(...p); },
    fillRect(x, y, w, h) {
      if (w === 1 && h === 1 && this.globalAlpha > 0) points.push([x, y, this.globalAlpha]);
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
