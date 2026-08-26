import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateKey, buildSongDNA, FIFTHS_ORDER } from '../src/world/dna/SongDNA.js';
import { oklchToHex, hexToOklab, oklabDelta } from '../src/world/dna/OklchColor.js';
import { buildShapeGrammar, computeTemperature, pickFx, pickParticleKind } from '../src/world/dna/ShapeGrammar.js';
import { synthesizePalette, synthesizeSectionPalettes } from '../src/world/dna/PaletteSynth.js';

// The published Krumhansl-Schmuckler tonal-hierarchy profiles, rooted at C.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const rotate = (arr, n) => arr.map((_, i) => arr[(i - n + 12) % 12]);

test('estimateKey resolves an exact C major profile to C major with high confidence', () => {
  const { tonicPc, isMajor, confidence } = estimateKey(MAJOR_PROFILE);
  assert.equal(tonicPc, 0);
  assert.equal(isMajor, true);
  assert.ok(confidence > 0.8, `confidence ${confidence} too low`);
});

test('estimateKey resolves an exact A minor profile to A minor', () => {
  const hist = rotate(MINOR_PROFILE, 9); // root shifted from C to A
  const { tonicPc, isMajor, confidence } = estimateKey(hist);
  assert.equal(tonicPc, 9);
  assert.equal(isMajor, false);
  assert.ok(confidence > 0.8, `confidence ${confidence} too low`);
});

test('estimateKey rotates cleanly across all 12 tonics', () => {
  for (let pc = 0; pc < 12; pc++) {
    const { tonicPc } = estimateKey(rotate(MAJOR_PROFILE, pc));
    assert.equal(tonicPc, pc, `major profile rooted at ${pc} misread as ${tonicPc}`);
  }
});

test('FIFTHS_ORDER puts fifths-related keys 30 degrees apart, starting at C', () => {
  assert.equal(FIFTHS_ORDER[0], 0); // C
  assert.equal(FIFTHS_ORDER[1], 7); // G, a fifth up
  assert.equal(FIFTHS_ORDER[2], 2); // D
  assert.equal(new Set(FIFTHS_ORDER).size, 12); // every pitch class exactly once
});

function synthTimeline({ pitches, program = 0, channel = 0, n = 200, durationMs = 60000 }) {
  const timeline = [];
  for (let i = 0; i < n; i++) {
    timeline.push({
      tMs: (i / n) * durationMs,
      durMs: 200,
      pitch: pitches[i % pitches.length],
      vel: 0.6,
      role: 'MELODY',
      channel,
      program,
    });
  }
  return { timeline, durationMs, bpm: 120 };
}

test('buildSongDNA detects key from a MIDI timeline built on a C major triad', () => {
  const data = synthTimeline({ pitches: [60, 64, 67, 72, 64, 67] }); // C E G
  const dna = buildSongDNA(data);
  assert.equal(dna.tonicPc, 0);
  assert.equal(dna.isMajor, true);
  assert.equal(dna.hasTimeline, true);
});

test('buildSongDNA is deterministic: same song data -> same seed and same DNA', () => {
  const data = synthTimeline({ pitches: [57, 60, 64, 69] });
  const a = buildSongDNA(data);
  const b = buildSongDNA(data);
  assert.equal(a.seed, b.seed);
  assert.equal(a.tonicPc, b.tonicPc);
  assert.equal(a.isMajor, b.isMajor);
});

test('buildSongDNA falls back to spectral proxies with no timeline (audio-only upload)', () => {
  const dna = buildSongDNA({ durationMs: 60000, bpm: 100 });
  assert.equal(dna.hasTimeline, false);
  assert.ok(Number.isFinite(dna.seed));
  assert.ok(dna.tonicPc >= 0 && dna.tonicPc <= 11);
});

test('oklchToHex always returns a valid 6-digit hex, even at extreme out-of-gamut chroma', () => {
  for (const [L, C, H] of [[0.5, 0.4, 0], [0.9, 0.5, 120], [0.1, 0.3, 250], [0.5, 0, 90]]) {
    const hex = oklchToHex(L, C, H);
    assert.match(hex, /^#[0-9a-f]{6}$/);
  }
});

test('oklabDelta is zero for identical colors and positive for different ones', () => {
  const a = hexToOklab('#336699');
  const b = hexToOklab('#336699');
  const c = hexToOklab('#ffcc00');
  assert.ok(oklabDelta(a, b) < 1e-9);
  assert.ok(oklabDelta(a, c) > 0.05);
});

test('buildShapeGrammar weights are non-negative and normalized to sum 1', () => {
  const dna = buildSongDNA(synthTimeline({ pitches: [40, 43, 47], program: 30 })); // distorted guitar range
  const g = buildShapeGrammar(dna);
  const sum = Object.values(g).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`);
  for (const v of Object.values(g)) assert.ok(v >= 0);
});

test('computeTemperature, pickFx, pickParticleKind stay in range / return valid enums', () => {
  const VALID_FX = new Set(['starTwinkle', 'emberGlow', 'aurora', 'canopyDapple', 'glitchTear', 'petalPile',
    'prominence', 'lightning', 'lakeReflection', 'neonGrid', 'bioluminescence', 'mirage', 'godRays',
    'sporeGlow', 'sunMotes', 'nebulaBloom', 'crystalGlint']);
  const VALID_PARTICLES = new Set(['fireflies', 'embers', 'snow', 'pollen', 'antigrav', 'petals', 'rain',
    'flaresparks', 'digitalrain', 'sand', 'bubbles', 'spores']);
  for (const pitches of [[36, 38, 42], [72, 76, 79], [21, 24, 28]]) {
    const dna = buildSongDNA(synthTimeline({ pitches }));
    const temp = computeTemperature(dna);
    assert.ok(temp >= 0 && temp <= 1);
    assert.ok(VALID_FX.has(pickFx(temp)), `pickFx(${temp}) returned invalid fx`);
    const grammar = buildShapeGrammar(dna);
    assert.ok(VALID_PARTICLES.has(pickParticleKind(grammar, temp)), 'invalid particle kind');
  }
});

test('synthesizePalette satisfies its own hard constraints: silhouette dark, sky stops distinguishable', () => {
  const songs = [
    synthTimeline({ pitches: [60, 64, 67] }),
    synthTimeline({ pitches: [57, 60, 63, 67], program: 30 }),
    synthTimeline({ pitches: [72, 76, 79, 84], program: 73 }),
    { durationMs: 90000, bpm: 70 }, // audio-only, no timeline
  ];
  for (const data of songs) {
    const dna = buildSongDNA(data);
    const { profile, valid } = synthesizePalette(dna);
    assert.equal(valid, true, `song seed ${dna.seed} failed to find a valid palette`);

    const silL = hexToOklab(profile.silhouette)[0];
    assert.ok(silL < 0.40, `silhouette too bright: L=${silL}`);

    const [skyDark, skyMid, skyHot] = profile.sky.map(hexToOklab);
    assert.ok(oklabDelta(skyDark, skyMid) > 0.02, 'sky dark/mid too close');
    assert.ok(oklabDelta(skyMid, skyHot) > 0.02, 'sky mid/hot too close');
    assert.ok(oklabDelta(hexToOklab(profile.silhouette), skyDark) > 0.08, 'silhouette blends into sky');

    assert.ok(['sun', 'moon'].includes(profile.celestial.kind));
    assert.ok(profile.celestial.color && profile.celestial.haloColor);
    assert.ok(profile.particles.color);
    // Matches the range stock worlds actually use (BiomeManager scales the
    // ridge-dance amplitude by this directly) -- not 0..1.
    assert.ok(profile.terrainEnergy >= 0.6 && profile.terrainEnergy <= 1.35);
  }
});

test('synthesizePalette is deterministic for the same DNA', () => {
  const dna = buildSongDNA(synthTimeline({ pitches: [62, 65, 69] }));
  const a = synthesizePalette(dna);
  const b = synthesizePalette(dna);
  assert.deepEqual(a.profile.sky, b.profile.sky);
  assert.equal(a.profile.silhouette, b.profile.silhouette);
});

test('synthesizeSectionPalettes always yields >=2 distinctly-named entries so castBiomes never strands a section without a repeat-free choice', () => {
  const dna = buildSongDNA(synthTimeline({ pitches: [60, 64, 67, 71] }));
  const { palettes, temperature } = synthesizeSectionPalettes(dna, 'testworld');
  assert.ok(palettes.length >= 2, `only ${palettes.length} palette(s) generated`);
  const names = palettes.map((p) => p.name);
  assert.equal(new Set(names).size, names.length, 'palette names collide');
  for (const name of names) {
    assert.ok(Number.isFinite(temperature[name]), `${name} missing a temperature entry`);
    assert.ok(temperature[name] >= 0 && temperature[name] <= 1);
  }
});

test('section palettes stay in the same hue family (same tonic) across a song', () => {
  const dna = buildSongDNA(synthTimeline({ pitches: [60, 64, 67, 60, 64, 67] }));
  dna.sectionLabels = ['INTRO', 'VERSE', 'CHORUS', 'BRIDGE'];
  const { palettes } = synthesizeSectionPalettes(dna, 'hue-family');
  const hues = palettes.map((p) => {
    const [, a, b] = hexToOklab(p.sky[0]);
    return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  });
  for (let i = 1; i < hues.length; i++) {
    let d = Math.abs(hues[i] - hues[0]);
    d = Math.min(d, 360 - d);
    assert.ok(d < 70, `section ${i} hue ${hues[i]} strayed ${d}deg from section 0's ${hues[0]}`);
  }
});
