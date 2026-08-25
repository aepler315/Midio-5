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
import { FARSIDE_PALETTES, FARSIDE_TEMPERATURE } from './farside/FarsidePalettes.js';
import { FATHOM_PALETTES, FATHOM_TEMPERATURE } from './fathom/FathomPalettes.js';
import { REDLINE_PALETTES, REDLINE_TEMPERATURE } from './redline/RedlinePalettes.js';
import { FOUNDRY_PALETTES, FOUNDRY_TEMPERATURE } from './foundry/FoundryPalettes.js';
import { UNDERSTORY_PALETTES, UNDERSTORY_TEMPERATURE } from './understory/UnderstoryPalettes.js';
import { NAVE_PALETTES, NAVE_TEMPERATURE } from './nave/NavePalettes.js';

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

const FARSIDE_CHANNELS = [
  { id: 'limb', reads: 'form', weight: 0.90 },
  { id: 'primary', reads: 'air', weight: 1.25 },
  { id: 'stars', reads: 'spread', weight: 1.05 },
  { id: 'terminator', reads: 'contrast', weight: 0.85 },
  { id: 'regolith', reads: 'onset', weight: 0.40 },
  { id: 'libration', reads: 'phrase', weight: 0.70 },
];

const FATHOM_CHANNELS = [
  { id: 'caustics', reads: 'phrase', weight: 1.20 },
  { id: 'column', reads: 'warmth', weight: 1.10 },
  { id: 'descent', reads: 'arc', weight: 0.80 },
  { id: 'snow', reads: 'texture', weight: 0.95 },
  { id: 'life', reads: 'form', weight: 0.70 },
  { id: 'vents', reads: 'onset', weight: 0.45 },
];

const REDLINE_CHANNELS = [
  { id: 'grid', reads: 'tempoHeat', weight: 1.40 },
  { id: 'gantry', reads: 'groove', weight: 1.20 },
  { id: 'signs', reads: 'onset', weight: 1.00 },
  { id: 'horizon', reads: 'centroid', weight: 0.80 },
  { id: 'sun', reads: 'energyMean', weight: 0.65 },
  { id: 'tunnel', reads: 'contrast', weight: 0.75 },
];

const FOUNDRY_CHANNELS = [
  { id: 'pour', reads: 'energyMean', weight: 1.30 },
  { id: 'hammers', reads: 'onset', weight: 1.35 },
  { id: 'stacks', reads: 'form', weight: 0.85 },
  { id: 'gantry', reads: 'bass', weight: 1.00 },
  { id: 'sparks', reads: 'dyn', weight: 0.95 },
  { id: 'steam', reads: 'texture', weight: 0.60 },
];

const UNDERSTORY_CHANNELS = [
  { id: 'growth', reads: 'arc', weight: 1.00 },
  { id: 'canopy', reads: 'texture', weight: 1.30 },
  { id: 'shafts', reads: 'air', weight: 0.90 },
  { id: 'fabric', reads: 'spread', weight: 1.10 },
  { id: 'species', reads: 'contrast', weight: 0.55 },
  { id: 'motes', reads: 'onset', weight: 0.60 },
];

const NAVE_CHANNELS = [
  { id: 'bays', reads: 'phrase', weight: 1.15 },
  { id: 'vault', reads: 'form', weight: 1.25 },
  { id: 'glass', reads: 'contrast', weight: 1.30 },
  { id: 'organ', reads: 'bass', weight: 0.85 },
  { id: 'shafts', reads: 'air', weight: 0.70 },
  { id: 'censer', reads: 'onset', weight: 0.50 },
];

export const WORLDS = [
  {
    id: 'alpine',
    name: 'The Range',
    tagline: 'Mountains that breathe with the mix.',
    kind: 'alpine',
    comfort: { lo: 0.34, hi: 0.84 },
    channels: ALPINE_CHANNELS,
    prefer: {
      arc: [0.28, 0.90],
      onset: [0.10, 0.62],
      contrast: [0.22, 0.90],
      centroid: [0.28, 0.72],
    },
    affinity: { arc: 0.40, contrast: 0.25, tempoHeat: 0.35 },
    palettes: BIOMES,
    temperature: BIOME_TEMPERATURE,
    cast: (energies, seed) => castBiomes(energies, seed, BIOME_TEMPERATURE),
  },
  {
    id: 'nocturne',
    name: 'After Hours',
    tagline: 'A city that glows with the groove.',
    kind: 'city',
    comfort: { lo: 0.20, hi: 0.64 },
    channels: CITY_CHANNELS,
    prefer: {
      arc: [0.10, 0.55],
      onset: [0.12, 0.48],
      groove: [0.35, 0.85],
      warmth: [0.40, 0.90],
      centroid: [0.16, 0.52],
    },
    affinity: { groove: 0.42, warmth: 0.38, centroidInv: 0.20 },
    palettes: CITY_PALETTES,
    temperature: CITY_TEMPERATURE,
    cast: (energies, seed) => castBiomes(energies, seed, CITY_TEMPERATURE),
  },
  {
    id: 'farside',
    name: 'Far Side',
    tagline: 'No air. Nothing softens.',
    kind: 'airless',
    aerial: false,
    comfort: { lo: 0.02, hi: 0.30 },
    channels: FARSIDE_CHANNELS,
    prefer: {
      air: [0.22, 0.95],
      centroid: [0.45, 0.98],
      warmth: [0.02, 0.45],
      onset: [0.00, 0.26],
      spread: [0.35, 0.95],
    },
    affinity: { air: 0.32, centroid: 0.24, spread: 0.22, warmthInv: 0.22 },
    palettes: FARSIDE_PALETTES,
    temperature: FARSIDE_TEMPERATURE,
    cast: (energies, seed) => castBiomes(energies, seed, FARSIDE_TEMPERATURE),
  },
  {
    id: 'fathom',
    name: 'The Fathom',
    tagline: 'Everything down here is slow on purpose.',
    kind: 'abyssal',
    comfort: { lo: 0.04, hi: 0.38 },
    channels: FATHOM_CHANNELS,
    prefer: {
      onset: [0.02, 0.30],
      warmth: [0.45, 0.95],
      centroid: [0.08, 0.42],
      phrase: [0.30, 0.95],
      arc: [0.08, 0.55],
    },
    affinity: { warmth: 0.34, phrase: 0.26, onsetInv: 0.24, bass: 0.16 },
    palettes: FATHOM_PALETTES,
    temperature: FATHOM_TEMPERATURE,
    cast: (energies, seed) => castBiomes(energies, seed, FATHOM_TEMPERATURE),
  },
  {
    id: 'redline',
    name: 'Redline',
    tagline: 'A road that only exists at speed.',
    kind: 'strip',
    comfort: { lo: 0.48, hi: 0.90 },
    channels: REDLINE_CHANNELS,
    prefer: {
      tempoHeat: [0.45, 1.00],
      groove: [0.30, 0.95],
      centroid: [0.40, 0.92],
      onset: [0.28, 0.85],
      arc: [0.10, 0.65],
    },
    affinity: { tempoHeat: 0.40, groove: 0.28, centroid: 0.20, onset: 0.12 },
    palettes: REDLINE_PALETTES,
    temperature: REDLINE_TEMPERATURE,
    cast: (energies, seed) => castBiomes(energies, seed, REDLINE_TEMPERATURE),
  },
  {
    id: 'foundry',
    name: 'The Foundry',
    tagline: 'It only stops when the song does.',
    kind: 'foundry',
    comfort: { lo: 0.62, hi: 0.99 },
    channels: FOUNDRY_CHANNELS,
    prefer: {
      onset: [0.45, 1.00],
      energyMean: [0.50, 1.00],
      dyn: [0.30, 0.95],
      tempoHeat: [0.35, 1.00],
      warmth: [0.30, 0.90],
    },
    affinity: { onset: 0.32, energyMean: 0.30, dyn: 0.20, tempoHeat: 0.18 },
    palettes: FOUNDRY_PALETTES,
    temperature: FOUNDRY_TEMPERATURE,
    cast: (energies, seed) => castBiomes(energies, seed, FOUNDRY_TEMPERATURE),
  },
  {
    id: 'understory',
    name: 'Understory',
    tagline: 'Nothing is built. Everything grows.',
    kind: 'overgrowth',
    comfort: { lo: 0.14, hi: 0.52 },
    channels: UNDERSTORY_CHANNELS,
    prefer: {
      texture: [0.40, 0.98],
      spread: [0.42, 0.95],
      contrast: [0.02, 0.48],
      onset: [0.05, 0.45],
      centroid: [0.30, 0.78],
    },
    affinity: { texture: 0.36, spread: 0.26, air: 0.20, contrastInv: 0.18 },
    palettes: UNDERSTORY_PALETTES,
    temperature: UNDERSTORY_TEMPERATURE,
    cast: (energies, seed) => castBiomes(energies, seed, UNDERSTORY_TEMPERATURE),
  },
  {
    id: 'nave',
    name: 'The Nave',
    tagline: 'Architecture that rebuilds itself every chorus.',
    kind: 'nave',
    comfort: { lo: 0.30, hi: 0.72 },
    channels: NAVE_CHANNELS,
    prefer: {
      contrast: [0.45, 0.98],
      form: [0.35, 0.95],
      phrase: [0.40, 0.98],
      arc: [0.25, 0.80],
      centroid: [0.25, 0.75],
    },
    affinity: { contrast: 0.34, form: 0.28, phrase: 0.24, arc: 0.14 },
    palettes: NAVE_PALETTES,
    temperature: NAVE_TEMPERATURE,
    cast: (energies, seed) => castBiomes(energies, seed, NAVE_TEMPERATURE),
  },
];

const BY_ID = new Map(WORLDS.map((w) => [w.id, w]));

let _custom = null;

export function getWorld(id) {
  if (_custom && _custom.id === id) return _custom;
  return BY_ID.get(id) || WORLDS[0];
}

export function listWorlds() {
  return WORLDS;
}

export function setCustomWorld(world) {
  _custom = world;
}

export function clearCustomWorld() {
  _custom = null;
}

export const DEFAULT_WORLD_ID = WORLDS[0].id;
