import test from 'node:test';
import assert from 'node:assert/strict';
import { fitPixelRect } from '../src/render/PixelPresentation.js';

for (const dpr of [1, 1.25, 1.5, 2]) for (const [w, h] of [[801, 481], [800, 480], [1000, 700], [853, 481], [720, 720], [540, 960], [1920, 1080]]) {
  test(`Integer origin and grid align at ${w}x${h} / DPR ${dpr}, including parent origin`, () => {
    const origin = { x: 11.3 * dpr, y: 7.7 * dpr };
    const r = fitPixelRect(320, 180, w * dpr, h * dpr, 'integer', origin);
    assert.ok(Math.abs(origin.x + r.x - Math.round(origin.x + r.x)) < 1e-9);
    assert.ok(Math.abs(origin.y + r.y - Math.round(origin.y + r.y)) < 1e-9);
    assert.equal(r.width % 320, 0); assert.equal(r.height % 180, 0);
    assert.ok(Math.abs(r.x - (w * dpr - r.width - r.x)) <= 1.000001);
    assert.ok(Math.abs(r.y - (h * dpr - r.height - r.y)) <= 1.000001);
  });
}
test('odd output centers Integer on whole pixels while Fit and sub-grid keep fractional aspect', () => {
  assert.deepEqual(fitPixelRect(320, 180, 801, 481, 'integer'), { x: 81, y: 61, width: 640, height: 360, scale: 2 });
  assert.ok(Math.abs(fitPixelRect(320, 180, 801, 481, 'fit').y - 15.21875) < 1e-9);
  const sub = fitPixelRect(320, 180, 160, 100, 'integer');
  assert.equal(sub.scale, .5); assert.equal(sub.y, 5);
});
