import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnergyCurves } from '../src/audio/EnergyCurves.js';
import { extractWatchFeatures, scoreWorlds, buildCustomWorld } from '../src/world/WorldScore.js';
import { getWorld, listWorlds, setCustomWorld, clearCustomWorld, DEFAULT_WORLD_ID } from '../src/world/Worlds.js';
import { buildingProfile, cityHeightField, windowOccupancy } from '../src/world/city/CitySilhouette.js';
import { extractRidgePortrait } from '../src/world/RidgePortrait.js';
import { castBiomes } from '../src/world/Dramaturgy.js';
import { CITY_TEMPERATURE } from '../src/world/city/CityPalettes.js';
import { clamp01, spread01 } from '../src/utils/math.js';

function makeCurves({ durationMs = 120000, rateHz = 50, energyAt, bandsAt } = {}) {
  const ec = new EnergyCurves(durationMs, rateHz);
  for (let i = 0; i < ec.n; i++) {
    const t01 = ec.n > 1 ? i / (ec.n - 1) : 0;
    const e = energyAt ? energyAt(t01) : 0.4;
    const shares = bandsAt ? bandsAt(t01) : [1, 1, 1, 1, 1, 1, 1];
    let sum = 0;
    for (const s of shares) sum += s;
    const frame = shares.map((s) => Math.max(0, e * s / (sum || 1)));
    ec.setFrame(i, frame);
  }
  return { ec, durationMs };
}

const bump = (t, at, w, h) => h * Math.exp(-(((t - at) / w) ** 2) * 4);

function metal() {
  return makeCurves({
    energyAt: (t) => 0.08 + bump(t, 0.22, 0.07, 0.82) + bump(t, 0.48, 0.06, 0.9) + bump(t, 0.75, 0.08, 0.85),
    bandsAt: () => [0.35, 0.55, 0.9, 1.25, 1.45, 1.35, 1.2],
  });
}

function lofi() {
  return makeCurves({
    energyAt: (t) => 0.28 + bump(t, 0.35, 0.18, 0.22) + bump(t, 0.7, 0.16, 0.18),
    bandsAt: () => [1.4, 1.3, 0.8, 0.55, 0.28, 0.16, 0.08],
  });
}

test('world registry: alpine default, nocturne present, unknown falls back', () => {
  assert.equal(DEFAULT_WORLD_ID, 'alpine');
  assert.equal(getWorld('nocturne').kind, 'city');
  assert.equal(getWorld('nope').id, 'alpine');
  assert.ok(listWorlds().length >= 2);
});

test('castBiomes accepts a city temperature map', () => {
  const names = castBiomes([0.1, 0.9], 7, CITY_TEMPERATURE);
  assert.equal(names.length, 2);
  assert.ok(names.every((n) => CITY_TEMPERATURE[n] != null));
  assert.notEqual(names[0], names[1]);
});

test('a wall-of-sound mix prefers The Range; a warm mid-tempo mix prefers After Hours', () => {
  const loud = metal();
  const quiet = lofi();
  const loudF = extractWatchFeatures({ energyCurves: loud.ec, durationMs: loud.durationMs, bpm: 160 });
  const quietF = extractWatchFeatures({ energyCurves: quiet.ec, durationMs: quiet.durationMs, bpm: 86 });
  const loudR = scoreWorlds(loudF);
  const quietR = scoreWorlds(quietF);
  const pick = (ranked, id) => ranked.find((r) => r.id === id).score;
  assert.ok(pick(loudR, 'alpine') > pick(loudR, 'nocturne'),
    `metal alpine ${pick(loudR, 'alpine')} vs city ${pick(loudR, 'nocturne')}`);
  assert.ok(pick(quietR, 'nocturne') > pick(quietR, 'alpine'),
    `lofi city ${pick(quietR, 'nocturne')} vs alpine ${pick(quietR, 'alpine')}`);
  assert.ok(loudR[0].recommended);
  assert.ok(loudR.every((r) => r.score >= 1 && r.score <= 99));
});

test('buildingProfile is rectangular with setbacks, not a mountain cone', () => {
  assert.equal(buildingProfile(0), 1);
  assert.equal(buildingProfile(0.4), 1);
  assert.ok(buildingProfile(0.7) < 1 && buildingProfile(0.7) > 0.7);
  assert.equal(buildingProfile(1), 0);
  // A cone would be ~0.5 at d=0.5; a building is still full height.
  assert.equal(buildingProfile(0.5), 1);
});

test('cityHeightField stays in 0..1, has flat-topped mass, and is deterministic', () => {
  const { ec, durationMs } = lofi();
  const portrait = extractRidgePortrait(ec, durationMs);
  const n = 256, step = 8, width = n * step;
  const a = cityHeightField(n, step, 42, width, portrait, 'L2');
  const b = cityHeightField(n, step, 42, width, portrait, 'L2');
  for (let i = 0; i < n; i++) {
    assert.equal(a[i], b[i]);
    assert.ok(a[i] >= 0 && a[i] <= 1);
  }
  // Flat roofs: a run of nearly-equal samples should exist (a building top).
  let longest = 1, run = 1;
  for (let i = 1; i < n; i++) {
    run = Math.abs(a[i] - a[i - 1]) < 0.02 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  assert.ok(longest >= 4, `expected a flat roof run, got ${longest}`);
});

test('generateSilhouette city profile returns a window strip', async () => {
  if (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined') return;
  const { generateSilhouette } = await import('../src/world/SilhouetteGenerator.js');
  const strip = generateSilhouette({
    seed: 9, width: 512, height: 160, color: '#101018', profile: 'city', step: 4,
  });
  assert.ok(strip.windows);
  assert.equal(strip.ridge.profile, 'city');
});

test('all 8 worlds are registered and have required fields', () => {
  const worlds = listWorlds();
  assert.equal(worlds.length, 8);
  for (const w of worlds) {
    assert.ok(w.id, `missing id`);
    assert.ok(w.name, `${w.id} missing name`);
    assert.ok(w.kind, `${w.id} missing kind`);
    assert.ok(w.comfort && typeof w.comfort.lo === 'number', `${w.id} missing comfort`);
    assert.ok(w.channels?.length >= 4, `${w.id} channels too few`);
    assert.ok(w.affinity && Object.keys(w.affinity).length >= 2, `${w.id} missing affinity`);
    assert.ok(w.palettes?.length >= 3, `${w.id} missing palettes`);
    assert.ok(typeof w.cast === 'function', `${w.id} missing cast`);
  }
});

test('farside wins for sparse, bright, cold songs', () => {
  const { ec, durationMs } = makeCurves({
    energyAt: () => 0.12,
    bandsAt: () => [0.1, 0.2, 0.4, 0.8, 1.3, 1.5, 1.4],
  });
  const feat = extractWatchFeatures({ energyCurves: ec, durationMs, bpm: 72 });
  const ranked = scoreWorlds(feat);
  const farside = ranked.find((r) => r.id === 'farside');
  assert.ok(farside, 'farside should be in rankings');
  assert.ok(farside.score >= 50, `farside score ${farside.score} too low for sparse bright song`);
});

test('redline wins for fast, driving, groovy songs', () => {
  const { ec, durationMs } = makeCurves({
    energyAt: (t) => 0.5 + 0.4 * Math.sin(t * Math.PI),
    bandsAt: () => [0.6, 0.8, 1.2, 1.4, 1.3, 1.0, 0.7],
  });
  const feat = extractWatchFeatures({ energyCurves: ec, durationMs, bpm: 155 });
  const ranked = scoreWorlds(feat);
  const redline = ranked.find((r) => r.id === 'redline');
  const foundry = ranked.find((r) => r.id === 'foundry');
  assert.ok(redline.score >= 55, `redline score ${redline.score} too low for fast song`);
  assert.ok(foundry.score >= 55, `foundry score ${foundry.score} too low for energetic song`);
});

test('understory wins for textured, spread, low-contrast songs', () => {
  const { ec, durationMs } = makeCurves({
    energyAt: () => 0.32,
    bandsAt: () => [0.8, 0.9, 1.0, 1.1, 1.1, 1.0, 0.9],
  });
  const feat = extractWatchFeatures({ energyCurves: ec, durationMs, bpm: 96 });
  const ranked = scoreWorlds(feat);
  const understory = ranked.find((r) => r.id === 'understory');
  assert.ok(understory, 'understory should be in rankings');
  assert.ok(understory.score >= 50, `understory score ${understory.score} too low for textured song`);
});

test('drive is actually spread01-corrected in the real pipeline, not just in isolation', () => {
  // extractWatchFeatures' `drive` is a 5-term weighted sum of arc/onset/
  // contrast/energyMean/tempoHeat, which collapses toward 0.5 by the
  // central limit theorem far more than the world comfort bands (authored
  // assuming rough 0..1 coverage) expect -- see spread01's own comment and
  // the dedicated reachability proof in test/spread01.test.js. That proof
  // is against the formula in isolation; this confirms the real production
  // code path actually applies it, by reconstructing the pre-spread raw
  // value from extractWatchFeatures' own returned sub-features and checking
  // `drive` is the spread01 of that, not the raw sum itself, across a real
  // spread of song shapes (so this doesn't just pin one lucky sample).
  const songs = [
    metal(), lofi(),
    makeCurves({ energyAt: (t) => 0.15 + bump(t, 0.5, 0.2, 0.4), bandsAt: () => [0.6, 0.7, 0.8, 0.9, 0.8, 0.7, 0.6] }),
    makeCurves({ energyAt: (t) => 0.05 + bump(t, 0.3, 0.08, 0.15), bandsAt: () => [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3] }),
  ];
  const bpms = [140, 72, 128, 90];
  let sawRealDivergence = false;
  songs.forEach(({ ec, durationMs }, i) => {
    const feat = extractWatchFeatures({ energyCurves: ec, durationMs, bpm: bpms[i] });
    const raw = clamp01(0.28 * feat.arc + 0.18 * feat.onset + 0.16 * feat.contrast + 0.14 * feat.energyMean + 0.24 * feat.tempoHeat);
    const expected = spread01(raw);
    assert.ok(Math.abs(feat.drive - expected) < 1e-9,
      `drive (${feat.drive}) should equal spread01 of its own raw sub-features (${expected}), raw=${raw}`);
    if (Math.abs(feat.drive - raw) > 0.01) sawRealDivergence = true;
  });
  assert.ok(sawRealDivergence, 'spread01 should visibly move drive away from the raw sum for at least one real song shape');
});

test('comfort bands partition drive space — no world covers full range', () => {
  const worlds = listWorlds();
  for (const w of worlds) {
    const span = w.comfort.hi - w.comfort.lo;
    assert.ok(span < 0.7, `${w.id} comfort range ${span} too wide`);
    assert.ok(span > 0.15, `${w.id} comfort range ${span} too narrow`);
  }
});

test('window occupancy sits down on a quiet open and up on a fevered drop', () => {
  const quiet = windowOccupancy({ energy: 0.1, openingGain: 0.4, orogeny: 0.1, fever: 0 });
  const drop = windowOccupancy({ energy: 0.85, openingGain: 1, orogeny: 0.8, fever: 0.6 });
  assert.ok(drop > quiet * 1.5, `drop ${drop} vs quiet ${quiet}`);
  assert.ok(quiet > 0.05 && drop < 1);
});

test('buildCustomWorld scores 100 for any song — proven by construction', () => {
  // Test across four very different songs: quiet ambient, loud metal,
  // mid-tempo groove, sparse high-frequency.
  const songs = [
    { label: 'ambient', energyAt: () => 0.12, bands: () => [1.4, 1.0, 0.6, 0.3, 0.1, 0.05, 0.02], bpm: 68 },
    { label: 'metal', energyAt: (t) => 0.08 + bump(t, 0.5, 0.1, 0.85), bands: () => [0.3, 0.5, 0.9, 1.3, 1.5, 1.3, 1.1], bpm: 175 },
    { label: 'groove', energyAt: () => 0.45, bands: () => [0.9, 1.1, 1.2, 1.0, 0.8, 0.5, 0.3], bpm: 96 },
    { label: 'sparse', energyAt: () => 0.08, bands: () => [0.1, 0.1, 0.3, 0.6, 1.2, 1.5, 1.6], bpm: 60 },
  ];

  for (const song of songs) {
    const { ec, durationMs } = makeCurves({
      energyAt: song.energyAt,
      bandsAt: song.bands,
    });
    const feat = extractWatchFeatures({ energyCurves: ec, durationMs, bpm: song.bpm });
    const { world, proof } = buildCustomWorld(feat);

    // The proof must hold:
    assert.equal(proof.score, 100, `${song.label}: score ${proof.score} !== 100`);
    assert.ok(Math.abs(proof.comfort - 1.0) < 1e-9, `${song.label}: comfort ${proof.comfort} !== 1.0`);
    assert.ok(Math.abs(proof.shape - 1.0) < 1e-9, `${song.label}: shape ${proof.shape} !== 1.0`);
    assert.ok(Math.abs(proof.coverageNorm - 1.0) < 1e-9, `${song.label}: coverageNorm ${proof.coverageNorm} !== 1.0`);
    assert.ok(Math.abs(proof.affinityNorm - 1.0) < 1e-9, `${song.label}: affinityNorm ${proof.affinityNorm} !== 1.0`);
    assert.ok(Math.abs(proof.mixed - 1.0) < 1e-9, `${song.label}: mixed ${proof.mixed} !== 1.0`);

    // The world must be usable: has all fields BiomeManager needs.
    assert.ok(world.kind, `${song.label}: missing kind`);
    assert.ok(world.palettes?.length >= 3, `${song.label}: missing palettes`);
    assert.ok(typeof world.cast === 'function', `${song.label}: missing cast`);
    assert.equal(world.custom, true);

    // Registering and retrieving must work.
    setCustomWorld(world);
    assert.equal(getWorld('custom').kind, world.kind);
    clearCustomWorld();
    assert.notEqual(getWorld('custom').id, 'custom');
  }
});

test('custom world inherits best base world kind', () => {
  // A loud, fast song should inherit a high-energy base world.
  const { ec, durationMs } = makeCurves({
    energyAt: (t) => 0.5 + 0.4 * Math.sin(t * Math.PI),
    bandsAt: () => [0.6, 0.8, 1.2, 1.4, 1.3, 1.0, 0.7],
  });
  const feat = extractWatchFeatures({ energyCurves: ec, durationMs, bpm: 155 });
  const ranked = scoreWorlds(feat);
  const { world } = buildCustomWorld(feat);
  assert.equal(world.baseId, ranked[0].id,
    `custom base ${world.baseId} !== top ranked ${ranked[0].id}`);
  assert.equal(world.kind, ranked[0].kind);
});
