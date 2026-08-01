// Pure math for the L4 crest: a smooth (seam-free) continuation of
// SilhouetteGenerator's noise ridge, plus a seeded set of geological
// features (cliffs, aretes, knobs, outcrops, terraces) whose height is
// driven by the 7-band spectrum -- the "geological equalizer". No canvas
// here; BiomeManager consumes these, tests exercise them directly.
import { clamp01, mulberry32 } from '../utils/math.js';
import { danceOffset, DANCE_COL_W } from './MountainChoreo.js';

/** Smooth (cosine-interpolated) counterpart of SilhouetteGenerator's
 *  ridgeYAt -- that one rounds to the nearest sample (a visible step at
 *  8x zoom); this one blends between neighbors so the crest we stroke
 *  live never steps even though the baked ridge polygon still does.
 *  Wraps at the sample array's end (the noise tail is already blended
 *  back to the head -- SilhouetteGenerator.js -- so the wrap is seamless). */
export function ridgeYSmooth(ridge, x) {
  if (!ridge) return 0;
  const { heights, step, baseline, amplitude, height } = ridge;
  const n = heights.length;
  const fi = x / step;
  const i0 = ((Math.floor(fi) % n) + n) % n;
  const i1 = (i0 + 1) % n;
  const f = fi - Math.floor(fi);
  const c = (1 - Math.cos(f * Math.PI)) / 2;
  const hVal = heights[i0] * (1 - c) + heights[i1] * c;
  return height * baseline - hVal * height * amplitude;
}

/** Smooth counterpart of MountainChoreo's danceOffset -- _drawDancingStrip
 *  blits the strip in DANCE_COL_W column slices, each evaluated at its own
 *  offset, so the columns' own centers are the ground truth. Cosine-blend
 *  between the two neighboring column centers: exactly equal to each
 *  column's own offset at that column's center, continuous everywhere
 *  (including across every 128px seam), never re-introducing the tear. */
export function danceOffsetSmooth(stripX, tSec, groove, kick, cfg, fever = 0) {
  // c0 = the column center at or before stripX; c1 = the next one. f=0 at
  // c0, f=1 at c1, so the blend reproduces each column's own offset exactly
  // at that column's own center (the ground truth _drawDancingStrip paints).
  const c0 = Math.floor((stripX - DANCE_COL_W / 2) / DANCE_COL_W) * DANCE_COL_W + DANCE_COL_W / 2;
  const c1 = c0 + DANCE_COL_W;
  const f = (stripX - c0) / DANCE_COL_W;
  const w = (1 - Math.cos(clamp01(f) * Math.PI)) / 2;
  const o0 = danceOffset(c0, tSec, groove, kick, cfg, fever);
  const o1 = danceOffset(c1, tSec, groove, kick, cfg, fever);
  return o0 * (1 - w) + o1 * w;
}

export const GEO_FEATURE_TYPES = ['cliff', 'arete', 'knob', 'outcrop', 'terrace'];
export const GEO_MAX_LIFT_PX = 46;

/** Seeded one-time assignment of the 7 bands to geological archetypes,
 *  each pinned to a jittered strip-space slot. Deterministic per seed --
 *  the same song always grows the same mountain. */
export function assignBandFeatures(seed) {
  const rand = mulberry32(seed);
  const order = [0, 1, 2, 3, 4, 5, 6];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((band, slot) => ({
    band,
    type: GEO_FEATURE_TYPES[Math.floor(rand() * GEO_FEATURE_TYPES.length)],
    u0: (((slot + 0.5) / 7 + (rand() - 0.5) * 0.08) % 1 + 1) % 1,
    halfWidth: 0.03 + rand() * 0.04,
  }));
}

/** Unit-height (0..1) profile of a geological archetype over local
 *  coordinate s in [-1, 1] (0 = feature center), with a slow, small
 *  breathing term so features are alive without wobbling like the
 *  music-synced ranges around them. */
export function featureShape(type, s, tSec = 0) {
  const breathe = 1 + 0.05 * Math.sin(tSec * 0.35 + s * 3);
  const as = Math.max(-1, Math.min(1, s));
  let v;
  switch (type) {
    case 'cliff': {
      // Flat bench, then a sharp near-vertical drop.
      if (as < 0.15) v = 1;
      else if (as > 0.35) v = 0;
      else v = 1 - (as - 0.15) / 0.20;
      break;
    }
    case 'arete': {
      v = Math.pow(Math.max(0, 1 - Math.abs(as)), 0.7);
      break;
    }
    case 'knob': {
      v = 0.5 + 0.5 * Math.cos(Math.PI * as);
      break;
    }
    case 'outcrop': {
      const dome = 0.5 + 0.5 * Math.cos(Math.PI * as);
      const notch = Math.exp(-Math.pow((as - 0.3) / 0.10, 2)) * 0.45;
      v = Math.max(0, dome - notch);
      break;
    }
    case 'terrace': {
      const dome = Math.max(0, 1 - Math.abs(as));
      v = Math.round(dome * 4) / 4;
      break;
    }
    default:
      v = 0;
  }
  return clamp01(v * breathe);
}

/** Wrapped signed distance from u to u0 in a periodic [0,1) space -- the
 *  shortest way around, so a feature straddling the u=0/1 seam still
 *  contributes correctly from both sides. */
function wrapDelta(u, u0) {
  let d = u - u0;
  d -= Math.round(d);
  return d;
}

/** Extra lift (px, >= 0) at strip position u01 in [0,1): the sum of every
 *  feature whose window covers u01, each scaled by its own band's live
 *  level. Zero between features -- the plain noise ridge shows through.
 *  Linear/angular interpolation only (no cosine ease): this is the
 *  opposite silhouette vocabulary from the horizon EQ's smooth aurora,
 *  by design (three equalizers, three different bodies of language). */
export function geoCrestOffset(u01, bands, features, tSec = 0) {
  let lift = 0;
  for (const f of features) {
    const d = wrapDelta(u01, f.u0);
    if (Math.abs(d) > f.halfWidth) continue;
    const s = d / f.halfWidth;
    const level = clamp01(bands ? bands[f.band] ?? 0 : 0);
    lift += GEO_MAX_LIFT_PX * level * featureShape(f.type, s, tSec);
  }
  return Math.min(GEO_MAX_LIFT_PX * 1.001, lift);
}
