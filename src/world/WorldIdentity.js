// The visual facts that must survive song adaptation.
//
// A world may take on a song's color, timing, and terrain variation, but it
// may not lose the landmark and atmosphere that make it recognizable. Keep
// these policies keyed by kind: adapted worlds use the `custom` overlay id,
// while their kind remains the selected world's stable visual identity.

function policy({
  kind, landmark, signatureMotion, lightSource, paletteFloor, castPlacement,
  sharedEffects,
}) {
  return Object.freeze({
    kind,
    landmark,
    signatureMotion,
    lightSource,
    paletteFloor,
    castPlacement,
    sharedEffects: Object.freeze({ ...sharedEffects }),
  });
}

const OPEN_SKY = Object.freeze({ deepSky: true, constellations: true, meteors: true });
const ENCLOSED = Object.freeze({ deepSky: false, constellations: false, meteors: false });

export const WORLD_IDENTITIES = Object.freeze({
  alpine: policy({
    kind: 'alpine',
    landmark: 'a ridge line spanning the lower frame',
    signatureMotion: 'slow breathing contours',
    lightSource: 'a horizon sun or moon',
    paletteFloor: 0.22,
    castPlacement: 'figures cross the foreground ridge, never float in the sky',
    sharedEffects: OPEN_SKY,
  }),
  city: policy({
    kind: 'city',
    landmark: 'a layered skyline with lit districts',
    signatureMotion: 'window districts pulse with the groove',
    lightSource: 'street glow and a restrained moon',
    paletteFloor: 0.36,
    castPlacement: 'figures remain street-level, framed by buildings',
    sharedEffects: OPEN_SKY,
  }),
  airless: policy({
    kind: 'airless',
    landmark: 'a giant banded primary above the regolith',
    signatureMotion: 'slow libration and ballistic surface traces',
    lightSource: 'hard, unscattered primary light',
    paletteFloor: 0.40,
    castPlacement: 'figures stay grounded against the cratered horizon',
    sharedEffects: OPEN_SKY,
  }),
  abyssal: policy({
    kind: 'abyssal',
    landmark: 'a water ceiling with descending shafts',
    signatureMotion: 'slow pressure drift and caustic sway',
    lightSource: 'veiled sunlight through the surface',
    paletteFloor: 0.38,
    castPlacement: 'figures drift below the surface, never in an open sky',
    sharedEffects: ENCLOSED,
  }),
  strip: policy({
    kind: 'strip',
    landmark: 'a road vanishing into the horizon',
    signatureMotion: 'constant forward cruise',
    lightSource: 'a dominant horizon sun or moon plus signage',
    paletteFloor: 0.30,
    castPlacement: 'figures stay on the road corridor',
    sharedEffects: OPEN_SKY,
  }),
  foundry: policy({
    kind: 'foundry',
    landmark: 'smokestacks and a furnace glow from below',
    signatureMotion: 'machine strokes and molten pour pulses',
    lightSource: 'furnace uplight through smoke',
    paletteFloor: 0.32,
    castPlacement: 'figures move through the mill floor and gantries',
    sharedEffects: ENCLOSED,
  }),
  overgrowth: policy({
    kind: 'overgrowth',
    landmark: 'a dense canopy closing the upper frame',
    signatureMotion: 'canopy growth and opening light shafts',
    lightSource: 'filtered sunlight and dappled floor light',
    paletteFloor: 0.30,
    castPlacement: 'figures stay beneath the canopy among trunks and spores',
    sharedEffects: ENCLOSED,
  }),
  nave: policy({
    kind: 'nave',
    landmark: 'vaulted bays framing a central rose window',
    signatureMotion: 'returning bays resonate with phrases',
    lightSource: 'stained glass and interior shafts',
    paletteFloor: 0.34,
    castPlacement: 'figures occupy the nave floor beneath the vault',
    sharedEffects: ENCLOSED,
  }),
  cathode: policy({
    kind: 'cathode',
    landmark: 'a four-color CRT tube and raster horizon',
    signatureMotion: 'scanline crawl and sprite response',
    lightSource: 'phosphor emission from the tube',
    paletteFloor: 1,
    castPlacement: 'figures resolve as sprites inside the screen',
    sharedEffects: ENCLOSED,
  }),
});

/** Return an immutable policy for a kind, world, or previously resolved policy. */
export function identityFor(subject) {
  if (subject && typeof subject === 'object' && subject.sharedEffects && subject.landmark) return subject;
  const kind = typeof subject === 'string' ? subject : subject?.kind;
  return WORLD_IDENTITIES[kind] || WORLD_IDENTITIES.alpine;
}

/** Shared effects must be opted into by each world's physical setting. */
export function identityAllows(subject, effect) {
  return !!identityFor(subject).sharedEffects[effect];
}

/** Keep adaptation's stock-palette contribution above the world-specific floor. */
export function stockPaletteMixFor(subject, requested = 0) {
  return Math.max(identityFor(subject).paletteFloor, Number(requested) || 0);
}
