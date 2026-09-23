// Which real mountain range a song plays against.
//
// The song and every range are placed on the same four axes
// (RangeCharacter.AXES) and the song gets a range near it. Works the same
// with one range in the basket or three hundred.
//
//   energy     song drive                    <-> ruggedness and peak density
//   rawness    percussive onsets and grit    <-> unweathered, irregular skyline
//   grandeur   dynamic range (the song's arc) <-> vertical relief
//   dominance  a standout climax (contrast)  <-> one commanding summit
//
// Key colours the emotional reading: a confident minor key leans toward the
// heavier archetypes, a major key toward the brighter ones.
//
// Spread. Matching raw scores sent every loud song to Denali: its relief
// scores 0.98 and nothing else comes close, so any big dynamic arc landed
// there. So the ranges are compared by RANK on each axis -- a range's score
// is where it stands in this basket, 0 lowest to 1 highest -- which spreads
// them evenly across the space a song can land in. Then the song chooses
// among its few nearest ranges by its seed, and skips the ranges this player
// saw most recently. Character still decides the neighbourhood; the seed and
// the history decide the house.
import { AXES, axisDistance } from './RangeCharacter.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// How many of the nearest ranges a song chooses among: about one in twelve
// of the basket (seven of eighty), at least one, at most eight.
export function choiceCount(n) {
  return Math.max(1, Math.min(8, Math.round(n / 12)));
}
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

const valid = (r) => r && r.scores && AXES.every((a) => Number.isFinite(r.scores[a]));
const rankCache = new WeakMap();
/** Each usable range's rank on each axis within `basket`, 0..1 (ties share
 *  the mean rank). One range alone sits at 0.5. Cached per basket array. */
export function rankScores(basket) {
  const hit = rankCache.get(basket);
  if (hit) return hit;
  const ranges = basket.filter(valid);
  const out = new Map(ranges.map((r) => [r, {}]));
  for (const axis of AXES) {
    const sorted = [...ranges].sort((a, b) => a.scores[axis] - b.scores[axis]);
    for (let i = 0; i < sorted.length;) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1].scores[axis] === sorted[i].scores[axis]) j++;
      const rank = sorted.length > 1 ? ((i + j) / 2) / (sorted.length - 1) : 0.5;
      for (let k = i; k <= j; k++) out.get(sorted[k])[axis] = rank;
      i = j + 1;
    }
  }
  rankCache.set(basket, out);
  return out;
}

/** Every range, nearest first, compared by rank. */
export function rankRanges(ranges, target, tonal = null) {
  const ranks = rankScores(ranges);
  return [...ranks.keys()]
    .map((range) => ({ range, distance: axisDistance(target, ranks.get(range)) - keyPull(range, tonal) }))
    .sort((a, b) => a.distance - b.distance || a.range.id.localeCompare(b.range.id));
}

/**
 * The range for this song, or null if the basket is empty. `seed` picks
 * among the nearest few; `recent` lists range ids this player saw lately,
 * newest first, which are passed over while anything else near is left.
 */
export function matchRange(ranges, profile, seed = 0, { recent = [] } = {}) {
  const target = songTerrainTarget(profile);
  const ranked = rankRanges(ranges, target, profile?.tonal);
  if (!ranked.length) return null;
  const k = choiceCount(ranked.length);
  const seen = new Set(recent);
  // The nearest k that are not recent; if the history covers all of them,
  // widen to 2k before giving up and allowing a repeat.
  let pool = ranked.slice(0, k).filter((r) => !seen.has(r.range.id));
  if (!pool.length) pool = ranked.slice(0, 2 * k).filter((r) => !seen.has(r.range.id)).slice(0, k);
  if (!pool.length) pool = ranked.slice(0, k);
  const pick = pool[(Math.abs(Math.trunc(seed)) >>> 0) % pool.length];
  return { range: pick.range, distance: pick.distance, target, ranked };
}
