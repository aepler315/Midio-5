// BiomeImporter — derive a playable custom biome profile from a loaded MIDI
// timeline. Pure data out; BiomeManager registers the profile and casts the
// whole song into it so drag-and-drop MIDI becomes a unique world without
// touching the 9 stock biomes.
import { hashSeed } from '../utils/math.js';
import { Role } from '../core/NoteEvent.js';

const PARTICLE_KINDS = [
  'fireflies', 'embers', 'snow', 'pollen', 'antigrav',
  'petals', 'rain', 'flaresparks', 'digitalrain',
];

const FX_BY_TEMP = [
  [0.15, 'aurora'],
  [0.30, 'starTwinkle'],
  [0.45, 'petalPile'],
  [0.60, 'canopyDapple'],
  [0.75, 'heatShimmer'],
  [0.88, 'prominence'],
  [1.01, 'lightning'],
];

/** HSL → #rrggbb (components already in 0..360 / 0..100 / 0..100). */
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function pickFx(temp) {
  for (const [hi, fx] of FX_BY_TEMP) {
    if (temp < hi) return fx;
  }
  return 'starTwinkle';
}

/**
 * Build a BiomeProfiles-compatible object from a midiToTimeline() result.
 * Deterministic for the same MIDI content (same note set / duration).
 *
 * @param {{ timeline: Array, tracks?: Array, durationMs?: number, bpm?: number }} data
 * @param {string} [fileName]
 */
export function generateCustomBiomeFromMidi(data, fileName = 'MIDI') {
  const timeline = data.timeline || [];
  const durationMs = Math.max(1, data.durationMs || 1);
  const bpm = data.bpm || 120;

  let pitchSum = 0;
  let velSum = 0;
  let kickCount = 0;
  const roleCounts = { [Role.MELODY]: 0, [Role.HARMONY]: 0, [Role.BASS]: 0, [Role.RHYTHM]: 0 };
  const classHist = new Array(12).fill(0);

  for (const e of timeline) {
    pitchSum += e.pitch ?? 60;
    velSum += e.vel ?? 0.5;
    if (e.kick) kickCount++;
    if (e.role in roleCounts) roleCounts[e.role]++;
    classHist[(e.pitch ?? 60) % 12]++;
  }

  const n = Math.max(1, timeline.length);
  const meanPitch = pitchSum / n;
  const meanVel = velSum / n;
  const density = timeline.length / (durationMs / 1000); // notes/sec
  const kickRate = kickCount / (durationMs / 1000);

  // Dominant pitch class → hue (C=0 → cool violet, F#=6 → amber, …).
  let domClass = 0, domCount = -1;
  for (let i = 0; i < 12; i++) {
    if (classHist[i] > domCount) { domCount = classHist[i]; domClass = i; }
  }
  const hue = (domClass * 30 + meanPitch * 0.35) % 360;

  // Temperature 0..1 from density + velocity + kick drive (cold ballad → hot banger).
  const temp = Math.max(0, Math.min(1,
    0.25 * Math.min(1, density / 12)
    + 0.35 * meanVel
    + 0.25 * Math.min(1, kickRate / 3)
    + 0.15 * Math.min(1, (bpm - 60) / 120),
  ));

  const skyDark = hslToHex(hue, 55 + temp * 20, 4 + temp * 6);
  const skyMid = hslToHex(hue + 18, 50 + temp * 25, 14 + temp * 16);
  const skyHot = hslToHex(hue + 40, 60 + temp * 20, 45 + temp * 25);
  const sil = hslToHex(hue - 10, 40 + temp * 15, 8 + temp * 6);
  const halo = hslToHex(hue + 25, 70, 72 + temp * 12);
  const cel = hslToHex(hue + 30, 65 + temp * 20, 78);
  const particleColor = hslToHex(hue + 50, 75, 80);

  const melodyShare = roleCounts[Role.MELODY] / n;
  const rhythmShare = roleCounts[Role.RHYTHM] / n;
  let kind = PARTICLE_KINDS[Math.floor(temp * (PARTICLE_KINDS.length - 0.01))];
  if (melodyShare > 0.45) kind = temp > 0.5 ? 'petals' : 'fireflies';
  if (rhythmShare > 0.4) kind = temp > 0.55 ? 'digitalrain' : 'rain';
  if (roleCounts[Role.BASS] / n > 0.35) kind = temp > 0.5 ? 'embers' : 'antigrav';

  const count = Math.round(18 + temp * 50 + Math.min(20, density));
  const speed = Math.round(10 + temp * 120 + kickRate * 15);
  const isMoon = meanPitch < 58 || temp < 0.35;
  const radius = Math.round(32 + temp * 40 + (isMoon ? 8 : 0));

  const base = String(fileName || 'MIDI').replace(/\.(mid|midi)$/i, '').slice(0, 28) || 'MIDI';
  const seed = hashSeed(`${timeline.length}:${durationMs}:${domClass}:${Math.round(meanPitch * 10)}`);
  const name = `CUSTOM:${base}`.toUpperCase().replace(/[^A-Z0-9:_-]/g, '_').slice(0, 40);

  const profile = {
    name,
    id: `custom-${(seed >>> 0).toString(16)}`,
    sky: [skyDark, skyMid, skyHot],
    silhouette: sil,
    edgeLight: temp > 0.65 ? hslToHex(hue + 80, 90, 60) : undefined,
    celestial: {
      kind: isMoon ? 'moon' : 'sun',
      color: cel,
      radius,
      haloColor: halo,
      veiled: temp > 0.7 && kickRate > 1.5,
      ring: isMoon && melodyShare > 0.3,
      shafts: !isMoon && temp > 0.55,
    },
    particles: { kind, color: particleColor, count, speed },
    fx: pickFx(temp),
    // Metadata for HUD / tests (ignored by renderer).
    sourceFile: fileName,
    derived: {
      hue: Math.round(hue),
      temperature: Math.round(temp * 1000) / 1000,
      density: Math.round(density * 100) / 100,
      noteCount: timeline.length,
      dominantClass: domClass,
    },
  };

  return profile;
}

/**
 * Register a custom biome onto a live ParamBus history list (capped).
 * Does not affect the KEYS smoothing system.
 */
export function rememberCustomBiome(paramBus, profile, max = 12) {
  if (!paramBus || !profile) return;
  if (!Array.isArray(paramBus.customBiomes)) paramBus.customBiomes = [];
  paramBus.customBiomes = [
    profile,
    ...paramBus.customBiomes.filter((b) => b.id !== profile.id),
  ].slice(0, max);
}
