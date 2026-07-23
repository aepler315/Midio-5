// Biome profiles (spec §4.1.2) — pure data (Strategy pattern). Adding a
// ninth biome is one object literal, zero engine code. `particles` config
// feeds the generic ParticleField; `fx` names a small biome-specific
// canvas trick BiomeManager knows how to run. `terrainEnergy` (default 1)
// scales how sharply the shared ridge geometry reads for this biome --
// its geological-feature lift and mountain-dance amplitude -- without
// touching the underlying noise ridge itself (that stays one shared,
// seeded shape so BiomeManager's crossfade never has to blend geometry,
// only color/fx): calm biomes settle into gentler, rounder terrain, harsh
// ones read jagged and dramatic, purely through how hard the same shape
// gets pushed.
export const BIOMES = [
  {
    name: 'TWILIGHT',
    sky: ['#1a1a3e', '#4a3b6b', '#e8746a'],
    silhouette: '#2b2145',
    celestial: { kind: 'sun', color: '#ffb37a', radius: 46, haloColor: '#ffdca0' },
    particles: { kind: 'fireflies', color: '#fff2a8', count: 26, speed: 14 },
    fx: 'starTwinkle',
    terrainEnergy: 1.0,
  },
  {
    name: 'EMBER',
    sky: ['#2b0f0a', '#7a2413', '#ff9a3c'],
    silhouette: '#3d120b',
    celestial: { kind: 'sun', color: '#ff8a3c', radius: 50, haloColor: '#ffb37a', veiled: true },
    particles: { kind: 'embers', color: '#ff7a3c', count: 34, speed: 60 },
    fx: 'heatShimmer',
    terrainEnergy: 1.2,
  },
  {
    name: 'ARCTIC',
    sky: ['#0e2a44', '#3f6d9e', '#cfe8ff'],
    silhouette: '#12324f',
    celestial: { kind: 'sun', color: '#eaf6ff', radius: 34, haloColor: '#ffffff', ring: true, shape: { m: 6, n1: 1, n2: 1.8, n3: 1.8 } },
    particles: { kind: 'snow', color: '#ffffff', count: 60, speed: 45 },
    fx: 'aurora',
    terrainEnergy: 1.15,
  },
  {
    name: 'JADE',
    sky: ['#0c2b1c', '#1f6b46', '#a9e5b0'],
    silhouette: '#0f3a26',
    celestial: { kind: 'sun', color: '#eaffb0', radius: 40, haloColor: '#c8f2a0', shafts: true },
    particles: { kind: 'pollen', color: '#eaffb0', count: 40, speed: 8 },
    fx: 'canopyDapple',
    terrainEnergy: 0.75,
  },
  {
    name: 'VOID',
    sky: ['#05010d', '#1b0f33', '#4d2b8c'],
    silhouette: '#150a2e',
    celestial: { kind: 'moon', color: '#cabfff', radius: 38, haloColor: '#7a5bd8', shattered: true, shape: { m: 5, n1: 0.35, n2: 0.35, n3: 0.35 } },
    particles: { kind: 'antigrav', color: '#b79bff', count: 30, speed: 20 },
    fx: 'glitchTear',
    terrainEnergy: 1.3,
  },
  {
    name: 'SAKURA',
    sky: ['#2b1030', '#8a3a6b', '#ffd7e8'],
    silhouette: '#3a1642',
    celestial: { kind: 'moon', color: '#ffe9f2', radius: 62, haloColor: '#ffc9de', shape: { m: 5, n1: 3, n2: 6, n3: 6 } },
    particles: { kind: 'petals', color: '#ffb6d3', count: 46, speed: 35 },
    fx: 'petalPile',
    terrainEnergy: 0.8,
  },
  {
    name: 'SOLAR',
    sky: ['#3a1f00', '#c96a00', '#ffe08a'],
    silhouette: '#4a2600',
    celestial: { kind: 'sun', color: '#ffe08a', radius: 78, haloColor: '#ffb347', dominant: true, shape: { m: 8, n1: 0.9, n2: 1.5, n3: 1.5 } },
    particles: { kind: 'flaresparks', color: '#ffcf6b', count: 18, speed: 90 },
    fx: 'prominence',
    terrainEnergy: 1.25,
  },
  {
    name: 'STORM',
    sky: ['#0b0f1a', '#1f2937', '#3d4f66'],
    silhouette: '#0a1220',
    celestial: { kind: 'moon', color: '#b9c7dd', radius: 34, haloColor: '#8fa5c8', veiled: true },
    particles: { kind: 'rain', color: '#9fb8d8', count: 70, speed: 0 },
    fx: 'lightning',
    terrainEnergy: 1.35,
  },
  {
    name: 'MIRROR',
    sky: ['#0a1626', '#254a6b', '#bfe0ff'],
    silhouette: '#0f2438',
    celestial: { kind: 'moon', color: '#eaf6ff', radius: 44, haloColor: '#cfe8ff' },
    particles: { kind: 'fireflies', color: '#dff3ff', count: 18, speed: 6 },
    fx: 'lakeReflection',
    terrainEnergy: 0.7,
  },
  {
    name: 'CYBER',
    sky: ['#020814', '#062a3f', '#0b4b5e'],
    silhouette: '#04121f',
    edgeLight: '#00ffd0',
    celestial: { kind: 'sun', color: '#00ffd0', radius: 36, haloColor: '#00ffd0', wireframe: true },
    particles: { kind: 'digitalrain', color: '#00ffb0', count: 22, speed: 140 },
    fx: 'neonGrid',
    terrainEnergy: 1.1,
  },
];

export function biomeByName(name) {
  return BIOMES.find((b) => b.name === name) || BIOMES[0];
}
