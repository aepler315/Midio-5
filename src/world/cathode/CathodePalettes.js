// Cathode's biomes are HARDWARE, not weather.
//
// Every other world rotates a palette that means a time of day or a mood --
// CRYPT into GLORIA, dusk into night. Cathode rotates the machine the show
// is supposedly running on: a Game Boy's four greens, a C64's sixteen, a
// CGA card's four screaming ones. The song moves between eras instead of
// between hours, so a chorus doesn't just get brighter, it gets *newer*.
//
// Each persona carries a `ramp`: an ordered dark-to-light list that is the
// ONLY set of colors the pixel renderer is allowed to draw with. That
// restriction is the whole look. Authentic palettes are curated, not
// computed -- an even RGB cube (what PaletteQuantize.js produces for the
// 8-bit stage preset) reads as "downsampled", while these read as
// "authored", because the gaps between their colors are the gaps real
// hardware had.
//
// The remaining fields exist because these objects are still biome
// profiles: BiomeManager keeps running under Cathode (it owns the section
// schedule, key/hue state, and the dramaturgical casting that rotates
// these personas in the first place) even though Cathode never calls its
// draw path. Its section bookkeeping reads `particles.kind`, `fx`, and
// `celestial`, so those must be real values from the shared vocabulary --
// see BiomeProfiles.js -- rather than Cathode-only inventions.

/** Dramaturgical heat, 0..1: which persona a section's energy casts into.
 *  Ordered the way the eras escalate on screen, not by release date --
 *  a sparse amber terminal is the quiet end, four-color CGA the loud one. */
export const CATHODE_TEMPERATURE = {
  PHOSPHOR: 0.10,
  DMG: 0.30,
  BREADBIN: 0.55,
  APERTURE: 0.78,
  COMPOSITE: 0.95,
};

export const CATHODE_PALETTES = [
  {
    // A monochrome amber terminal: one hue, six steps, nothing else.
    name: 'PHOSPHOR',
    ramp: ['#0a0600', '#241500', '#5a3500', '#a86a00', '#ffb000', '#ffd980'],
    sky: ['#0a0600', '#241500', '#5a3500'],
    silhouette: '#0a0600',
    edgeLight: '#ffb000',
    celestial: { kind: 'moon', color: '#ffd980', radius: 20, haloColor: '#a86a00', veiled: true },
    particles: { kind: 'digitalrain', color: '#a86a00', count: 18, speed: 5 },
    fx: 'starTwinkle',
    terrainEnergy: 0.55,
  },
  {
    // The DMG's four greens, in the order the original LCD ordered them.
    name: 'DMG',
    ramp: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
    sky: ['#0f380f', '#306230', '#8bac0f'],
    silhouette: '#0f380f',
    edgeLight: '#9bbc0f',
    celestial: { kind: 'sun', color: '#9bbc0f', radius: 24, haloColor: '#8bac0f' },
    particles: { kind: 'fireflies', color: '#8bac0f', count: 20, speed: 6 },
    fx: 'starTwinkle',
    terrainEnergy: 0.7,
  },
  {
    // Commodore 64, all sixteen. The muted, slightly-dirty primaries are
    // the point: nothing here is fully saturated except the white.
    name: 'BREADBIN',
    ramp: [
      '#000000', '#333333', '#664400', '#0000aa',
      '#880000', '#777777', '#8b3f96', '#cc44cc',
      '#dd8855', '#0088ff', '#00cc55', '#ff7777',
      '#aaff66', '#bbbbbb', '#eeee77', '#ffffff',
    ],
    sky: ['#000000', '#0000aa', '#0088ff'],
    silhouette: '#000000',
    edgeLight: '#aaff66',
    celestial: { kind: 'moon', color: '#bbbbbb', radius: 26, haloColor: '#777777' },
    particles: { kind: 'digitalrain', color: '#00cc55', count: 24, speed: 7 },
    fx: 'neonGrid',
    terrainEnergy: 0.85,
  },
  {
    // NES-flavored: a working subset of the 2C02's usable entries, chosen
    // for spread rather than completeness (the full 54 includes a lot of
    // near-duplicate darks that never read on screen).
    name: 'APERTURE',
    ramp: [
      '#000000', '#3c3c3c', '#7c7c7c', '#bcbcbc',
      '#0000fc', '#0078f8', '#3cbcfc', '#a4e4fc',
      '#f83800', '#fc7460', '#f8b800', '#fcd8a8',
      '#00b800', '#b8f818', '#6844fc', '#fcfcfc',
    ],
    sky: ['#0000fc', '#0078f8', '#3cbcfc'],
    silhouette: '#000000',
    edgeLight: '#fcd8a8',
    celestial: { kind: 'sun', color: '#f8b800', radius: 32, haloColor: '#fc7460', dominant: true },
    particles: { kind: 'embers', color: '#fcd8a8', count: 28, speed: 8 },
    fx: 'glitchTear',
    terrainEnergy: 1.0,
  },
  {
    // CGA palette 1, high intensity -- black, cyan, magenta, white. Four
    // colors that no one chose for beauty and everyone remembers.
    name: 'COMPOSITE',
    ramp: ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
    sky: ['#000000', '#ff55ff', '#55ffff'],
    silhouette: '#000000',
    edgeLight: '#ffffff',
    celestial: { kind: 'sun', color: '#ffffff', radius: 36, haloColor: '#ff55ff', dominant: true },
    particles: { kind: 'flaresparks', color: '#55ffff', count: 30, speed: 10 },
    fx: 'glitchTear',
    terrainEnergy: 1.15,
  },
];

const BY_NAME = new Map(CATHODE_PALETTES.map((p) => [p.name, p]));

/** The persona a section's biome name casts into, or PHOSPHOR when the
 *  name belongs to another world (BiomeManager's very first frames, or a
 *  custom-world profile that leaked through). Never throws and never
 *  returns undefined -- the renderer reads `.ramp` off this every frame. */
export function personaFor(name) {
  return BY_NAME.get(name) || CATHODE_PALETTES[0];
}

/** Clamped ramp access. Drawing code indexes ramps with computed values
 *  (energy buckets, dither steps, sprite palette indices), so an index off
 *  either end must saturate to the nearest real color rather than paint
 *  `undefined` -- Canvas silently ignores an invalid fillStyle and leaves
 *  whatever was underneath, which reads as a hole in the frame. */
export function rampAt(ramp, i) {
  if (!ramp || ramp.length === 0) return '#000000';
  const idx = Math.max(0, Math.min(ramp.length - 1, Math.round(i)));
  return ramp[idx];
}
