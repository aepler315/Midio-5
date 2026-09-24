// The dancing ridge on the horizon, shaped like a real one.
//
// The horizon EQ (BiomeManager._drawHorizonEQ) is a luminous ridge whose
// height is the live 7-band spectrum. On its own that spectrum is a smooth
// hump with no geography in it. Here it gets a real crest to stand on: one
// of a short list of famous skylines in the lower 48 and southern British
// Columbia and Alberta (HORIZON_RANGES), taken from the same scanned
// profiles the parallax ridges draw.
//
// The crest is the ridge's resting shape; the music scales it. Height at
// any point is crest x (rest + (1 - rest) x band level), anchored at the
// foot, so a loud band lifts that stretch of the real ridge and a quiet one
// lowers it, and the outline -- the Grand Teton's spire, Rainier's dome --
// never stops reading as itself. Scaling a smooth crest by a smooth,
// time-smoothed band level keeps a steep face smooth as it drops: every
// point on the face moves in proportion, so the face shortens rather than
// breaking up.
//
// Across the song the view slides along the range, from one side of the
// summit to the other, so the summit is on screen for most of it. Pure
// math, no canvas: BiomeManager draws it, tests exercise it directly.
import { clamp01 } from '../../utils/math.js';
import { profileUnits } from './TerrainProfile.js';
import { seedTicket } from './RangeMatcher.js';
import { RANGES } from './ranges/index.js';

// Famous skylines only, and only south of about 52 degrees north: the
// lower 48, and British Columbia and Alberta's southern ranges. Ids from
// the range basket (ranges/index.js); each one's scanned far skyline is
// the crest. Chosen by eye as well as by name: a range whose scan is an
// even row of teeth (the Sawtooths, Glacier's Livingston Range, the
// Sangre de Cristos) reads as noise once it is stretched to the EQ's
// height, so those are left out.
export const HORIZON_RANGES = Object.freeze([
  'tetons', // Grand Teton
  'rainier', // Mount Rainier
  'sierra-whitney', // Mount Whitney
  'california-cascades', // Mount Shasta
  'oregon-cascades', // Mount Hood
  'skagit-range', // Mount Baker
  'north-cascades', // Glacier Peak
  'olympic-mountains', // the Olympics
  'front-range', // Pikes Peak
  'wasatch', // Lone Peak
  'white-mountains', // White Mountain Peak, the bristlecone range
  'san-jacinto-mountains', // San Jacinto Peak over Palm Springs
  'mission-mountains', // McDonald Peak
  'canadian-rockies', // Lake Louise
  'selkirk-mountains', // Rogers Pass
  'garibaldi-ranges', // Mount Garibaldi
  'waddington-range', // Mount Waddington
]);

// How much of the range is on screen at once, and how far the view slides
// along it over a whole song.
export const HORIZON_WINDOW_M = 28000;
export const HORIZON_TRAVEL_M = 8000;
// Crest sample spacing: coarser than the 30 m scan, box-averaged, so a
// distant ridge is not a saw of single-sample spikes.
export const HORIZON_STEP_M = 150;
// The lowest point in view never sits flat on the foot.
const CREST_FLOOR = 0.3;
// Share of the crest's height that stands at total silence.
export const HORIZON_REST = 0.4;

/** The song's horizon range: drawn evenly from HORIZON_RANGES, passing over
 *  `exclude` (ids already standing in the song's own ridges). Null when
 *  nothing is left. */
export function chooseHorizonRange(seed, { exclude = [], ranges = RANGES } = {}) {
  const skip = new Set(exclude);
  const open = ranges.filter((r) => HORIZON_RANGES.includes(r.id) && !skip.has(r.id));
  if (!open.length) return null;
  const i = Math.min(open.length - 1, Math.floor(seedTicket(seed, 307) * open.length));
  return open[i];
}

/**
 * The stretch of a skyline profile the song will see, as 0..1 heights every
 * `stepM`: `window` metres on screen at once plus `travel` metres slid over
 * the song, centred on the profile's summit and normalised to its own low
 * and high points. Throws on a profile TerrainProfile will not accept.
 */
export function horizonCrest(profile, {
  windowM = HORIZON_WINDOW_M, travelM = HORIZON_TRAVEL_M, stepM = HORIZON_STEP_M,
} = {}) {
  const units = profileUnits(profile);
  const n = units.length;
  const spacing = profile.spacingM;
  const lengthM = spacing * (n - 1);
  const window = Math.min(windowM, lengthM * 0.6);
  const travel = Math.max(0, Math.min(travelM, lengthM - window));
  const stretch = window + travel;
  let summit = 0;
  for (let i = 1; i < n; i++) if (units[i] > units[summit]) summit = i;
  const start = Math.max(0, Math.min(lengthM - stretch, summit * spacing - stretch / 2));
  const count = Math.max(2, Math.round(stretch / stepM) + 1);
  const step = stretch / (count - 1);
  const half = Math.max(0, Math.round(step / spacing / 2));
  const heights = new Float32Array(count);
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < count; k++) {
    const c = Math.round((start + k * step) / spacing);
    let sum = 0, m = 0;
    for (let j = Math.max(0, c - half); j <= Math.min(n - 1, c + half); j++) { sum += units[j]; m++; }
    const h = m ? sum / m : 0;
    heights[k] = h;
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  const span = hi - lo;
  for (let k = 0; k < count; k++) {
    heights[k] = CREST_FLOOR + (1 - CREST_FLOOR) * (span > 1e-9 ? (heights[k] - lo) / span : 0.5);
  }
  return { heights, stepM: step, windowM: window, travelM: travel };
}

/** Crest height (0..1) at `u` (0 left edge .. 1 right edge of the screen)
 *  when the song is `songP` (0..1) of the way through. */
export function crestHeightAt(crest, songP, u) {
  const { heights, stepM, windowM, travelM } = crest;
  const at = (clamp01(songP) * travelM + clamp01(u) * windowM) / stepM;
  const last = heights.length - 1;
  const i = Math.min(last - 1, Math.max(0, Math.floor(at)));
  const f = Math.min(1, Math.max(0, at - i));
  return heights[i] + (heights[i + 1] - heights[i]) * f;
}

/** The dancing height (0..1): the crest scaled by the band level `v`. */
export function horizonRidgeLift01(crest01, v) {
  return crest01 * (HORIZON_REST + (1 - HORIZON_REST) * clamp01(v));
}
