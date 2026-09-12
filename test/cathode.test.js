// Cathode: the pixel/CRT world. Tested the way renderer.test.js tests the
// painterly renderer -- through exported pure functions, with no canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATHODE_PALETTES, CATHODE_TEMPERATURE, personaFor, rampAt } from '../src/world/cathode/CathodePalettes.js';
import { BAYER_4X4, ditherThreshold, rampIndexFor, PIXEL_W, PIXEL_H } from '../src/world/cathode/PixelBuffer.js';
import { horizonRowFor, buildBackdropPixels, scanlineAlpha } from '../src/world/cathode/CathodeRenderer.js';
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
