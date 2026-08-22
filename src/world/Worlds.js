// Worlds: graphic styles the song can be played in.
//
// A biome is a palette that rotates inside a world. A world is the landform
// contract those palettes paint onto — alpine ranges vs a night city vs
// whatever comes next. The registry is the future-proof seam: add a world
// object, a silhouette profile, and a draw path, and the select screen
// plus the match scorer pick it up with no other wiring.
//
// Match % is NOT genre ("this is a city-pop song"). It is watchability:
// would this world's visual suite produce a show that sits in a sweet
// spot for THIS song — enough going on, not clipping into noise.
import { BIOMES } from './BiomeProfiles.js';
import { BIOME_TEMPERATURE, castBiomes } from './Dramaturgy.js';
import { CITY_PALETTES, CITY_TEMPERATURE } from './city/CityPalettes.js';

/** Channel `reads` keys are fields on the watch-features vector. */
const ALPINE_CHANNELS = [
  { id: 'orogeny', reads: 'arc', weight: 1.20 },
  { id: 'ridges', reads: 'form', weight: 1.10 },
  { id: 'biomes', reads: 'contrast', weight: 1.00 },
  { id: 'weather', reads: 'texture', weight: 0.70 },
  { id: 'celestial', reads: 'air', weight: 0.50 },
  { id: 'particles', reads: 'onset', weight: 0.60 },
];

const CITY_CHANNELS = [
  { id: 'skyline', reads: 'form', weight: 1.10 },
  { id: 'windows', reads: 'onset', weight: 1.20 },
  { id: 'neon', reads: 'air', weight: 0.85 },
  { id: 'rain', reads: 'texture', weight: 0.90 },
  { id: 'traffic', reads: 'groove', weight: 1.05 },
  { id: 'sodium', reads: 'warmth', weight: 0.70 },
];

export const WORLDS = [
  {
    id: 'alpine',
    name: 'The Range',
    tagline: 'Mountains that breathe with the mix.',
    kind: 'alpine',
    // The alpine suite can hold a bigger show before it clips: orogeny,
    // storms, biome cuts. Quiet songs leave it sitting still.
    comfort: { lo: 0.34, hi: 0.84 },
    channels: ALPINE_CHANNELS,
    prefer: {
      arc: [0.28, 0.90],
      onset: [0.10, 0.62],
      contrast: [0.22, 0.90],
      centroid: [0.28, 0.72],
    },
    palettes: BIOMES,
    temperature: BIOME_TEMPERATURE,
    cast: (energies, seed) => castBiomes(energies, seed, BIOME_TEMPERATURE),
  },
  {
    id: 'nocturne',
    name: 'After Hours',
    tagline: 'A city that glows with the groove.',
    kind: 'city',
    // Intimate suite: windows, neon, rain, sodium. Saturates sooner —
    // a wall of sound strobes every window. A mid-tempo warm mix lives here.
    comfort: { lo: 0.20, hi: 0.64 },
    channels: CITY_CHANNELS,
    prefer: {
      arc: [0.10, 0.55],
      onset: [0.12, 0.48],
      groove: [0.35, 0.85],
      warmth: [0.40, 0.90],
      centroid: [0.16, 0.52],
    },
    palettes: CITY_PALETTES,
    temperature: CITY_TEMPERATURE,
    cast: (energies, seed) => castBiomes(energies, seed, CITY_TEMPERATURE),
  },
];

const BY_ID = new Map(WORLDS.map((w) => [w.id, w]));

export function getWorld(id) {
  return BY_ID.get(id) || WORLDS[0];
}

export function listWorlds() {
  return WORLDS;
}

export const DEFAULT_WORLD_ID = WORLDS[0].id;
