// The caption naming the real range behind The Range, its stats, and the
// history that keeps the next song off the ranges just shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUNDLED_RANGE, CAPTION_DELAY_MS, CAPTION_FADE_MS, CAPTION_HOLD_MS,
  captionAlpha, drawRangeCaption, rangeCaptionFor, rangeStatsLine,
} from '../src/ui/RangeCaption.js';
import { groundSpeedMps, profileTravelPx } from '../src/world/terrain/ProfileTravel.js';
import { RANGE_HISTORY_MAX, noteRangeShown, readRecentRanges } from '../src/world/terrain/RangeHistory.js';

const hood = { id: 'oregon-cascades', name: 'Oregon Cascades', landmark: 'Mount Hood', region: 'Oregon, USA', source: 'discovered' };

test('the caption names the range, then the landmark and region', () => {
  const c = rangeCaptionFor(hood, 'alpine', { lengthKm: 33.8, speedMps: 150 });
  assert.equal(c.title, 'Oregon Cascades');
  assert.equal(c.place, 'Mount Hood · Oregon, USA');
  assert.equal(c.stats, '21 mi of real skyline sampled · riding at ~335 mph');
  assert.match(c.credit, /GeoNames \(CC BY 4\.0\)/);
});

test('only the alpine world gets a caption; no match names the bundled Tetons', () => {
  assert.equal(rangeCaptionFor(hood, 'ocean'), null);
  const tetons = rangeCaptionFor(null, 'alpine');
  assert.equal(tetons.title, BUNDLED_RANGE.name);
  assert.ok(!tetons.credit.includes('GeoNames'), 'a curated range is not credited to GeoNames');
});

test('a stat that cannot be computed is left out, not shown as NaN', () => {
  assert.equal(rangeStatsLine({ lengthKm: 16.1 }), '10 mi of real skyline sampled');
  assert.equal(rangeStatsLine({ lengthKm: NaN, speedMps: NaN }), '');
});

test('the caption fades in after the delay, holds, then fades out, on song time', () => {
  const inEnd = CAPTION_DELAY_MS + CAPTION_FADE_MS;
  const outEnd = inEnd + CAPTION_HOLD_MS + CAPTION_FADE_MS;
  assert.equal(captionAlpha(0), 0);
  assert.equal(captionAlpha(CAPTION_DELAY_MS), 0);
  assert.ok(Math.abs(captionAlpha(CAPTION_DELAY_MS + CAPTION_FADE_MS / 2) - 0.5) < 1e-9);
  assert.equal(captionAlpha(inEnd + 100), 1);
  assert.equal(captionAlpha(outEnd), 0);
  assert.equal(captionAlpha(outEnd + 60000), 0);
});

function fakeCtx() {
  const calls = [];
  return {
    calls, save() {}, restore() {}, fillText: (text, x, y) => calls.push({ text, x, y }),
    set globalAlpha(v) { calls.alpha = v; }, get globalAlpha() { return calls.alpha; },
  };
}

test('drawRangeCaption draws every line bottom-up above the progress strip, and nothing when faded', () => {
  const caption = rangeCaptionFor(hood, 'alpine', { lengthKm: 33.8, speedMps: 150 });
  const ctx = fakeCtx();
  drawRangeCaption(ctx, { width: 1280, height: 720 }, caption, 5000);
  assert.deepEqual(ctx.calls.map((c) => c.text).reverse(), [caption.title, caption.place, caption.stats, caption.credit]);
  assert.ok(ctx.calls.every((c) => c.y <= 720 - 100), 'clear of the 82px progress strip');
  assert.ok(ctx.calls[0].y > ctx.calls[ctx.calls.length - 1].y, 'the title sits highest');
  const early = fakeCtx();
  drawRangeCaption(early, { width: 1280, height: 720 }, caption, 500);
  assert.equal(early.calls.length, 0);
});

test('ground speed is the strip travel scaled to real metres', () => {
  const curves = { globalEnergyNorm: () => 0.4 };
  const px = profileTravelPx(60, curves);
  const mps = groundSpeedMps({ curves, durationMs: 60000, lengthM: 32000, stripWidth: 8192 });
  assert.ok(Math.abs(mps - (px / 60) * (32000 / 8192)) < 1e-9);
  assert.ok(Number.isNaN(groundSpeedMps({ curves, durationMs: 0, lengthM: 32000, stripWidth: 8192 })));
});

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('the history keeps the latest ranges shown, newest first, without repeats', () => {
  const store = memoryStore();
  for (const id of ['a', 'b', 'a', 'c']) noteRangeShown(id, store);
  assert.deepEqual(readRecentRanges(store), ['c', 'a', 'b']);
  for (let i = 0; i < 20; i++) noteRangeShown(`x${i}`, store);
  assert.equal(readRecentRanges(store).length, RANGE_HISTORY_MAX);
  assert.deepEqual(readRecentRanges({ getItem: () => 'not json' }), [], 'bad storage reads as no history');
  assert.deepEqual(readRecentRanges(null), []);
});
