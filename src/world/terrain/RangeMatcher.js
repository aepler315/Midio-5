// Which real mountain range a song plays against.
//
// The song and every range are placed on the same four axes
// (RangeCharacter.AXES) and the song gets its nearest range. Works the same
// with one range in the basket or three hundred: with one, that one wins;
// with many, the choice only gets finer.
//
//   energy     song drive                    <-> ruggedness and peak density
//   rawness    percussive onsets and grit    <-> unweathered, irregular skyline
//   grandeur   dynamic range (the song's arc) <-> vertical relief
//   dominance  a standout climax (contrast)  <-> one commanding summit
//
// Key colours the emotional reading: a confident minor key leans toward the
// heavier archetypes, a major key toward the brighter ones.
import { AXES, axisDistance } from './RangeCharacter.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Ranges within this distance of the best are treated as equally good, and
// the song's seed chooses among them -- so similar songs spread across
// similar ranges instead of every one of them landing on the same one, and
// a given song still always gets the same range.
export const NEAR_TIE = 0.04;
// How much a key-matched archetype is preferred, as distance taken off.
const MODE_PULL = 0.05;
const MINOR_ARCHETYPES = new Set(['brooding', 'sublime', 'wild', 'restless']);
const MAJOR_ARCHETYPES = new Set(['majestic', 'serene', 'defiant']);

/** Where a song sits on the range axes, from its SongProfile. */
export function songTerrainTarget(profile) {
  const w = profile?.watch || {};
  const num = (v, d = 0.5) => (Number.isFinite(v) ? v : d);
  return {
    energy: clamp01(num(w.drive)),
    rawness: clamp01(0.55 * num(w.onset) + 0.45 * num(w.texture)),
    grandeur: clamp01(num(w.arc)),
    dominance: clamp01(num(w.contrast)),
  };
}

function keyPull(range, tonal) {
  if (!tonal?.mode || !(tonal.confidence >= 0.3)) return 0;
  const favoured = tonal.mode === 'minor' ? MINOR_ARCHETYPES : MAJOR_ARCHETYPES;
  return favoured.has(range.archetype) ? MODE_PULL : 0;
}

/** Every range, nearest first. */
export function rankRanges(ranges, target, tonal = null) {
  return ranges
    .filter((r) => r && r.scores && AXES.every((a) => Number.isFinite(r.scores[a])))
    .map((range) => ({ range, distance: axisDistance(target, range.scores) - keyPull(range, tonal) }))
    .sort((a, b) => a.distance - b.distance || a.range.id.localeCompare(b.range.id));
}

/** The range for this song. `seed` picks among near-ties. Null if the
 *  basket is empty. */
export function matchRange(ranges, profile, seed = 0) {
  const target = songTerrainTarget(profile);
  const ranked = rankRanges(ranges, target, profile?.tonal);
  if (!ranked.length) return null;
  const ties = ranked.filter((r) => r.distance <= ranked[0].distance + NEAR_TIE);
  const pick = ties[(Math.abs(Math.trunc(seed)) >>> 0) % ties.length];
  return { range: pick.range, distance: pick.distance, target, ranked };
}
