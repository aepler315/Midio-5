import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDisplayPrefs, resolvePresentation, readDisplayPrefs, writeDisplayPrefs } from '../src/render/DisplayProfile.js';
import { PerfGovernor } from '../src/render/PerfGovernor.js';

const defaults = { version: 1, look: 'natural', quality: 'auto', palette: 'range32', dither: .35, scaling: 'fit' };
test('default and numeric resolutions keep Natural Auto', () => {
  assert.deepEqual(resolveDisplayPrefs({}), defaults);
  assert.deepEqual(resolveDisplayPrefs({ legacyStagePreset: 1080 }), defaults);
});
test('legacy modes migrate without losing Economy and RGB332', () => {
  assert.deepEqual(resolveDisplayPrefs({ legacyStagePreset: '8bit' }), { ...defaults, look: 'pixel', quality: 'economy' });
  assert.deepEqual(resolveDisplayPrefs({ legacyStagePreset: '8bit-intensive' }), { ...defaults, look: 'palette', quality: 'economy', palette: 'rgb332', dither: 1 });
});
test('validated saved settings take precedence; malformed input has usable defaults', () => {
  const saved = { ...defaults, look: 'palette', scaling: 'integer' };
  assert.deepEqual(resolveDisplayPrefs({ saved: JSON.stringify(saved), legacyStagePreset: '8bit' }), saved);
  for (const value of ['bad', '{}', '{"version":1,"look":"garbage"}', 'null', { ...saved, dither: -1 }]) {
    assert.deepEqual(resolveDisplayPrefs({ saved: value }), defaults);
  }
});
test('pixel grid and palette selection are independent of quality', () => {
  assert.deepEqual(resolvePresentation({ ...defaults, look: 'pixel' }), { pixelated: true, grid: { width: 320, height: 180 }, paletteId: 'none', dither: .35, quality: 'auto', scaling: 'fit' });
  assert.equal(resolvePresentation({ ...defaults, look: 'palette' }).paletteId, 'range32');
  assert.equal(resolvePresentation(defaults).grid, null);
});
test('blocked storage never prevents boot or a settings change', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.deepEqual(readDisplayPrefs(blocked), defaults);
  assert.equal(writeDisplayPrefs(blocked, defaults), false);
});
test('Economy stays pinned over two clean minutes while Pixel Auto keeps device quality', () => {
  const auto = new PerfGovernor({ startLevel: 2, economy: false });
  assert.equal(auto.level, 2);
  const economy = new PerfGovernor({ economy: true });
  for (let t = 0; t < 120000; t += 16) economy.sample(16, t);
  assert.equal(economy.level, 6);
  economy.economy = false;
  assert.equal(economy.economy, false);
});
test('offline rendering freezes the effective quality rather than forcing full quality', () => {
  const governor = new PerfGovernor({ startLevel: 3 });
  governor.freezeQuality();
  for (let t = 0; t < 120000; t += 1000) governor.sample(1000, t);
  assert.equal(governor.level, 3);
});
