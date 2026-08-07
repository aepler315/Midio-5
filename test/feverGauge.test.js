import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feverFillPct, feverColor, feverGlowAlpha, feverLabelAlpha } from '../src/ui/FeverGauge.js';

test('feverFillPct maps 0..1 to 0..100 and clamps out-of-range', () => {
  assert.equal(feverFillPct(0), 0);
  assert.equal(feverFillPct(0.5), 50);
  assert.equal(feverFillPct(1), 100);
  assert.equal(feverFillPct(-0.5), 0, 'negative levels clamp to empty');
  assert.equal(feverFillPct(1.5), 100, 'over-max levels clamp to full');
});

test('feverColor is a valid hsl string at every level', () => {
  for (const level of [0, 0.25, 0.5, 0.75, 1]) {
    const c = feverColor(level);
    assert.match(c, /^hsl\(\d+, \d+%, \d+%\)$/, `expected hsl string, got ${c}`);
  }
});

test('feverColor transitions teal -> gold -> hot pink without snapping', () => {
  const rest = feverColor(0);
  const mid = feverColor(0.5);
  const max = feverColor(1);
  // Parse hues: teal ~172, gold ~45, hot pink ~340.
  const hue = (c) => Number(c.match(/^hsl\((\d+)/)[1]);
  assert.ok(Math.abs(hue(rest) - 172) < 5, `rest should be teal, got hue ${hue(rest)}`);
  assert.ok(Math.abs(hue(mid) - 45) < 5, `mid should be gold, got hue ${hue(mid)}`);
  assert.ok(Math.abs(hue(max) - 340) < 5, `max should be hot pink, got hue ${hue(max)}`);
});

test('feverColor is continuous across the 0.5 seam (no wheel spin)', () => {
  const justBelow = feverColor(0.499);
  const justAbove = feverColor(0.501);
  const hue = (c) => Number(c.match(/^hsl\((\d+)/)[1]);
  const d = Math.abs(hue(justBelow) - hue(justAbove));
  assert.ok(d < 10, `expected a smooth transition across the seam, got delta ${d}`);
});

test('feverGlowAlpha stays dark below the threshold and ramps to full', () => {
  assert.equal(feverGlowAlpha(0), 0);
  assert.equal(feverGlowAlpha(0.29), 0, 'below 0.3 the bar reads calm, not perpetually lit');
  assert.ok(feverGlowAlpha(0.5) > 0 && feverGlowAlpha(0.5) < 1, 'mid fever glows partially');
  assert.equal(feverGlowAlpha(1), 1);
});

test('feverLabelAlpha brightens with the fever', () => {
  assert.ok(feverLabelAlpha(0) < feverLabelAlpha(0.5));
  assert.ok(feverLabelAlpha(0.5) < feverLabelAlpha(1));
  assert.ok(feverLabelAlpha(0) >= 0.3, 'the label stays discoverable at rest');
  assert.equal(feverLabelAlpha(1), 1);
});
