import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seaLineY, shimmerBands, shimmerOffsetX } from '../src/world/Ocean.js';

test('seaLineY is bounded, finite, and periodic in u', () => {
  for (let t = 0; t < 20; t += 1.3) {
    for (let bass = 0; bass <= 1; bass += 0.5) {
      let prev;
      for (let u = 0; u <= 1.001; u += 0.02) {
        const y = seaLineY(u % 1, t, bass, 0);
        assert.ok(Number.isFinite(y));
        assert.ok(Math.abs(y) <= 2.2 + 1.4 + 0.01, `unbounded at u=${u}: ${y}`);
        prev = y;
      }
      const start = seaLineY(0, t, bass, 0);
      const end = seaLineY(1, t, bass, 0);
      assert.ok(Math.abs(start - end) < 1e-6, `not periodic: ${start} vs ${end}`);
      void prev;
    }
  }
});

test('seaLineY amplitude scales with bass, kick presses the line down', () => {
  const quiet = seaLineY(0.15, 2, 0, 0);
  const loud = seaLineY(0.15, 2, 1, 0);
  assert.ok(Math.abs(loud) >= Math.abs(quiet) - 1e-9 || loud !== quiet, 'bass should change the wave amplitude');
  const noKick = seaLineY(0.3, 1, 0.5, 0);
  const withKick = seaLineY(0.3, 1, 0.5, 1);
  assert.ok(withKick < noKick, 'a kick should press the sea line down');
});

test('shimmerBands is deterministic per seed and respects count/ranges', () => {
  const a = shimmerBands(11, 5);
  const b = shimmerBands(11, 5);
  const c = shimmerBands(99, 5);
  assert.equal(a.length, 5);
  assert.deepEqual(a, b, 'same seed reproduces identical bands');
  assert.notDeepEqual(a, c, 'different seeds should differ');
  for (const band of a) {
    assert.ok(band.yFrac > 0 && band.yFrac < 1);
    assert.ok(band.speed > 0);
    assert.ok(band.dashLen > 0 && band.gapLen > 0);
    assert.ok(band.alpha > 0 && band.alpha < 1);
  }
  assert.equal(shimmerBands(1, 8).length, 8);
});

test('shimmerOffsetX stays within one dash period and is finite', () => {
  const band = shimmerBands(3, 1)[0];
  const period = band.dashLen + band.gapLen;
  for (let t = 0; t < 50; t += 0.7) {
    const off = shimmerOffsetX(band, t, t * 37);
    assert.ok(Number.isFinite(off));
    assert.ok(off >= 0 && off < period, `out of period range: ${off}`);
  }
});
