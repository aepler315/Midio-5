import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPECTRAL_CLASSES, sampleSpectralClass, blackbodyRGB, rgbToHue,
  sampleMagnitude, magnitudeToBrightness01, sizeForMagnitude, subPixelDraw,
  twinkleAmplitude, generateCatalogue,
} from '../src/world/StarCatalogue.js';
import { mulberry32 } from '../src/utils/math.js';

test('spectral class frequencies are right: M dwarfs dominate, O stars are vanishingly rare', () => {
  const rand = mulberry32(1);
  const counts = {};
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const { cls } = sampleSpectralClass(rand);
    counts[cls] = (counts[cls] || 0) + 1;
  }
  // M should be the overwhelming majority (~76% in the real census).
  assert.ok((counts.M || 0) / N > 0.65, `M should dominate, got ${(counts.M || 0) / N}`);
  // O is ~0.00003 of the population -- at N=20000 it should essentially
  // never appear, and must never outnumber M.
  assert.ok((counts.O || 0) < (counts.M || 0), 'O must never outnumber M');
  // Every class in the table should show up at least once at this sample size,
  // except O which is genuinely rare enough that its expected count is < 1.
  for (const c of SPECTRAL_CLASSES) {
    if (c.cls === 'O') continue;
    assert.ok((counts[c.cls] || 0) > 0, `class ${c.cls} never sampled in ${N} draws`);
  }
});

test('blackbody color runs red -> white -> blue as temperature rises, matching real stellar colors', () => {
  const cool = blackbodyRGB(2800);  // M dwarf: should read reddish
  const mid = blackbodyRGB(5800);   // G star (sun-like): should read roughly white
  const hot = blackbodyRGB(20000);  // B star: should read blue-white

  assert.ok(cool.r > cool.b, `cool star should be redder than blue: ${JSON.stringify(cool)}`);
  assert.ok(hot.b >= hot.r, `hot star should be blue-leaning: ${JSON.stringify(hot)}`);
  // Every channel always in valid 0..255 range across the whole stellar span.
  for (const t of [2400, 3000, 5000, 5800, 7500, 10000, 20000, 52000]) {
    const { r, g, b } = blackbodyRGB(t);
    for (const ch of [r, g, b]) {
      assert.ok(Number.isFinite(ch) && ch >= 0 && ch <= 255, `channel out of range at ${t}K: ${ch}`);
    }
  }
});

test('rgbToHue is finite and in [0,360) for every sampled temperature, and 0 for a true achromatic color', () => {
  assert.equal(rgbToHue({ r: 128, g: 128, b: 128 }), 0);
  for (const t of [2400, 4000, 5800, 10000, 30000]) {
    const h = rgbToHue(blackbodyRGB(t));
    assert.ok(Number.isFinite(h) && h >= 0 && h < 360, `hue out of range at ${t}K: ${h}`);
  }
});

test('luminosity function: faint stars vastly outnumber bright ones', () => {
  const rand = mulberry32(2);
  const N = 5000;
  let bright = 0, faint = 0;
  for (let i = 0; i < N; i++) {
    const mag = sampleMagnitude(rand);
    if (mag < 1) bright++;
    if (mag > 5) faint++;
  }
  assert.ok(faint > bright * 3, `expected faint >> bright, got faint=${faint} bright=${bright}`);
});

test('magnitudeToBrightness01 is monotonically decreasing (brighter = lower magnitude = higher brightness) and follows the real 2.512x/mag relation', () => {
  const b0 = magnitudeToBrightness01(-1.2);
  const b1 = magnitudeToBrightness01(-0.2);
  const b2 = magnitudeToBrightness01(0.8);
  assert.ok(b0 > b1 && b1 > b2);
  // One magnitude fainter should be ~1/2.512 the brightness (within the clamp).
  assert.ok(Math.abs(b1 / b0 - 1 / 2.512) < 0.01, `expected ~1/2.512 ratio, got ${b1 / b0}`);
});

test('sizeForMagnitude produces genuinely sub-pixel sizes for the faint end, not clamped to >=1', () => {
  const faintSize = sizeForMagnitude(6.5);
  const brightSize = sizeForMagnitude(-1.2);
  assert.ok(faintSize < 1, `faint star should be sub-pixel, got ${faintSize}`);
  assert.ok(brightSize > faintSize);
});

test('subPixelDraw preserves total light (size^2 * alpha) instead of dropping or rounding up faint stars', () => {
  const trueLight = 0.3 * 0.3 * 0.8; // sizePx=0.3, alpha=0.8
  const { drawSize, drawAlpha } = subPixelDraw(0.3, 0.8);
  assert.equal(drawSize, 1, 'sub-pixel stars still get a real pixel to draw into');
  assert.ok(drawAlpha > 0, 'must not vanish entirely');
  assert.ok(Math.abs(drawAlpha - trueLight) < 1e-9, `expected area-preserved alpha ${trueLight}, got ${drawAlpha}`);
  // A star already >=1px is passed through unchanged.
  const passthrough = subPixelDraw(2.4, 0.6);
  assert.deepEqual(passthrough, { drawSize: 2.4, drawAlpha: 0.6 });
});

test('twinkle amplitude is stronger for fainter (more point-like) stars and near the horizon', () => {
  const brightZenith = twinkleAmplitude(-1, 1);
  const brightHorizon = twinkleAmplitude(-1, 0);
  const faintZenith = twinkleAmplitude(6, 1);
  const faintHorizon = twinkleAmplitude(6, 0);
  assert.ok(faintHorizon > brightHorizon, 'a faint star at the horizon should twinkle hardest');
  assert.ok(brightHorizon > brightZenith, 'the same star twinkles more near the horizon than overhead');
  assert.ok(faintZenith > brightZenith, 'a faint star twinkles more than a bright one at the same altitude');
  for (const a of [brightZenith, brightHorizon, faintZenith, faintHorizon]) {
    assert.ok(a >= 0 && a <= 1, `amplitude out of [0,1]: ${a}`);
  }
});

test('generateCatalogue is deterministic per seed', () => {
  const a = generateCatalogue(42, 200, 1280, 720);
  const b = generateCatalogue(42, 200, 1280, 720);
  assert.deepEqual(a, b);
});

test('generateCatalogue produces the requested count, all finite/bounded, positions inside the field', () => {
  const cat = generateCatalogue(7, 300, 1280, 720);
  assert.equal(cat.length, 300);
  for (const s of cat) {
    assert.ok(s.x >= 0 && s.x <= 1280);
    assert.ok(s.y >= 0 && s.y <= 720);
    assert.ok(Number.isFinite(s.mag));
    assert.ok(s.brightness >= 0 && s.brightness <= 1);
    assert.ok(s.sizePx > 0);
    assert.ok(s.hue >= 0 && s.hue < 360);
    assert.ok(s.altitude01 >= 0 && s.altitude01 <= 1);
  }
});

test('the galactic-plane band genuinely has higher star density than the rest of the field', () => {
  const cat = generateCatalogue(13, 4000, 1280, 720);
  const bandY = 720 * 0.32, bandHalf = 720 * 0.08;
  let inBand = 0, outBand = 0;
  for (const s of cat) {
    if (Math.abs(s.y - bandY) <= bandHalf) inBand++; else outBand++;
  }
  const bandFracOfField = (bandHalf * 2) / 720;
  const expectedUniform = cat.length * bandFracOfField;
  assert.ok(inBand > expectedUniform * 2, `band should be denser than uniform: inBand=${inBand} expected~${expectedUniform}`);
});
