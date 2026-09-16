// The ocean fata morgana and the DUNE ground mirage are two different
// effects that were both called `_drawMirage`. The class body kept only the
// second, so the fata morgana never drew anything from the day it was
// merged. These tests lock in that they are now separately reachable and
// that each one actually puts paint on the context.
//
// Same fake-`this` approach as biomeFxAlpha.test.js: both methods read a
// handful of fields and nothing else, so a real BiomeManager (conductor,
// energy curves, a schedule) is unnecessary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BiomeManager } from '../src/world/BiomeManager.js';
import { mirageRecipe } from '../src/world/FataMorgana.js';

const CANVAS = { width: 1280, height: 720 };

/** Records the drawing calls that put paint down, tolerates the rest. */
function recordingCtx() {
  const fills = [], strokes = [], images = [], rects = [];
  const ctx = {
    canvas: { width: 1920, height: 1080, __isCanvas: true },
    fill: () => fills.push({ style: ctx.fillStyle, alpha: ctx.globalAlpha }),
    stroke: () => strokes.push({ style: ctx.strokeStyle }),
    drawImage: (...a) => images.push(a),
    rect: (...a) => rects.push(a),
    save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {},
    moveTo() {}, lineTo() {}, translate() {}, scale() {}, fillRect() {},
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
  };
  return { ctx, fills, strokes, images, rects };
}

/** The fields _drawFataMorgana reads, and nothing more. */
function fataMorganaThis() {
  return {
    _perf: null,
    tSec: 12.5,
    _airColor: '#8fa8bf',
    _mirageRecipe: mirageRecipe(1234),
    _rotated: (hex) => hex,
    lerpCache: { get: (a) => a },
  };
}

const PROFILE = { name: 'ALPINE', sky: ['#0a1020', '#16233c', '#2b3f5e'] };

test('the fata morgana and the ground mirage are separate methods', () => {
  // They collided under one name for a week. Distinct arities, so a call
  // site aimed at one can never silently land in the other.
  assert.equal(typeof BiomeManager.prototype._drawFataMorgana, 'function');
  assert.equal(typeof BiomeManager.prototype._drawGroundMirage, 'function');
  assert.equal(BiomeManager.prototype._drawFataMorgana.length, 6);
  assert.equal(BiomeManager.prototype._drawGroundMirage.length, 4);
  assert.equal(BiomeManager.prototype._drawMirage, undefined);
});

test('the fata morgana paints its main image and its inferior echo', () => {
  const { ctx, fills } = recordingCtx();
  BiomeManager.prototype._drawFataMorgana.call(
    fataMorganaThis(), ctx, CANVAS, 400, PROFILE, PROFILE, 0.5,
  );
  // One fill for the range itself, one for the squashed reflection below it.
  assert.equal(fills.length, 2, 'expected the main image and its echo');
  for (const f of fills) assert.match(f.style, /^rgba\(\d+,\d+,\d+,0\.\d+\)$/);
  // The echo is the fainter of the two, not a second copy at full strength.
  const alphaOf = (s) => Number(s.style.slice(s.style.lastIndexOf(',') + 1, -1));
  assert.ok(alphaOf(fills[1]) < alphaOf(fills[0]), 'the echo should be fainter');
  assert.ok(alphaOf(fills[0]) > 0, 'the main image should be visible at all');
});

test('the fata morgana is shed with the rest of the heavy post-FX', () => {
  const { ctx, fills } = recordingCtx();
  const self = { ...fataMorganaThis(), _perf: { heavyPostFx: false } };
  BiomeManager.prototype._drawFataMorgana.call(self, ctx, CANVAS, 400, PROFILE, PROFILE, 0.5);
  assert.equal(fills.length, 0);
});

test('the ground mirage still blits its band and draws its ripples', () => {
  const { ctx, strokes, images } = recordingCtx();
  BiomeManager.prototype._drawGroundMirage.call({ tSec: 3.2 }, ctx, CANVAS, 400, 600);
  assert.equal(images.length, 1, 'the false-water band is a self-blit');
  // It must sample the real backing store, not the logical stage view.
  assert.equal(images[0][0].__isCanvas, true);
  assert.ok(strokes.length > 0, 'expected the ripple lines');
});

test('a profile passed where the ground line belongs yields a non-finite band', () => {
  // Exactly what the shadowed call did for a week. `canvas.height - profile`
  // is NaN, so the band height is NaN: the ripple loop never iterates, and
  // the clip rect is non-finite, which a real 2D context treats as a no-op
  // -- leaving an empty clip region that swallows the blit. Measured in
  // Chromium against a fully-painted canvas, this changed zero bytes.
  //
  // The recording stub cannot model clipping, so this asserts the geometry
  // rather than the pixels: a non-finite clip rect is the tell.
  const { ctx, strokes, rects } = recordingCtx();
  BiomeManager.prototype._drawGroundMirage.call({ tSec: 3.2 }, ctx, CANVAS, 400, PROFILE);
  assert.equal(strokes.length, 0, 'the ripple loop cannot run against a NaN band height');
  assert.equal(rects.length, 1);
  assert.ok(rects[0].some((v) => !Number.isFinite(v)), 'expected a non-finite clip rect');
});
