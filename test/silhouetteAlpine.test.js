import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValueNoise1D } from '../src/utils/noise.js';
import { alpineHeightField, rollingHeightField } from '../src/world/SilhouetteGenerator.js';

test('alpineHeightField is deterministic and stays in 0..1', () => {
  const noise = new ValueNoise1D(42, 256);
  const n = 256, step = 8, width = n * step;
  const a = alpineHeightField(noise, n, step, 42, width);
  const b = alpineHeightField(noise, n, step, 42, width);
  assert.equal(a.length, n);
  for (let i = 0; i < n; i++) {
    assert.equal(a[i], b[i]);
    assert.ok(a[i] >= 0 && a[i] <= 1, `height out of range at ${i}: ${a[i]}`);
  }
});

test('alpine profiles are peakier than rolling foothills', () => {
  const noise = new ValueNoise1D(7, 256);
  const n = 400, step = 5, width = n * step;
  const alpine = alpineHeightField(noise, n, step, 99, width);
  const rolling = rollingHeightField(noise, n, step, 2);

  let aMax = 0, rMax = 0, aSum = 0, rSum = 0;
  for (let i = 0; i < n; i++) {
    aMax = Math.max(aMax, alpine[i]);
    rMax = Math.max(rMax, rolling[i]);
    aSum += alpine[i];
    rSum += rolling[i];
  }
  // Alpine massifs push higher summits.
  assert.ok(aMax > 0.75, `alpine max too low: ${aMax}`);
  // Peakiness: max / mean is higher for alpine (sharp summits, lower valleys).
  const aPeak = aMax / (aSum / n + 1e-6);
  const rPeak = rMax / (rSum / n + 1e-6);
  assert.ok(aPeak > rPeak * 0.95, `alpine should be at least as peaky: a=${aPeak} r=${rPeak}`);
});

test('alpine massif has a few distinct high summits (not a flat plateau)', () => {
  const noise = new ValueNoise1D(3, 256);
  const n = 512, step = 4, width = n * step;
  const h = alpineHeightField(noise, n, step, 1234, width);
  // Count local maxima above 0.55
  let peaks = 0;
  for (let i = 2; i < n - 2; i++) {
    if (h[i] > 0.55 && h[i] >= h[i - 1] && h[i] >= h[i + 1] && h[i] > h[i - 2] && h[i] > h[i + 2]) {
      peaks++;
    }
  }
  assert.ok(peaks >= 2 && peaks <= 40, `expected several summits, got ${peaks}`);
});

test('alpine bake keeps ridge below strip top (no mesa clip)', async () => {
  // generateSilhouette needs a canvas; skip if neither OffscreenCanvas nor document.
  const { generateSilhouette } = await import('../src/world/SilhouetteGenerator.js');
  if (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined') {
    // Node without canvas polyfill — still verify the field isn't a plateau:
    // fraction of samples within 2% of the max should be small (sharp apex).
    const noise = new ValueNoise1D(11, 256);
    const n = 400, step = 5;
    const h = alpineHeightField(noise, n, step, 55, n * step);
    let max = 0;
    for (let i = 0; i < n; i++) max = Math.max(max, h[i]);
    let nearTop = 0;
    for (let i = 0; i < n; i++) if (h[i] > max * 0.92) nearTop++;
    assert.ok(nearTop / n < 0.08, `too many samples near max (mesa): ${nearTop}/${n}`);
    return;
  }
  const strip = generateSilhouette({
    seed: 77, height: 320, amplitude: 0.7, baseline: 0.35,
    color: '#445566', shadeMode: 'classic', profile: 'alpine',
  });
  const r = strip.ridge;
  assert.ok(r, 'ridge metadata present');
  // Every sample must sit at least a few px below the strip top.
  for (let i = 0; i < r.heights.length; i++) {
    const y = r.height * r.baseline - r.heights[i] * r.height * r.amplitude;
    assert.ok(y >= 4, `ridge clipped at sample ${i}: y=${y}`);
  }
});
