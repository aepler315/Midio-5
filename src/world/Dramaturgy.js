// The Dramaturgy Director: the difference between a stack of effects and
// a staged show. Four pure functions BiomeManager consumes --
//   castBiomes:        sections get biomes matched to their energy, the
//                      way a director casts scenes (calm -> ARCTIC/SAKURA,
//                      hot -> EMBER/SOLAR), never the same biome twice
//                      in a row
//   classifyTransition: boundary sharpness (novelty at the cut) picks the
//                      transition style -- gentle FADE, one-bar SHUTTER
//                      wipe, or a hard CUT with a flash on the beat
//   intensityBudget:   a global gain staging the show -- the intro holds
//                      the phenomena layer back so the finale has
//                      somewhere to go
//   dayArc:            one sun-arc across the whole song: dawn tint at
//                      the start, zenith mid-song, dusk into the finale.
import { clamp01, smoothstep, mulberry32 } from '../utils/math.js';

// Where each biome sits on the cold-to-hot axis.
export const BIOME_TEMPERATURE = {
  ARCTIC: 0.05, SAKURA: 0.20, TWILIGHT: 0.32, VOID: 0.45,
  JADE: 0.55, CYBER: 0.70, EMBER: 0.85, SOLAR: 0.95,
};

/**
 * Assign biomes to sections by matching biome temperature to the
 * section's energy percentile rank. Seeded jitter keeps different songs
 * from casting identically; immediate repeats are forbidden.
 */
export function castBiomes(sectionEnergies, seed = 1) {
  const n = sectionEnergies.length;
  if (n === 0) return [];
  const rand = mulberry32(seed >>> 0 || 1);
  const names = Object.keys(BIOME_TEMPERATURE);

  // Percentile rank of each section's energy (ties broken by index).
  const order = sectionEnergies.map((e, i) => [e, i]).sort((a, b) => a[0] - b[0]);
  const rank = new Array(n);
  order.forEach(([, idx], pos) => { rank[idx] = n === 1 ? 0.5 : pos / (n - 1); });

  const out = [];
  for (let i = 0; i < n; i++) {
    let best = null, bestScore = Infinity;
    for (const name of names) {
      if (out[i - 1] === name) continue; // no immediate repeats
      const score = Math.abs(BIOME_TEMPERATURE[name] - rank[i]) + rand() * 0.15;
      if (score < bestScore) { bestScore = score; best = name; }
    }
    out.push(best);
  }
  return out;
}

/** Boundary sharpness -> transition style. */
export function classifyTransition(novelty, maxNovelty) {
  if (!(maxNovelty > 1e-9)) return 'fade';
  const s = novelty / maxNovelty;
  return s > 0.66 ? 'cut' : s > 0.33 ? 'shutter' : 'fade';
}

/**
 * Global phenomena gain across the song: restrained intro ramping over
 * the first ~22% of the song, full by the middle, a final push past 85%.
 * Always within [0.35, 1].
 */
export function intensityBudget(progress) {
  const p = clamp01(progress);
  const ramp = 0.45 + 0.55 * smoothstep(0, 0.22, p);
  return Math.min(1, ramp * (1 + 0.08 * smoothstep(0.85, 1, p)));
}

/**
 * The song-long sun arc. Returns the celestial's vertical position
 * (fraction of canvas height) plus dawn/dusk tint overlays.
 */
export function dayArc(progress) {
  const p = clamp01(progress);
  return {
    celestialYFrac: 0.28 - 0.13 * Math.sin(Math.PI * p), // low at dawn/dusk, high at zenith
    dawn: { color: '#ff9a6b', alpha: 0.14 * (1 - smoothstep(0, 0.18, p)) },
    dusk: { color: '#141040', alpha: 0.20 * smoothstep(0.78, 1, p) },
  };
}
