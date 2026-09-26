/** Named landscape cases. Forced A/B state is labeled; it is not a natural schedule. */

export const REAL_BIOMES = Object.freeze([
  'ICEFIELD', 'TUNDRA', 'TAIGA', 'RAINFOREST', 'CONIFER', 'PINE_OAK',
  'BROADLEAF', 'CHAPARRAL', 'STEPPE', 'CANYON', 'DESERT',
]);

export const PRESETS = Object.freeze({
  primary: 'All 11 real biomes at seed 315, 45s, quality 0, 1280x720.',
  lighting: 'Day and night material motion for the four review biomes.',
  quality: 'Lowest quality and reduced-flash representatives.',
  viewport: 'Desktop, wide, portrait and DPR 2.',
  travel: 'A/B seam fractions.',
  geometry: 'Endpoints, plateau, valley, wrap and pullback.',
  visibility: '21 stations for scenic L2 and the horizon EQ.',
  lifecycle: 'Seek, pause, resize and disposal.',
  performance: 'Settled frames without diagnostic readback.',
  full: 'The review presets except performance readbacks.',
  motion: 'Short playback clips.',
});

const PRIMARY = {
  seed: 315, timeMs: 45000, level: 0, reducedFlash: false,
  width: 1280, height: 720, dpr: 1, pass: 'all',
};

export function casesForPreset(preset) {
  if (!Object.hasOwn(PRESETS, preset)) {
    throw new Error(`unknown landscape preset ${preset}`);
  }
  if (preset === 'primary' || preset === 'full') {
    return REAL_BIOMES.map((biome) => ({
      ...PRIMARY, biome, forced: true, label: 'material-fixture',
    }));
  }
  if (preset === 'lighting') {
    const biomes = ['RAINFOREST', 'STEPPE', 'DESERT', 'ICEFIELD'];
    const out = [];
    for (const biome of biomes) for (const seed of [42, 2026]) {
      out.push({ ...PRIMARY, biome, seed, timeMs: 45000, forced: true, label: 'material-fixture' });
    }
    for (const timeMs of [15000, 45000, 90000]) {
      out.push({ ...PRIMARY, biome: 'RAINFOREST', timeMs, forced: true, label: 'material-fixture' });
    }
    return out;
  }
  if (preset === 'quality') {
    return ['RAINFOREST', 'STEPPE', 'ICEFIELD'].flatMap((biome) => [
      { ...PRIMARY, biome, level: 6, forced: true, label: 'material-fixture' },
      { ...PRIMARY, biome, level: 0, reducedFlash: true, forced: true, label: 'material-fixture' },
    ]);
  }
  if (preset === 'viewport') {
    const views = [
      { width: 1280, height: 720, dpr: 1 },
      { width: 1920, height: 1080, dpr: 1 },
      { width: 720, height: 1280, dpr: 1 },
      { width: 1280, height: 720, dpr: 2 },
    ];
    return ['RAINFOREST', 'DESERT'].flatMap((biome) => views.map((view) => ({
      ...PRIMARY, biome, ...view, forced: true, label: 'material-fixture',
    })));
  }
  if (preset === 'visibility') {
    return Array.from({ length: 21 }, (_, i) => ({
      ...PRIMARY, biome: 'RAINFOREST', station: i, forced: false, label: 'visibility',
    }));
  }
  return [{ ...PRIMARY, biome: 'RAINFOREST', forced: true, label: preset }];
}

export function caseId(spec, extra = {}) {
  const parts = [
    spec.biome, spec.seed, spec.timeMs, spec.level, spec.reducedFlash ? 'flash' : 'full',
    spec.width, spec.height, spec.dpr, spec.pass || 'all',
    extra.fixtureHash || 'nofixture', extra.transition || 'settled',
  ];
  return parts.join(':');
}

export function requireBiomes(available, required = REAL_BIOMES) {
  const have = new Set(available);
  const missing = required.filter((name) => !have.has(name));
  if (missing.length) {
    throw new Error(`required biome missing from the cast: ${missing.join(', ')}`);
  }
}
