import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WIRE_LAYERS, wireOffset, wireAmplitude, wireColor, contrastRatio, resampleCrest, drawCrestWire,
} from '../src/world/CrestWire.js';
import { hexToRgb, rgbToHsl } from '../src/utils/color.js';

const cfg = WIRE_LAYERS.L4;

test('quiet is a sine, loud is a zigzag, and both stay within the amplitude', () => {
  const quarter = cfg.wavelength / 4;
  // At a quarter wavelength both shapes peak at the amplitude.
  assert.ok(Math.abs(wireOffset(quarter, 0, cfg, 3, 0) - 3) < 1e-9);
  assert.ok(Math.abs(wireOffset(quarter, 0, cfg, 3, 1) - 3) < 1e-9);
  // An eighth of the way the sine is already at 0.707, the zigzag only at 0.5.
  const eighth = cfg.wavelength / 8;
  assert.ok(Math.abs(wireOffset(eighth, 0, cfg, 1, 0) - Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(wireOffset(eighth, 0, cfg, 1, 1) - 0.5) < 1e-9);
  for (let x = 0; x < 200; x += 1.7) assert.ok(Math.abs(wireOffset(x, 3.1, cfg, 3, 0.6)) <= 3 + 1e-9);
});

test('the wave travels along the crest over time', () => {
  assert.notEqual(wireOffset(5, 0, cfg, 3, 0), wireOffset(5, 0.05, cfg, 3, 0));
});

test('loudness and the kick grow the wire, and it buzzes', () => {
  const at = (loud, kick, t) => wireAmplitude(cfg, loud, kick, t);
  const quarterBuzz = 1 / (13 * 4); // a quarter of a buzz cycle
  assert.ok(at(1, 0, 0) > at(0, 0, 0));
  assert.ok(at(0, 1, 0) > at(0, 0, 0));
  assert.notEqual(at(0.5, 0.5, 0), at(0.5, 0.5, quarterBuzz));
});

test('the wire colour stands out from the ridge and the sky behind it, on the ridge\'s complement', () => {
  const pairs = [['#2a3a2f', '#9fb7c9'], ['#e8ecef', '#c9d8e8'], ['#1b1028', '#0a0612'], ['#6e5a3a', '#e9b872']];
  for (const [body, behind] of pairs) {
    const c = wireColor(body, behind);
    assert.ok(Math.min(contrastRatio(c, body), contrastRatio(c, behind)) >= 1.2, `${c} on ${body}/${behind}`);
    const { l, s } = rgbToHsl(...Object.values(hexToRgb(c)));
    assert.ok(l >= 0.44 && s > 0.9, 'bright and saturated, so it can glow');
  }
  const bodyHue = rgbToHsl(...Object.values(hexToRgb('#6e5a3a'))).h;
  const wireHue = rgbToHsl(...Object.values(hexToRgb(wireColor('#6e5a3a', '#e9b872')))).h;
  const d = Math.abs((((wireHue - bodyHue) % 360) + 360) % 360 - 180);
  assert.ok(d < 10, 'complementary hue');
});

test('a grey ridge on a grey sky takes its hue from the accent', () => {
  const c = wireColor('#555555', '#999999', '#ff3366');
  const h = rgbToHsl(...Object.values(hexToRgb(c))).h;
  assert.ok(Math.abs(h - rgbToHsl(255, 0x33, 0x66).h) < 3);
});

test('the crest is resampled finely and drawn with its glow', () => {
  const line = resampleCrest([{ x: 0, y: 10 }, { x: 8, y: 18 }, { x: 16, y: 10 }], 2);
  assert.equal(line.length, 9);
  assert.equal(line[2].y, 14);
  const calls = [];
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : (...a) => calls.push([k, ...a])),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  drawCrestWire(ctx, [{ x: 0, y: 10 }, { x: 60, y: 30 }], { cfg, color: '#ff00ff', amp: 3, sharp: 0.5, tSec: 1 });
  assert.equal(calls.filter((c) => c[0] === 'stroke').length, 3);
  drawCrestWire(ctx, [{ x: 0, y: 10 }, { x: 60, y: 30 }], { cfg, color: '#ff00ff', amp: 3, sharp: 0.5, tSec: 1, glow: false });
  assert.equal(calls.filter((c) => c[0] === 'stroke').length, 4);
});
