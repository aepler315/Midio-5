// The SHAPE of a mountain, as distinct from where its summits come from
// (that's RidgePortrait's job -- the song picks the summits; this file
// decides what a summit actually looks like and how a range hangs
// together).
//
// What was wrong with the previous model: a range was a set of INDEPENDENT
// parametric bumps, each `max`ed against a low noise floor. Three
// consequences, all visible the moment you render the height field:
//
//   1. The flanks came out straight. The old peakProfile blended a dome
//      term (exponent < 1, flat-topped) with a spire term (exponent 3) at
//      an 80/20 mix, and those two average into a near-perfect isoceles
//      triangle. A row of triangles reads as bunting, not as mountains.
//   2. Wherever no summit stood, the field fell to the noise floor, so a
//      large fraction of every tile was dead flat ground -- and the strip
//      TILES, so that dead stretch scrolls past on repeat.
//   3. Saddles collapsed to the floor between neighbours, so summits read
//      as separate cones standing on a plain rather than as high points on
//      one connected crest.
//
// The model here is the other way around: a range is a CREST SPINE that
// runs unbroken across the whole tile, and summits are elevations OF that
// spine. Detail is anchored to relief (how far above the valley floor we
// already are) instead of sprayed uniformly, so valleys stay calm and
// crests carry the texture -- which is both what real terrain does and
// what stops the noise from inventing summits that compete with the ones
// the song actually chose.
//
// Pure, DOM-free, deterministic -- tests exercise every function directly.
import { clamp, clamp01, lerp } from '../utils/math.js';

/**
 * One side of a summit: height 0..1 at normalized flank distance `d`
 * (0 at the summit, 1 at the foot).
 *
 * A superellipse quarter, which gives a single intuitive knob for the one
 * thing that actually distinguishes mountain silhouettes from tents:
 *
 *   q < 1  concave/pinched sides  -- a horn (Matterhorn, Grand Teton)
 *   q = 1  a straight triangle    -- what the old code was accidentally making
 *   q > 1  convex/bulging sides   -- a shield or dome
 *
 * Real alpine summits sit just below 1: crisp near the top, easing as they
 * go down, with the broad connective mass supplied separately by the apron
 * (see apronMass) rather than by fattening the summit itself. Keeping those
 * two jobs in separate terms is what lets a range be both sharply-peaked
 * AND properly joined up, which a single blended profile could not do.
 */
export function flankProfile(d, q) {
  const t = clamp01(d);
  if (t >= 1) return 0;
  if (t <= 0) return 1;
  const qq = Math.max(0.2, q);
  return Math.pow(1 - Math.pow(t, qq), 1 / qq);
}

// A summit's steep side is narrower AND more pinched than its shallow side.
// Real ranges get this from asymmetric erosion -- a glacial cirque bites a
// steep headwall on one flank while the other keeps a long dip slope -- and
// because the ice came from a prevailing direction, neighbouring summits
// mostly lean the SAME way. That regional consistency is a much stronger
// realism cue than per-peak randomness, which just reads as noise.
// Neither side may sit near q=1: that is exactly the straight-sided
// triangle this rewrite exists to get rid of. The steep side is pinched
// (concave, a cirque headwall), the shallow side bulges (convex, a long
// dip slope running out to the valley) -- so the two flanks of one summit
// are visibly different CURVES, not just different widths.
export const FLANK_Q_STEEP = 0.55;
export const FLANK_Q_SHALLOW = 1.35;
export const STEEP_WIDTH_MUL = 0.66;
export const SHALLOW_WIDTH_MUL = 1.42;

/**
 * The two flank curvatures a character (and therefore a song, through
 * ShapeGrammar's terrain mods) implies.
 *
 * This is where the song's spike-vs-organic bias reaches the actual
 * silhouette. The old model spent `shoulder`/`spire`/`spireMix` on
 * peakProfile's power blend; this model spends them on the superellipse
 * exponents instead, so a spiky song still gets genuinely needle-like
 * summits and an organic one still gets broad convex ones. Both returned
 * values deliberately stay clear of q=1 across the whole input range --
 * q=1 is the straight-sided triangle, which is the shape this rewrite
 * exists to eliminate.
 */
export function flankQs(cfg, litho = null, songMix = 0) {
  const shoulder = cfg?.shoulder ?? 0.66;
  const spire = cfg?.spire ?? 2.6;
  const spireMix = cfg?.spireMix ?? 0.2;
  let spiky = clamp01(
    0.25
    + spireMix * 1.6
    + ((spire - 1.6) / 2.6) * 0.35
    - ((shoulder - 0.35) / 0.95) * 0.45,
  );
  // The song's own spectral mass shapes the cross-section too, blended in
  // at the layer's profileMix (L3, the timbre layer, leans hardest). This
  // is the link the old field ran through massProfile's three-term flank:
  // a tip-heavy (airy/bright) mix pinches the summit into a horn, a
  // foot-heavy (bass) one carries its bulk high and broad. Dropping it
  // when the flank model changed would have quietly cost the ranges one of
  // the two things that actually made them the SONG's mountains.
  if (litho && songMix > 0) {
    const tip = litho.tip ?? 0.3;
    const foot = litho.foot ?? 0.35;
    const songSpiky = clamp01(0.5 + (tip - foot) * 1.35);
    spiky = lerp(spiky, songSpiky, clamp01(songMix));
  }
  return {
    steep: lerp(0.85, FLANK_Q_STEEP - 0.13, spiky),
    shallow: lerp(1.85, FLANK_Q_SHALLOW - 0.30, spiky),
  };
}

/**
 * Height contributed by one summit at signed distance `dx` from its apex.
 * `dip` (-1 or +1) is the range's prevailing steep direction; a summit
 * whose own `flip` disagrees with it reverses -- a handful of those per
 * range keeps the run from looking stamped, without losing the regional
 * grain.
 */
export function summitMass(dx, peak, dip = 1, qs = null) {
  const steepIsLeft = (peak.flip ? -dip : dip) > 0;
  const onLeft = dx < 0;
  const steepSide = onLeft === steepIsLeft;
  const halfWidth = Math.max(8, peak.w * (steepSide ? STEEP_WIDTH_MUL : SHALLOW_WIDTH_MUL));
  const d = Math.abs(dx) / halfWidth;
  if (d >= 1) return 0;
  const q = steepSide
    ? (qs?.steep ?? FLANK_Q_STEEP)
    : (qs?.shallow ?? FLANK_Q_SHALLOW);
  return flankProfile(d, q) * peak.h;
}

/**
 * The connective mass around a summit's foot -- the thing that makes a
 * RANGE instead of a row of cones. Wide, low, and additive across
 * neighbours so overlapping feet pile into genuine high saddles; capped by
 * the caller so a crowded stretch never fills flat to summit height.
 */
export function apronMass(dx, peak, spread) {
  const reach = Math.max(8, peak.w * Math.max(1, spread));
  const d = Math.abs(dx) / reach;
  if (d >= 1) return 0;
  // Squared falloff: stays high near the foot (building the saddle) then
  // releases quickly, so aprons join NEIGHBOURS without flooding the
  // whole tile into a plateau.
  const t = 1 - d;
  return t * t * peak.h;
}

/**
 * Circular box blur -- the strip TILES, so the wrap has to be seamless or
 * the massing envelope below would put a discontinuity at the tile seam.
 * Iterated boxes approximate a gaussian at a fraction of the cost.
 */
export function blurWrap(src, radius, passes = 2) {
  const n = src.length;
  if (n === 0 || radius < 1) return Float32Array.from(src);
  let a = Float32Array.from(src);
  let b = new Float32Array(n);
  const w = radius * 2 + 1;
  for (let p = 0; p < passes; p++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += a[((k % n) + n) % n];
    for (let i = 0; i < n; i++) {
      b[i] = acc / w;
      acc -= a[(((i - radius) % n) + n) % n];
      acc += a[(((i + radius + 1) % n) + n) % n];
    }
    const t = a; a = b; b = t;
  }
  return a;
}

/**
 * The range's own massing envelope: a heavily blurred copy of the summit
 * field. This is what makes the crest a RANGE rather than a shelf.
 *
 * The first attempt at this file drove the spine from independent
 * low-frequency noise, which produced a dead-flat table with summits
 * spiking out of it -- swapping one wrong read ("cones on a plain") for
 * another ("spikes on a table"). A real massif is the AGGREGATE of its
 * summits: the ground swells under a cluster of peaks and subsides between
 * clusters, so foothills descend out of the high country instead of the
 * high country sitting on a plinth. Deriving the envelope from the summits
 * themselves gets that for free, and it keeps the song's own composition
 * (which summits, where) in charge of the range's large-scale shape.
 *
 * `floorH` keeps the crest alive across gaps -- never the bare plain the
 * old field fell to -- without flattening the envelope's own relief.
 */
export function massingEnvelope(summitField, floorH, gain, radius) {
  const blurred = blurWrap(summitField, radius, 2);
  let peak = 0;
  for (const v of blurred) if (v > peak) peak = v;
  const out = new Float32Array(blurred.length);
  const norm = peak > 1e-6 ? 1 / peak : 0;
  for (let i = 0; i < blurred.length; i++) {
    out[i] = floorH + gain * clamp01(blurred[i] * norm);
  }
  return out;
}

/**
 * Crenellation: the rocky serration along a crest. Amplitude scales with
 * `relief` (how far this x already stands above the valley floor), which
 * is the whole point -- uniform noise across the tile was inventing local
 * maxima down on the flats that competed with the song's real summits (a
 * 3-5 peak massif was measuring 13 local maxima before this). Anchoring it
 * to relief means valleys stay calm and only genuine high ground gets
 * chewed.
 */
export function crenellation(noise, x, relief, amp) {
  if (!(relief > 0) || !(amp > 0)) return 0;
  const o1 = noise.sample(x * 0.021 + 7.3);
  const o2 = noise.sample(x * 0.052 + 19.1);
  const o3 = noise.sample(x * 0.115 + 3.7);
  // Signed, so a crest is chewed both ways rather than only ever growing.
  const n = o1 * 0.55 + o2 * 0.31 + o3 * 0.14;
  return n * amp * relief;
}

/**
 * Couloirs: the near-vertical gullies that stripe a mountain's flanks.
 * These only ever CARVE (never add), only on real relief, and -- unlike
 * the old uniform ridged carve -- are strongest on the FLANKS and fade out
 * at both the summit apex and the valley floor, which is where real
 * couloirs actually live. `flankness` is supplied by the caller from the
 * local slope, so the gullies follow the mountain's own geometry instead
 * of being stamped on at a fixed rate everywhere.
 */
export function couloirCarve(noise, x, relief, flankness, amp) {
  if (!(relief > 0) || !(amp > 0) || !(flankness > 0)) return 0;
  const n = noise.sample(x * 0.038 + 11.9);
  // Ridged and rectified: sharp V incisions, never bumps.
  const v = 1 - Math.abs(n);
  return v * v * amp * relief * clamp01(flankness);
}

/** Prevailing steep-side direction for a range, from its own seed. */
export function regionalDip(rand) {
  return rand() < 0.5 ? -1 : 1;
}

/**
 * Composes the shape parameters a character/lithology pair implies. Kept
 * here (rather than inline in the field loop) so the numbers that decide
 * how a range READS are in one place next to the functions that use them.
 */
export function shapeDials(cfg, litho) {
  const basement = litho?.basement ?? 0.35;
  const edge = litho?.edge ?? 0.25;
  const air = litho?.air ?? 0.15;
  return {
    // Bass builds high country -- an altiplano the summits stand on -- but
    // the envelope is a PLATFORM, not the mountain. Two calibration
    // mistakes in a row here, in opposite directions: a high floor with a
    // tiny swing read as a flat table with summits spiking out of it, and
    // then a big swing read as rolling hills, because the base climbed so
    // close to the summit ceiling that the tallest peak cleared its own
    // footing by barely a quarter of the strip. Relief -- summit height
    // ABOVE local base -- is the thing that makes a mountain read as a
    // mountain, so the envelope has to stay well down and leave it room.
    spineFloor: clamp(0.07 + basement * 0.07 + (cfg.bed ?? 0.12) * 0.22, 0.05, 0.20),
    spineSwing: clamp(0.13 + basement * 0.10, 0.10, 0.26),
    // Presence/edge cuts gullies; air serrates the crest.
    couloir: clamp((cfg.notch ?? 0.12) * (0.55 + 1.15 * edge), 0, 0.34),
    crenel: clamp((cfg.teeth ?? 0.08) * (0.50 + 1.30 * air), 0, 0.26),
    apronSpread: clamp(cfg.apronSpread ?? 2.4, 1.6, 3.4),
    apronCap: clamp(cfg.apronCap ?? 0.5, 0.3, 0.7),
  };
}

/** How much this x reads as a flank rather than an apex or a flat -- the
 *  gate couloirs ride. Derived from the local gradient, normalized so it
 *  peaks on steep ground and falls away at both summits and valley floors. */
export function flankness(slopePerPx) {
  const s = Math.abs(slopePerPx) * 220;
  return clamp01(s) * clamp01(2 - s);
}

export { lerp };
