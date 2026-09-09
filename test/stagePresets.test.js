// The stage-resolution menu lives in index.html and the presets it names
// live in StagePresets.js -- two files with no compile-time link between
// them. An option whose value no preset answers to silently falls back to
// 1080p, which on the 8-bit entry would mean the one setting a struggling
// device reaches for quietly doing the opposite of what it says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  STAGE_PRESETS, RETRO_PRESET, PALETTE_PRESET, DEFAULT_STAGE_PRESET,
  resolveStagePreset, stageDims, isRetroPreset, isPalettePreset,
} from '../src/render/StagePresets.js';

const indexHtml = readFileSync(
  fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8',
);

function stageResOptionValues() {
  const select = indexHtml.match(/<select id="stageRes"[\s\S]*?<\/select>/);
  assert.ok(select, 'index.html should still have a #stageRes select');
  return [...select[0].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
}

test('every option in the stage-resolution menu resolves to a real preset', () => {
  const values = stageResOptionValues();
  assert.ok(values.length >= 8, `expected the full preset menu, got ${values.length}`);
  for (const v of values) {
    const preset = resolveStagePreset(v);
    assert.notEqual(preset, null, `option value "${v}" resolves to no preset`);
    assert.ok(stageDims(preset).w > 0, `option "${v}" has no dimensions`);
  }
});

test('the menu offers both 8-bit modes, and only those two are retro', () => {
  const values = stageResOptionValues();
  assert.ok(values.includes(RETRO_PRESET), 'the 8-bit option is missing from index.html');
  assert.ok(values.includes(PALETTE_PRESET), 'the 8-bit intensive option is missing from index.html');
  const retro = Object.keys(STAGE_PRESETS).filter((k) => STAGE_PRESETS[k].retro).sort();
  assert.deepEqual(retro, [RETRO_PRESET, PALETTE_PRESET].sort());
  assert.equal(isRetroPreset(RETRO_PRESET), true);
  assert.equal(isRetroPreset(PALETTE_PRESET), true);
  assert.equal(isRetroPreset(DEFAULT_STAGE_PRESET), false);
  assert.equal(isRetroPreset(144), false);
});

test('only the intensive variant asks for the palette pass', () => {
  // The split is the point: a weak device must be able to buy the cheap
  // mode without also buying a per-frame readback it cannot afford.
  assert.equal(isPalettePreset(PALETTE_PRESET), true);
  assert.equal(isPalettePreset(RETRO_PRESET), false);
  assert.equal(isPalettePreset(DEFAULT_STAGE_PRESET), false);
  assert.equal(isPalettePreset('nonsense'), false);
  const palette = Object.keys(STAGE_PRESETS).filter((k) => STAGE_PRESETS[k].palette);
  assert.deepEqual(palette, [PALETTE_PRESET]);
});

test('both 8-bit modes render into the same small buffer', () => {
  // Intensive costs more per frame, not more pixels -- it must not quietly
  // raise the resolution as well, or it would be paying twice.
  assert.deepEqual(
    { w: stageDims(PALETTE_PRESET).w, h: stageDims(PALETTE_PRESET).h },
    { w: stageDims(RETRO_PRESET).w, h: stageDims(RETRO_PRESET).h },
  );
});

test('8-bit is a genuinely small buffer, not a relabelled full-size one', () => {
  const retro = stageDims(RETRO_PRESET);
  const def = stageDims(DEFAULT_STAGE_PRESET);
  assert.equal(retro.w, 320);
  assert.equal(retro.h, 180);
  // The whole claim of the mode: an order-of-magnitude cut in the pixels
  // every fill/composite/blit in the frame has to touch.
  assert.ok(
    (retro.w * retro.h) * 20 < def.w * def.h,
    `8-bit (${retro.w}×${retro.h}) should be far cheaper than the default (${def.w}×${def.h})`,
  );
});

test('8-bit upscales by whole pixels on the two commonest stage sizes', () => {
  // Why 320×180 rather than something smaller: a non-integer ratio makes
  // neighbouring source pixels land on different numbers of screen pixels,
  // which shimmers as the world scrolls -- the opposite of the crisp look
  // the mode is chosen for.
  const { w, h } = stageDims(RETRO_PRESET);
  for (const [dw, dh] of [[1280, 720], [1920, 1080]]) {
    assert.equal(dw % w, 0, `${dw} is not a whole multiple of ${w}`);
    assert.equal(dh % h, 0, `${dh} is not a whole multiple of ${h}`);
    assert.equal(dw / w, dh / h, 'horizontal and vertical scale must match');
  }
});

test('resolveStagePreset accepts what a select, localStorage, or a URL actually hands it', () => {
  assert.equal(resolveStagePreset('8bit'), RETRO_PRESET);
  assert.equal(resolveStagePreset(' 8BIT '), RETRO_PRESET, 'case/whitespace tolerant');
  assert.equal(resolveStagePreset('8bit-intensive'), PALETTE_PRESET);
  assert.equal(resolveStagePreset(' 8BIT-Intensive '), PALETTE_PRESET);
  assert.equal(resolveStagePreset('1080'), 1080, 'a select hands over strings');
  assert.equal(resolveStagePreset(1080), 1080, 'a number works too');
  assert.equal(resolveStagePreset('144'), 144);
});

test('resolveStagePreset rejects anything that names no preset', () => {
  for (const bad of [null, undefined, '', '  ', 'nonsense', '999', 999, '8', 8, NaN, {}]) {
    assert.equal(resolveStagePreset(bad), null, `${String(bad)} should not resolve`);
  }
});

test('stageDims falls back to the default rather than throwing on a bad key', () => {
  // A stored value from a future/older build must never break boot.
  assert.deepEqual(stageDims('nonsense'), STAGE_PRESETS[DEFAULT_STAGE_PRESET]);
  assert.deepEqual(stageDims(undefined), STAGE_PRESETS[DEFAULT_STAGE_PRESET]);
  assert.equal(isRetroPreset('nonsense'), false);
});
