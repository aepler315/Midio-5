// The Range v2 calm sky's cloud banks. Review (October 5): "the clouds look
// like dog turds, that randomly gain energy, flap, and then hold still again
// for a few seconds." Causes found: each bank was seven equal dark-brown
// blobs on a sine; puffs were skipped wherever the aurora's live (musical)
// outline reached, so they vanished and reappeared with its flashes; the lit
// rim jumped sides as the light crossed a bank; the shade was darkened sky
// plus a fixed brown, a dark hole whenever the sky lit up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeCloudBanks, drawRangeClouds, cloudColours, cloudShape, CLOUD_BAND, CLOUD_PUFFS } from '../src/world/alpine/RangeSkyComposition.js';

/** A 2D context that records every gradient fill: centre, radius, colours. */
function recorder() {
  const fills = [];
  let pending = null;
  const ctx = {
    save() {}, restore() {}, translate() {}, scale() {}, beginPath() {}, arc() {},
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      const g = { x: x1, y: y1, r: r1, stops: [], addColorStop(o, c) { this.stops.push([o, c]); } };
      return g;
    },
    set fillStyle(g) { pending = g; }, get fillStyle() { return pending; },
    fill() { fills.push(pending); },
  };
  return { ctx, fills };
}
const alphaOf = (c) => Number(c.match(/,([\d.]+)\)$/)[1]);
const rgbOf = (c) => c.match(/rgba\((\d+),(\d+),(\d+)/).slice(1).map(Number);
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const W = 1280, H = 720;
const banks = (o = {}) => rangeCloudBanks({ width: W, height: H, tSec: 30, seed: 7, ...o });

test('banks sit in the calm band, below the aurora\'s resting hem, and keep their shape', () => {
  for (const b of banks()) {
    assert.ok(b.y >= H * CLOUD_BAND[0] - 1e-9 && b.y <= H * CLOUD_BAND[1] + 1e-9, `${b.id} at ${b.y}`);
    assert.equal(b.shape.length, CLOUD_PUFFS);
  }
  // Shape is a function of the bank alone: not of time, pan or anything else.
  const later = banks({ tSec: 300, panPx: 90, panYPx: -20 });
  banks().forEach((b, i) => assert.deepEqual(later[i].shape, b.shape));
});

test('a bank is domed puffs on a flat base, largest in the middle', () => {
  const shape = cloudShape(3, 7);
  // Undersides (centre + vertical radius) stay within a narrow band...
  const bases = shape.map((p) => p.y + p.r * 0.5);
  assert.ok(Math.max(...bases) - Math.min(...bases) < 0.25, `base spread ${Math.max(...bases) - Math.min(...bases)}`);
  // ...while the tops vary, and the ends are smaller than the middle.
  const middle = shape.filter((p) => p.u > 0.3 && p.u < 0.7).map((p) => p.r);
  const ends = shape.filter((p) => p.u < 0.15 || p.u > 0.85).map((p) => p.r);
  assert.ok(Math.max(...middle) > Math.max(...ends));
  assert.ok(new Set(shape.map((p) => p.r.toFixed(3))).size > CLOUD_PUFFS - 2, 'puffs are not all one size');
});

test('nothing musical can remove a puff: every puff is painted every frame', () => {
  const { ctx, fills } = recorder();
  const list = banks();
  drawRangeClouds(ctx, list, { shade: [90, 100, 120], lit: [255, 245, 230], light: { x: 900, y: 100 }, directGain: 1,
    // An old caller's corridor mask is no longer a parameter: ignored.
    allowPoint: () => false });
  // A veil plus a body for every puff of every bank, at least.
  assert.ok(fills.length >= list.length * (1 + CLOUD_PUFFS), `${fills.length} fills`);
});

test('the lit side moves smoothly as the light crosses a bank (no flip)', () => {
  const [b] = banks();
  const litCentres = (lightX) => {
    const { ctx, fills } = recorder();
    drawRangeClouds(ctx, [b], { shade: [90, 100, 120], lit: [255, 250, 240], light: { x: lightX, y: b.y - 200 }, directGain: 1 });
    return fills.filter((g) => rgbOf(g.stops[0][1])[0] === 255).map((g) => [g.x, alphaOf(g.stops[0][1])]);
  };
  const left = litCentres(b.x - 1), right = litCentres(b.x + 1);
  assert.equal(left.length, right.length);
  for (let i = 0; i < left.length; i++) {
    assert.ok(Math.abs(left[i][0] - right[i][0]) < 2, `lit layer ${i} jumped ${left[i][0] - right[i][0]} px`);
    assert.ok(Math.abs(left[i][1] - right[i][1]) < 0.01, `lit layer ${i} alpha jumped`);
  }
});

test('the shade comes from the sky: never a dark hole, whiter under a brighter sky', () => {
  const rgb = (r, g, b) => ({ r, g, b });
  for (const [top, mid] of [[rgb(12, 16, 40), rgb(28, 36, 80)], [rgb(70, 40, 90), rgb(190, 110, 170)], [rgb(80, 130, 210), rgb(140, 180, 230)]]) {
    const sky = [0.4 * top.r + 0.6 * mid.r, 0.4 * top.g + 0.6 * mid.g, 0.4 * top.b + 0.6 * mid.b];
    const { shade, lit } = cloudColours(top, mid, rgb(255, 200, 150));
    assert.ok(lum(shade) > lum(sky), `shade ${shade} darker than sky ${sky.map(Math.round)}`);
    assert.ok(lum(shade) - lum(sky) < 110, 'but still low contrast');
    assert.ok(lum(lit) > lum(shade));
  }
  // A night sky keeps its hue (blue stays bluer than red); a magenta sky
  // gives magenta-grey cloud, not brown.
  const night = cloudColours(rgb(12, 16, 40), rgb(28, 36, 80), rgb(200, 210, 255)).shade;
  assert.ok(night[2] > night[0]);
  const magenta = cloudColours(rgb(70, 40, 90), rgb(190, 110, 170), rgb(255, 200, 150)).shade;
  assert.ok(magenta[0] > magenta[1] && magenta[2] > magenta[1], `magenta sky gave ${magenta}`);
});

test('the fade toward the aurora depends only on height', () => {
  const draw = (y) => {
    const { ctx, fills } = recorder();
    drawRangeClouds(ctx, [{ ...banks()[0], y }], { shade: [90, 100, 120], lit: [255, 255, 255], fadeTop: [60, 120] });
    return fills.length ? alphaOf(fills[0].stops[0][1]) : 0;
  };
  assert.equal(draw(50), 0, 'above the fade: not painted');
  assert.ok(draw(90) > 0 && draw(90) < draw(200), 'inside it: partial');
  assert.equal(draw(200), draw(300), 'below it: full');
});
