import { hexLerp } from '../../utils/color.js';
import { shiftLightness } from '../../render/VisualStyle.js';

// Artistic cover and material permissions, keyed by the actual real-biome name.
const ROWS = {
  ICEFIELD: [0.10, 0, 'ice', true],
  TUNDRA: [0.25, 0.10, 'mat', true],
  TAIGA: [0.55, 0.75, 'conifer', true],
  RAINFOREST: [0.85, 0.90, 'conifer', false],
  CONIFER: [0.45, 0.65, 'conifer', false],
  PINE_OAK: [0.25, 0.45, 'broadleaf', false],
  BROADLEAF: [0.55, 0.65, 'broadleaf', false],
  CHAPARRAL: [0.10, 0.25, 'scrub', false],
  STEPPE: [0.05, 0.10, 'grass', false],
  CANYON: [0.02, 0.10, 'stone', false],
  DESERT: [0, 0, 'sand', false],
};
const POLICIES = Object.fromEntries(Object.entries(ROWS).map(([key, [moisture, canopy, cover, snowAllowed]]) =>
  [key, Object.freeze({ key, moisture, canopy, cover, snowAllowed })]));
const DEFAULT = Object.freeze({ key: 'CUSTOM', moisture: 0, canopy: 0.08, cover: 'stone', snowAllowed: false });
const ALPINE_PASSES = Object.freeze({ scenicWire: false, connector: false, distantWavePaint: false, fullHaze: false, shimmerSlices: false });
const OTHER_PASSES = Object.freeze({ scenicWire: true, connector: true, distantWavePaint: true, fullHaze: true, shimmerSlices: true });

export function landscapePolicy(key) { return POLICIES[key] || DEFAULT; }
export function landscapeSnowAllowed(key, snowLine01) {
  const policy = landscapePolicy(key);
  return policy.snowAllowed || (['RAINFOREST', 'CONIFER'].includes(policy.key) && snowLine01 >= .9);
}
export function landscapePasses(kind) { return kind === 'alpine' ? ALPINE_PASSES : OTHER_PASSES; }
export function landscapeBudget(level = 0) {
  if (level >= 6) return { facetsPerLayer: 6, gulliesPerLayer: 0, standsPerLayer: 6, fogBanks: 0, localWetFx: false };
  if (level >= 3) return { facetsPerLayer: 12, gulliesPerLayer: 4, standsPerLayer: 12, fogBanks: 2, localWetFx: false };
  return { facetsPerLayer: 24, gulliesPerLayer: 12, standsPerLayer: 24, fogBanks: 4, localWetFx: true };
}

export function landscapeLayerColor(silhouetteHex, skyHex, layerKey, biomeKey) {
  const mix = { L2: .30, L3: .15, L4: .04, L5: 0 }[layerKey] ?? 0;
  const lift = { L2: .04, L3: .02, L4: 0, L5: -.02 }[layerKey] ?? 0;
  // Biome identity stays in the source hue; the sky mix is depth, not a new palette.
  void biomeKey;
  return shiftLightness(hexLerp(silhouetteHex, skyHex || silhouetteHex, mix), lift);
}
