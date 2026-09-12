// Cathode: the pixel/CRT world. Tested the way renderer.test.js tests the
// painterly renderer -- through exported pure functions, with no canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATHODE_PALETTES, CATHODE_TEMPERATURE, personaFor, rampAt } from '../src/world/cathode/CathodePalettes.js';
import { BAYER_4X4, ditherThreshold, rampIndexFor, PIXEL_W, PIXEL_H } from '../src/world/cathode/PixelBuffer.js';
import {
  horizonRowFor, buildBackdropPixels, scanlineAlpha, VIGNETTE_ALPHA, LAYER_COUNT,
  shakeOffsetForBuffer, gridScrollSpeedFor,
} from '../src/world/cathode/CathodeRenderer.js';
import {
  layerColumnLevel, buildLayerHeights, layerConfigFor, layerRampIndex, runsFromHeights,
} from '../src/world/cathode/CathodeBackdrop.js';
import {
  BOSS_ROWS, BOSS_TOPPERS, MAX_TOPPER_ROWS, MAX_REL_LEVEL,
  parseSpriteRows, spriteRelativeToRampIndex, bossFormFor,
  beatFlinchScale, FLINCH_SCALE, FLINCH_CONFIDENCE_FLOOR,
  bossReassembleU, BOSS_REASSEMBLE_MS, glitchBandOffsets,
} from '../src/world/cathode/CathodeBoss.js';
import { ValueNoise1D } from '../src/utils/noise.js';
import { listWorlds, getWorld } from '../src/world/Worlds.js';
import { scoreWorlds } from '../src/world/WorldScore.js';

// --- personas ---------------------------------------------------------------

test('every persona is a structurally valid biome profile', () => {
  // BiomeManager keeps running under Cathode and reads these fields off the
  // cast profile, so a Cathode-only shape would break section bookkeeping
  // even though Cathode never calls its draw path.
  for (const p of CATHODE_PALETTES) {
    assert.ok(p.name, 'name');
    assert.equal(p.sky.length, 3, `${p.name} sky must have 3 stops`);
    assert.match(p.silhouette, /^#[0-9a-f]{6}$/i, `${p.name} silhouette`);
    assert.ok(p.celestial && ['sun', 'moon'].includes(p.celestial.kind), `${p.name} celestial.kind`);
    assert.ok(p.particles && typeof p.particles.kind === 'string', `${p.name} particles.kind`);
    assert.ok(typeof p.fx === 'string' && p.fx.length > 0, `${p.name} fx`);
    assert.ok(Number.isFinite(p.terrainEnergy), `${p.name} terrainEnergy`);
  }
});

test('every persona ramp is non-empty, all-hex, and free of duplicate colors', () => {
  for (const p of CATHODE_PALETTES) {
    assert.ok(p.ramp.length >= 4, `${p.name} needs at least 4 steps`);
    for (const c of p.ramp) assert.match(c, /^#[0-9a-f]{6}$/i, `${p.name} ramp entry ${c}`);
    assert.equal(new Set(p.ramp).size, p.ramp.length, `${p.name} has a duplicate ramp entry`);
  }
});

test('the personas span genuinely different color counts -- the era shift is structural, not just hue', () => {
  const sizes = CATHODE_PALETTES.map((p) => p.ramp.length);
  assert.ok(new Set(sizes).size > 1, 'all personas having the same ramp length would flatten the whole conceit');
  assert.ok(Math.min(...sizes) <= 4, 'at least one persona should be a 4-color machine');
  assert.ok(Math.max(...sizes) >= 16, 'at least one persona should be a 16-color machine');
});

test('every persona has a temperature, and every temperature names a real persona', () => {
  const names = new Set(CATHODE_PALETTES.map((p) => p.name));
  const temps = Object.keys(CATHODE_TEMPERATURE);
  assert.equal(temps.length, names.size);
  for (const t of temps) assert.ok(names.has(t), `${t} has a temperature but no palette`);
  for (const v of Object.values(CATHODE_TEMPERATURE)) assert.ok(v >= 0 && v <= 1);
});

test('personaFor resolves by name and falls back rather than returning undefined', () => {
  assert.equal(personaFor('DMG').name, 'DMG');
  assert.equal(personaFor('COMPOSITE').name, 'COMPOSITE');
  // A name from another world (or the very first frames, before any cast)
  // must still yield a drawable persona -- the renderer reads .ramp off
  // this every frame.
  assert.equal(personaFor('CRYPT').name, CATHODE_PALETTES[0].name);
  assert.equal(personaFor(null).name, CATHODE_PALETTES[0].name);
  assert.equal(personaFor(undefined).name, CATHODE_PALETTES[0].name);
  assert.ok(Array.isArray(personaFor('nonsense').ramp));
});

test('rampAt saturates instead of returning undefined for out-of-range indices', () => {
  const ramp = ['#000000', '#111111', '#222222'];
  assert.equal(rampAt(ramp, 0), '#000000');
  assert.equal(rampAt(ramp, 2), '#222222');
  assert.equal(rampAt(ramp, -5), '#000000', 'below the ramp saturates dark');
  assert.equal(rampAt(ramp, 99), '#222222', 'above the ramp saturates light');
  assert.equal(rampAt(ramp, 1.4), '#111111', 'fractional indices round');
  assert.equal(rampAt([], 0), '#000000', 'an empty ramp still yields a paintable color');
  assert.equal(rampAt(null, 0), '#000000');
});

// --- dithering --------------------------------------------------------------

test('the Bayer matrix is a complete 4x4 permutation of 0..15', () => {
  const flat = BAYER_4X4.flat();
  assert.equal(flat.length, 16);
  assert.deepEqual([...flat].sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i));
});

test('ditherThreshold is in (0,1) and wraps on both axes, including negatives', () => {
  for (let y = -8; y < 8; y++) {
    for (let x = -8; x < 8; x++) {
      const t = ditherThreshold(x, y);
      assert.ok(t > 0 && t < 1, `threshold at ${x},${y} = ${t}`);
      assert.equal(t, ditherThreshold(x + 4, y), 'wraps on x');
      assert.equal(t, ditherThreshold(x, y + 4), 'wraps on y');
    }
  }
});

test('rampIndexFor saturates at both ends for EVERY pixel -- the darkest and lightest bands never dither', () => {
  // This is the one that matters: a pure 0 or 1 has no neighbour to
  // stipple toward, so any dither there is visible noise in a flat sky.
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      assert.equal(rampIndexFor(0, 4, x, y), 0, `level 0 at ${x},${y}`);
      assert.equal(rampIndexFor(1, 4, x, y), 3, `level 1 at ${x},${y}`);
      assert.equal(rampIndexFor(-0.5, 4, x, y), 0, 'below range clamps');
      assert.equal(rampIndexFor(1.5, 4, x, y), 3, 'above range clamps');
    }
  }
});

test('rampIndexFor stays in range and rises monotonically with level', () => {
  const len = 6;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      let prev = -1;
      for (let l = 0; l <= 1.0001; l += 0.05) {
        const i = rampIndexFor(l, len, x, y);
        assert.ok(i >= 0 && i < len, `index ${i} out of range`);
        assert.ok(i >= prev, `index went backwards at level ${l} (${prev} -> ${i})`);
        prev = i;
      }
    }
  }
});

test('rampIndexFor actually dithers mid-levels -- neighbouring pixels disagree', () => {
  // Without this the gradient is just hard bands, which is the failure the
  // dither exists to prevent on a 4-color ramp.
  const seen = new Set();
  for (let x = 0; x < 4; x++) seen.add(rampIndexFor(0.5, 4, x, 0));
  assert.ok(seen.size > 1, 'a mid level should stipple between two ramp entries');
});

test('rampIndexFor degrades safely on a 1-entry or empty ramp', () => {
  assert.equal(rampIndexFor(0.5, 1, 0, 0), 0);
  assert.equal(rampIndexFor(0.5, 0, 0, 0), 0);
});

// --- backdrop ---------------------------------------------------------------

test('horizonRowFor sits inside the frame with room above and below', () => {
  const h = horizonRowFor(PIXEL_H);
  assert.ok(h > 0 && h < PIXEL_H);
  assert.ok(h > PIXEL_H * 0.4, 'needs sky to carry the persona');
  assert.ok(h < PIXEL_H * 0.8, 'needs floor for a cast to stand on');
});

test('buildBackdropPixels fills every pixel opaque, using only ramp colors', () => {
  const ramp = ['#000000', '#306230', '#8bac0f', '#ffffff'];
  const w = 16;
  const h = 12;
  const data = buildBackdropPixels(ramp, w, h, 8);
  assert.equal(data.length, w * h * 4);

  const allowed = new Set(['0,0,0', '48,98,48', '139,172,15', '255,255,255']);
  for (let i = 0; i < data.length; i += 4) {
    assert.equal(data[i + 3], 255, `pixel ${i / 4} must be opaque`);
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    assert.ok(allowed.has(key), `pixel ${i / 4} painted ${key}, which is not in the ramp`);
  }
});

test('buildBackdropPixels paints the whole sub-horizon band in the darkest ramp color', () => {
  const ramp = ['#010203', '#306230', '#8bac0f', '#ffffff'];
  const w = 8;
  const h = 10;
  const horizon = 6;
  const data = buildBackdropPixels(ramp, w, h, horizon);
  for (let y = horizon; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      assert.deepEqual([data[o], data[o + 1], data[o + 2]], [1, 2, 3], `ground pixel ${x},${y}`);
    }
  }
});

test('buildBackdropPixels survives a degenerate horizon of 0 without NaN pixels', () => {
  const data = buildBackdropPixels(['#000000', '#ffffff'], 4, 4, 0);
  for (let i = 0; i < data.length; i++) assert.ok(Number.isFinite(data[i]));
});

test('scanlineAlpha is visible, subtle, and quieter under reduced flash', () => {
  const normal = scanlineAlpha(false);
  const reduced = scanlineAlpha(true);
  assert.ok(normal > 0 && normal < 0.5, 'scanlines are texture, not a blackout');
  assert.ok(reduced < normal, 'reduced flash must lower the contrast');
  assert.ok(reduced > 0, 'but the CRT read is the point -- not removed entirely');
});

// --- registry integration ---------------------------------------------------

test('Cathode is registered, manual-only, and brings its own renderer', () => {
  const w = getWorld('cathode');
  assert.equal(w.id, 'cathode');
  assert.equal(w.kind, 'cathode');
  assert.equal(w.renderer, 'pixel');
  assert.equal(w.manualOnly, true);
  assert.equal(w.palettes, CATHODE_PALETTES);
  assert.ok(listWorlds().includes(w), 'the picker lists every world, including manual ones');
});

test('the analyzer never recommends Cathode, at any song', () => {
  // The real risk this guards: buildCustomWorld picks its base from
  // scoreWorlds(feat)[0], so a rankable Cathode could be cloned into a
  // custom world carrying kind:'cathode' -- which the painterly renderer
  // has no draw path for.
  for (const drive of [0, 0.25, 0.5, 0.75, 1]) {
    const ranked = scoreWorlds({ drive });
    assert.ok(ranked.length > 0, 'the scorer must still return worlds');
    assert.ok(!ranked.some((r) => r.id === 'cathode'), `cathode ranked at drive ${drive}`);
  }
});

test('scoreWorlds still honors an explicit world list, manual-only included', () => {
  const ranked = scoreWorlds({ drive: 0.5 }, [getWorld('cathode')]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 'cathode');
});

test('exactly one world is manual-only today, and every other world still ranks', () => {
  const manual = listWorlds().filter((w) => w.manualOnly);
  assert.deepEqual(manual.map((w) => w.id), ['cathode']);
  const ranked = scoreWorlds({ drive: 0.5 });
  assert.equal(ranked.length, listWorlds().length - 1);
});

// --- parallax backdrop -------------------------------------------------------

test('layerColumnLevel is always in [0,1] and constant across a whole column', () => {
  const noise = new ValueNoise1D(7, 64);
  const columnPx = 16;
  for (let col = 0; col < 6; col++) {
    const first = layerColumnLevel(noise, col * columnPx, columnPx);
    assert.ok(first >= 0 && first <= 1, `level ${first} out of range at column ${col}`);
    for (let x = col * columnPx; x < (col + 1) * columnPx; x++) {
      assert.equal(layerColumnLevel(noise, x, columnPx), first, `x=${x} broke the column-${col} plateau`);
    }
  }
});

test('buildLayerHeights matches layerColumnLevel by construction, and never reaches or passes the horizon', () => {
  const noise = new ValueNoise1D(3, 64);
  const w = 48;
  const horizon = 30;
  const opts = { columnPx: 12, ampPx: 20, baseRowsAboveHorizon: 5 };
  const heights = buildLayerHeights(noise, w, horizon, opts);
  assert.equal(heights.length, w);
  for (let x = 0; x < w; x++) {
    const level = layerColumnLevel(noise, x, opts.columnPx);
    const expected = Math.max(0, horizon - (opts.baseRowsAboveHorizon + Math.round(level * opts.ampPx)));
    assert.equal(heights[x], expected, `mismatch at x=${x}`);
    assert.ok(heights[x] < horizon, 'a silhouette must stay strictly above the horizon line, never on or past it');
    assert.ok(heights[x] >= 0, 'a height must never go off the top of the buffer');
  }
});

test('buildLayerHeights scrollPx is a pure phase shift of the same noise field', () => {
  // Scrolling must not re-seed or otherwise change the field -- shifting by
  // exactly one column width should reproduce the neighbouring column's
  // unscrolled value, at every column.
  const noise = new ValueNoise1D(11, 64);
  const w = 40;
  const horizon = 25;
  const columnPx = 8;
  const still = buildLayerHeights(noise, w + columnPx, horizon, { columnPx, scrollPx: 0 });
  const scrolled = buildLayerHeights(noise, w, horizon, { columnPx, scrollPx: columnPx });
  for (let x = 0; x < w; x++) {
    assert.equal(scrolled[x], still[x + columnPx], `scrolled x=${x} should equal unscrolled x=${x + columnPx}`);
  }
});

test('buildLayerHeights degrades safely on a degenerate (0 or negative) horizon', () => {
  const noise = new ValueNoise1D(1, 32);
  const heights = buildLayerHeights(noise, 10, 0);
  for (const h of heights) assert.equal(h, 0, 'nothing can rise above a horizon already at the top of the buffer');
});

test('layerConfigFor is deterministic per (seed, index) and distinguishes layers from each other', () => {
  const a1 = layerConfigFor(42, 0);
  const a2 = layerConfigFor(42, 0);
  assert.deepEqual([...a1.noise.table], [...a2.noise.table], 'same seed+index must reproduce the same noise field');
  assert.equal(a1.scrollPxPerSec, a2.scrollPxPerSec);

  const b = layerConfigFor(42, 1);
  assert.notDeepEqual([...a1.noise.table], [...b.noise.table], 'different layers of the same song must not share a field');
  // Parallax direction: farther (index 1) must not outrun or out-loom nearer (index 0).
  assert.ok(b.scrollPxPerSec < a1.scrollPxPerSec, 'farther layers must scroll slower');
  assert.ok(b.ampPx < a1.ampPx, 'farther layers must have a shallower silhouette');
});

test('layerConfigFor never throws on a non-finite or missing seed', () => {
  for (const seed of [undefined, null, NaN, Infinity]) {
    assert.doesNotThrow(() => layerConfigFor(seed, 0));
  }
});

test('every configured layer index (0..LAYER_COUNT-1) produces a usable config', () => {
  assert.ok(LAYER_COUNT >= 1);
  for (let i = 0; i < LAYER_COUNT; i++) {
    const cfg = layerConfigFor(99, i);
    assert.ok(cfg.noise instanceof ValueNoise1D);
    for (const key of ['scrollPxPerSec', 'columnPx', 'ampPx', 'baseRowsAboveHorizon']) {
      assert.ok(Number.isFinite(cfg[key]) && cfg[key] > 0, `layer ${i} missing/invalid ${key}`);
    }
  }
});

test('layerRampIndex always stays inside the ramp, even on a 4-color persona (COMPOSITE)', () => {
  const rampLen = 4; // the shortest real persona
  for (let i = 0; i < LAYER_COUNT; i++) {
    const idx = layerRampIndex(rampLen, i);
    assert.ok(idx >= 1 && idx <= rampLen - 2, `layer ${i} -> index ${idx} out of [1, ${rampLen - 2}]`);
  }
});

test('layerRampIndex never regresses toward the viewer as index increases', () => {
  const rampLen = 16; // the longest real persona (BREADBIN)
  let prev = -1;
  for (let i = 0; i < 5; i++) {
    const idx = layerRampIndex(rampLen, i);
    assert.ok(idx >= prev, `layer ${i} index ${idx} went backwards from ${prev}`);
    prev = idx;
  }
});

test('runsFromHeights: every run is strictly above the horizon and correctly sized', () => {
  const horizon = 20;
  const heights = new Int32Array([10, 10, 10, 15, 15, 20, 20, 5, 5, 5]);
  const runs = runsFromHeights(heights, horizon);
  assert.deepEqual(runs, [
    { x: 0, width: 3, height: 10 }, // horizon(20) - 10
    { x: 3, width: 2, height: 5 },
    // x=5,6 (height 20) omitted: not < horizon, so no run -- flush with the horizon line
    { x: 7, width: 3, height: 15 },
  ]);
});

test('runsFromHeights on an all-flat field below the horizon is a single run spanning the whole width', () => {
  const heights = new Int32Array(12).fill(4);
  const runs = runsFromHeights(heights, 20);
  assert.deepEqual(runs, [{ x: 0, width: 12, height: 16 }]);
});

test('runsFromHeights on a field entirely at/above the horizon produces no runs at all', () => {
  const heights = new Int32Array(8).fill(20);
  assert.deepEqual(runsFromHeights(heights, 20), []);
});

test('runsFromHeights never drops or double-counts a pixel: run widths sum to the below-horizon columns', () => {
  const noise = new ValueNoise1D(5, 64);
  const w = 64;
  const horizon = 40;
  const heights = buildLayerHeights(noise, w, horizon, { columnPx: 9, ampPx: 15, baseRowsAboveHorizon: 3 });
  const runs = runsFromHeights(heights, horizon);
  const covered = runs.reduce((sum, r) => sum + r.width, 0);
  const expected = heights.reduce((n, h) => n + (h < horizon ? 1 : 0), 0);
  assert.equal(covered, expected);
  // Non-overlapping and in order.
  for (let i = 1; i < runs.length; i++) {
    assert.ok(runs[i].x >= runs[i - 1].x + runs[i - 1].width, 'runs must not overlap');
  }
});

test('VIGNETTE_ALPHA is present but never blacks out the corners', () => {
  assert.ok(VIGNETTE_ALPHA > 0 && VIGNETTE_ALPHA < 0.6);
});

// --- world reactivity --------------------------------------------------

test('shakeOffsetForBuffer scales stage-space shake down to buffer-space', () => {
  const stageW = 1280;
  const bufferW = 320; // 1/4 scale
  // Small enough that neither axis hits the clamp (tested separately below).
  const r = shakeOffsetForBuffer(16, -8, stageW, bufferW);
  assert.equal(r.x, 4); // 16 * (320/1280)
  assert.equal(r.y, -2);
});

test('shakeOffsetForBuffer clamps an extreme shake instead of throwing the frame off-buffer', () => {
  const r = shakeOffsetForBuffer(10000, -10000, 1280, 320);
  assert.ok(r.x > 0 && r.x < 20, `x=${r.x} should clamp to a small buffer-space offset`);
  assert.ok(r.y < 0 && r.y > -20, `y=${r.y} should clamp to a small buffer-space offset`);
});

test('shakeOffsetForBuffer is 0,0 for no shake, and degrades safely on a degenerate stage width', () => {
  assert.deepEqual(shakeOffsetForBuffer(0, 0, 1280, 320), { x: 0, y: 0 });
  assert.deepEqual(shakeOffsetForBuffer(5, 5, 0, 320), { x: 0, y: 0 });
  assert.deepEqual(shakeOffsetForBuffer(undefined, undefined, 1280, 320), { x: 0, y: 0 });
});

test('gridScrollSpeedFor rises with epic and stays positive at epic 0 (a quiet verse still crawls, never freezes)', () => {
  const quiet = gridScrollSpeedFor(0);
  const loud = gridScrollSpeedFor(1);
  assert.ok(quiet > 0);
  assert.ok(loud > quiet);
});

test('gridScrollSpeedFor clamps out-of-range epic instead of extrapolating', () => {
  assert.equal(gridScrollSpeedFor(-5), gridScrollSpeedFor(0));
  assert.equal(gridScrollSpeedFor(5), gridScrollSpeedFor(1));
});

// --- the boss ------------------------------------------------------------

test('the boss sprite parses to a rectangular grid with no ragged rows', () => {
  const { w, h, cells } = parseSpriteRows(BOSS_ROWS);
  assert.equal(h, BOSS_ROWS.length);
  assert.equal(cells.length, w * h);
  assert.ok(w > 0 && h > 0);
});

test('every digit used in the boss art is within [0, MAX_REL_LEVEL]', () => {
  const { cells } = parseSpriteRows(BOSS_ROWS);
  for (const v of cells) {
    if (v < 0) continue; // transparent
    assert.ok(v <= MAX_REL_LEVEL, `sprite digit ${v} exceeds MAX_REL_LEVEL (${MAX_REL_LEVEL})`);
  }
});

test('the boss art is not empty -- at least half its cells are opaque', () => {
  const { cells } = parseSpriteRows(BOSS_ROWS);
  const opaque = [...cells].filter((v) => v >= 0).length;
  assert.ok(opaque > cells.length * 0.3, 'a mostly-transparent grid would read as barely a sprite');
});

test('parseSpriteRows pads ragged rows with transparent rather than misaligning them', () => {
  const { w, h, cells } = parseSpriteRows(['012', '0', '01234']);
  assert.equal(w, 5);
  assert.equal(h, 3);
  // Row 1 ("0") should be '0' then four transparent cells, not shifted.
  assert.deepEqual([...cells.slice(w, w * 2)], [0, -1, -1, -1, -1]);
});

test('parseSpriteRows treats an unrecognized character as transparent, not a crash or a stray color', () => {
  const { cells } = parseSpriteRows(['0#2', '.x.']);
  assert.deepEqual([...cells], [0, -1, 2, -1, -1, -1]);
});

test('parseSpriteRows on an empty sprite (no topper for this persona) yields a 0x0 grid, not a throw', () => {
  const { w, h, cells } = parseSpriteRows([]);
  assert.equal(w, 0);
  assert.equal(h, 0);
  assert.equal(cells.length, 0);
});

test('every registered persona has a topper entry, even if empty (PHOSPHOR)', () => {
  for (const p of CATHODE_PALETTES) {
    assert.ok(Object.prototype.hasOwnProperty.call(BOSS_TOPPERS, p.name), `${p.name} has no topper entry at all`);
  }
  assert.deepEqual(bossFormFor('PHOSPHOR'), []);
});

test('bossFormFor never throws and returns an array for any input, including unknown personas', () => {
  for (const name of ['DMG', 'BREADBIN', 'APERTURE', 'COMPOSITE', 'nonsense', null, undefined]) {
    assert.ok(Array.isArray(bossFormFor(name)), `bossFormFor(${name}) did not return an array`);
  }
});

test('MAX_TOPPER_ROWS actually bounds every authored topper', () => {
  for (const rows of Object.values(BOSS_TOPPERS)) {
    assert.ok(rows.length <= MAX_TOPPER_ROWS, `a topper taller than MAX_TOPPER_ROWS would be clipped by the renderer`);
  }
  // And it's not a vacuous bound -- at least one topper actually uses it.
  assert.ok(Object.values(BOSS_TOPPERS).some((rows) => rows.length === MAX_TOPPER_ROWS));
});

test('spriteRelativeToRampIndex spans the full ramp on both a 4-color and a 16-color persona', () => {
  for (const rampLen of [4, 16]) {
    assert.equal(spriteRelativeToRampIndex(0, rampLen), 0);
    assert.equal(spriteRelativeToRampIndex(MAX_REL_LEVEL, rampLen), rampLen - 1);
  }
});

test('spriteRelativeToRampIndex stays in range and non-decreasing across the whole relative scale', () => {
  for (const rampLen of [1, 2, 4, 6, 16]) {
    let prev = -1;
    for (let rel = 0; rel <= MAX_REL_LEVEL; rel++) {
      const idx = spriteRelativeToRampIndex(rel, rampLen);
      assert.ok(idx >= 0 && idx < rampLen, `index ${idx} out of range for rampLen ${rampLen}`);
      assert.ok(idx >= prev, `index went backwards at rel=${rel}`);
      prev = idx;
    }
  }
});

test('spriteRelativeToRampIndex degrades safely on a degenerate ramp length', () => {
  assert.equal(spriteRelativeToRampIndex(2, 0), 0);
  assert.equal(spriteRelativeToRampIndex(2, -1), 0);
});

test('beatFlinchScale pops only in the first FLINCH_WINDOW of a beat, and only when the lock is confident', () => {
  const confident = FLINCH_CONFIDENCE_FLOOR + 0.1;
  assert.equal(beatFlinchScale(0, confident), FLINCH_SCALE);
  assert.equal(beatFlinchScale(0.05, confident), FLINCH_SCALE);
  assert.equal(beatFlinchScale(0.5, confident), 1);
  assert.equal(beatFlinchScale(0.99, confident), 1);
});

test('beatFlinchScale never pops on an unlocked (low-confidence) beat, however the phase lands', () => {
  const unconfident = FLINCH_CONFIDENCE_FLOOR - 0.1;
  for (const phase of [0, 0.05, 0.1, 0.5]) {
    assert.equal(beatFlinchScale(phase, unconfident), 1, `phase ${phase} should not flinch while unlocked`);
  }
});

test('beatFlinchScale wraps phase into [0,1) so a phase of exactly 1 or slightly over still reads as beat-start', () => {
  const confident = FLINCH_CONFIDENCE_FLOOR + 0.1;
  assert.equal(beatFlinchScale(1, confident), FLINCH_SCALE);
  assert.equal(beatFlinchScale(1.05, confident), FLINCH_SCALE);
});

test('bossReassembleU: 1 (together) before any drop, since dropAtMs starts at -Infinity', () => {
  assert.equal(bossReassembleU(-Infinity), 1);
  assert.equal(bossReassembleU(-1), 1);
});

test('bossReassembleU: 0 right at a drop, 1 once BOSS_REASSEMBLE_MS has passed, monotonic between', () => {
  assert.equal(bossReassembleU(0), 0);
  assert.equal(bossReassembleU(BOSS_REASSEMBLE_MS), 1);
  assert.equal(bossReassembleU(BOSS_REASSEMBLE_MS + 1000), 1);
  let prev = -1;
  for (let age = 0; age <= BOSS_REASSEMBLE_MS; age += 20) {
    const u = bossReassembleU(age);
    assert.ok(u >= prev, `reassembly must not un-reassemble at age=${age}`);
    assert.ok(u >= 0 && u <= 1);
    prev = u;
  }
});

test('glitchBandOffsets is all zero at intensity 0, so callers can multiply it in unconditionally', () => {
  const offsets = glitchBandOffsets(1, 12.3, 0, 6, 10);
  assert.deepEqual(offsets, [0, 0, 0, 0, 0, 0]);
});

test('glitchBandOffsets never exceeds maxOffsetPx at full intensity, for any band', () => {
  const offsets = glitchBandOffsets(7, 3.14, 1, 8, 5);
  assert.equal(offsets.length, 8);
  for (const o of offsets) assert.ok(Math.abs(o) <= 5, `offset ${o} exceeds maxOffsetPx`);
});

test('glitchBandOffsets scales down with intensity: a lower intensity never offsets farther than a higher one at the same instant', () => {
  const low = glitchBandOffsets(9, 1.0, 0.2, 6, 10);
  const high = glitchBandOffsets(9, 1.0, 1.0, 6, 10);
  for (let i = 0; i < 6; i++) {
    assert.ok(Math.abs(low[i]) <= Math.abs(high[i]) + 1e-9, `band ${i}: low=${low[i]} high=${high[i]}`);
  }
});

test('glitchBandOffsets is deterministic: same seed/time/bands always tears the same way', () => {
  const a = glitchBandOffsets(42, 2.0, 0.8, 5, 8);
  const b = glitchBandOffsets(42, 2.0, 0.8, 5, 8);
  assert.deepEqual(a, b);
});

test('glitchBandOffsets holds steady within one time-step rather than re-randomizing every call', () => {
  const a = glitchBandOffsets(3, 1.001, 0.5, 4, 6, 0.05);
  const b = glitchBandOffsets(3, 1.019, 0.5, 4, 6, 0.05); // same 0.05s step
  assert.deepEqual(a, b);
});

test('glitchBandOffsets differs across time steps often enough to read as tearing, not a frozen shift', () => {
  const a = glitchBandOffsets(3, 1.0, 1, 6, 10, 0.05);
  const b = glitchBandOffsets(3, 2.0, 1, 6, 10, 0.05); // a full second later, many steps on
  assert.notDeepEqual(a, b);
});

test('glitchBandOffsets degrades safely on a zero/negative bandCount', () => {
  assert.deepEqual(glitchBandOffsets(1, 1, 1, 0, 10), []);
});
