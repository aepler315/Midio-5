import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skylineFromAlpha, smoothSkyline, skylineYAt } from '../src/world/alpine/RangeSkyline.js';
import { SpaceRidge } from '../src/world/SpaceRidge.js';

/** RGBA with land (alpha 255) from row `tops[x]` down; null = no land. */
function alphaImage(tops, h) {
  const w = tops.length, data = new Uint8ClampedArray(w * h * 4);
  tops.forEach((top, x) => { if (top != null) for (let y = top; y < h; y++) data[(y * w + x) * 4 + 3] = 255; });
  return data;
}

test('the skyline is the topmost land in each column', () => {
  const ys = [...skylineFromAlpha(alphaImage([5, 2, null, 8], 10), 4, 10)].map(v => +v.toFixed(3));
  assert.deepEqual(ys, [.5, .2, NaN, .8]);
});

test('faint alpha (sun shafts in open sky) is not land', () => {
  const data = alphaImage([6], 10);
  data[(1 * 1 + 0) * 4 + 3] = 60;
  assert.equal(+skylineFromAlpha(data, 1, 10)[0].toFixed(3), .6);
});

test('gaps are bridged and the massif is softened', () => {
  const raw = Float32Array.from([.4, NaN, .6, NaN, NaN]);
  assert.deepEqual([...smoothSkyline(raw, 0)].map(v => +v.toFixed(3)), [.4, .5, .6, .6, .6]);
  assert.deepEqual([...smoothSkyline(Float32Array.from([NaN, NaN]), 0)], [1, 1], 'no land at all: the frame\'s foot');
  const soft = smoothSkyline(Float32Array.from([.5, .5, .1, .5, .5]), 1);
  assert.ok(soft[2] > .1 && soft[2] < .5, 'a lone tooth is blunted');
  assert.ok(Math.abs(skylineYAt(Float32Array.from([.2, .4]), { width: 200, height: 100 }, 100) - 30) < 1e-6);
});

const canvas = { width: 1280, height: 720 };
/** A land skyline peaking mid-frame (fractions of the height). */
const peak = Float32Array.from({ length: 96 }, (_, i) => .45 - .2 * Math.exp(-(((i - 48) / 14) ** 2)));

test('the aurora\'s hem echoes the ridgeline, keeping its distance from the land', () => {
  const ridge = new SpaceRidge(315);
  ridge._tSec = 10;
  const { pts } = ridge._samples(canvas);
  ridge.skyline = { ys: peak, atSec: 10 };
  const echoed = ridge._echoSkyline(pts, canvas);
  const at = (list, x) => list.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best));
  const rise = (list) => (at(list, 80).y + at(list, 1200).y) / 2 - at(list, 640).y;
  assert.ok(rise(echoed) > rise(pts) + 40, 'the curtain lifts over the peak');
  for (const p of echoed) assert.ok(p.y <= skylineYAt(peak, canvas, p.x) - 720 * .06 + 1e-6, 'and never sinks onto the land');
  assert.deepEqual(echoed.map(p => p.x), pts.map(p => p.x), 'only heights change');
});

test('a stale skyline (after a seek) leaves the musical wave alone', () => {
  const ridge = new SpaceRidge(315);
  ridge._tSec = 10;
  const { pts } = ridge._samples(canvas);
  ridge.skyline = { ys: peak, atSec: 3 };
  assert.deepEqual(ridge._echoSkyline(pts, canvas), pts);
});

test('the corridor follows the echoed curtain', () => {
  const ridge = new SpaceRidge(315);
  ridge._tSec = 10;
  ridge.skyline = { ys: peak, atSec: 10 };
  const echoed = ridge._echoSkyline(ridge._samples(canvas).pts, canvas);
  const mid = echoed.reduce((best, p) => (Math.abs(p.x - 640) < Math.abs(best.x - 640) ? p : best));
  const band = ridge.corridor(canvas)(mid.x);
  assert.ok(band.top < mid.y && band.bottom > mid.y);
});
