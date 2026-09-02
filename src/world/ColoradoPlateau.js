// The shape language of southern Utah.
//
// An alpine flank is one continuous curve from summit to foot -- a
// superellipse quarter, which is what RidgeShape.flankProfile draws. That is
// the right primitive for a mountain built by uplift and carved by ice. It is
// the wrong one for the Colorado Plateau, where the rock is flat-lying
// sedimentary layers of alternating hardness and erosion works on them
// LAYER BY LAYER rather than sculpting a continuous slope.
//
// What that produces, and what this module draws:
//
//   CAPROCK. A resistant top layer that erodes back rather than down, so a
//   butte or mesa is FLAT ON TOP. No summit, no horn, no apex -- a table.
//   This is the single most identifiable feature of the region and the one
//   thing an alpine profile can never produce.
//
//   CLIFF BANDS. Under the caprock, hard layers stand as near-vertical
//   walls. In profile a cliff is a nearly instantaneous drop, not a steep
//   slope: the wall of a Monument Valley butte is within a few degrees of
//   plumb for hundreds of feet.
//
//   BENCHES. Between cliffs, softer layers weather back to gentle sloping
//   shelves. Cliff-bench-cliff-bench stacked down a face is the Grand
//   Staircase in cross-section, and it is why these formations read as
//   ARCHITECTURE -- storeys, not a hillside.
//
//   TALUS. At the base, debris shed from the cliffs piles at the angle of
//   repose (~32 degrees for sandstone blocks) in a straight-to-slightly-
//   concave apron. The break between the vertical wall and this apron is
//   abrupt, and that abruptness is a large part of the silhouette.
//
// Two named references the design asked for specifically:
//
//   MONUMENT VALLEY is about ISOLATION. Buttes stand alone on a flat floor
//   with wide empty ground between them, so the negative space matters as
//   much as the rock. `MONUMENT` uses a tall cap, one big cliff, a short
//   talus, and the composer is told to space them widely.
//
//   CAPITOL REEF is the Waterpocket Fold -- a monocline, strata tilted along
//   its length -- plus the rounded Navajo sandstone domes that give it its
//   name (Capitol Dome, for the building it resembles). So `REEF` tilts its
//   benches along the profile, and `DOME` is a rounded cap rather than a
//   flat one: the one place in this vocabulary where a summit is curved.
//
// Pure geometry, no canvas. SilhouetteGenerator composes these the same way
// it composed the alpine flanks.
import { clamp01 } from '../utils/math.js';

/** Angle of repose for sandstone debris, as a rise/run the talus follows. */
export const TALUS_REPOSE = 0.62;

/**
 * The formation archetypes.
 *
 * `cap`     fraction of the half-width that is flat caprock
 * `benches` how many cliff+bench pairs sit under the cap
 * `cliff`   fraction of the half-width ONE cliff spends falling (small =
 *           more vertical; this is the number that makes it read as rock
 *           rather than as a hill)
 * `talus`   fraction of the half-width given to the debris apron
 * `talusTop` height the apron starts at, as a fraction of full height --
 *           i.e. how much of the formation is cliff-and-bench above it
 * `tilt`    monoclinal dip: benches step down along the profile
 * `round`   0 = flat caprock, 1 = a fully rounded dome
 */
export const PLATEAU_FORMS = {
  // Monument Valley: one commanding wall, little else.
  MONUMENT: { cap: 0.30, benches: 1, cliff: 0.05, talus: 0.26, talusTop: 0.30, tilt: 0, round: 0 },
  // A broad mesa -- more table than tower.
  MESA: { cap: 0.52, benches: 1, cliff: 0.06, talus: 0.22, talusTop: 0.26, tilt: 0, round: 0 },
  // The stacked storeys of the Grand Staircase.
  STAIRCASE: { cap: 0.20, benches: 3, cliff: 0.045, talus: 0.24, talusTop: 0.22, tilt: 0, round: 0 },
  // Capitol Reef's Waterpocket Fold: the same storeys, tilted.
  REEF: { cap: 0.18, benches: 3, cliff: 0.05, talus: 0.26, talusTop: 0.24, tilt: 0.42, round: 0 },
  // Navajo sandstone domes -- rounded, not tabled.
  DOME: { cap: 0.40, benches: 1, cliff: 0.09, talus: 0.24, talusTop: 0.30, tilt: 0, round: 0.85 },
  // A narrow remnant: what a butte erodes down to before it goes.
  SPIRE: { cap: 0.13, benches: 1, cliff: 0.04, talus: 0.20, talusTop: 0.34, tilt: 0, round: 0 },
};

export const PLATEAU_FORM_NAMES = Object.keys(PLATEAU_FORMS);

/**
 * Height of one formation at normalized distance `d` from its center.
 *
 * `d` runs 0 (the middle of the caprock) to 1 (the outer toe of the talus).
 * Returns 0..1. The curve is piecewise -- flat, then a stack of cliff/bench
 * pairs, then the apron -- because the rock is piecewise. Smoothing it into
 * one continuous flank is precisely what would turn it back into a mountain.
 *
 * @param {number} d
 * @param {object} form one of PLATEAU_FORMS (or the same shape)
 * @param {number} [soften] 0..1, rounds the hard corners very slightly so a
 *   rasterizer has something to anti-alias. Kept small: the corners ARE the
 *   silhouette.
 */
export function plateauProfile(d, form, soften = 0.12) {
  const f = form || PLATEAU_FORMS.MESA;
  const t = clamp01(d);
  if (t >= 1) return 0;

  const cap = clamp01(f.cap);
  const talus = clamp01(f.talus);
  const talusTop = clamp01(f.talusTop);
  const benches = Math.max(1, Math.round(f.benches));
  const stackW = Math.max(1e-6, 1 - cap - talus);
  const round = clamp01(f.round || 0);
  // Where the caprock hands over to the cliff stack. A flat cap hands over at
  // full height; a dome has already curved down by then. Computing this once
  // and starting the stack FROM it is what keeps the profile monotonic --
  // the first version let a dome fall to 0.4 across its cap and then restart
  // the stack at 1.0, which is a notch, not a formation.
  const capEnd = 1 - round * (1 - talusTop) * 0.55;

  // --- caprock -----------------------------------------------------------
  if (t <= cap) {
    if (round <= 0) return 1;
    const u = cap > 1e-6 ? t / cap : 1;
    // Circular shoulder: flat at the crown, steepening toward the rim.
    return 1 - (1 - capEnd) * (1 - Math.sqrt(Math.max(0, 1 - u * u)));
  }

  // --- cliff + bench stack ----------------------------------------------
  // The stack spans capEnd -> talusTop, always, however the drop is
  // distributed between pairs. Monoclinal tilt REDISTRIBUTES that drop
  // (later storeys give up more) rather than adding to it, so the Waterpocket
  // Fold's lean cannot push a bench below the segment that follows it.
  if (t <= cap + stackW) {
    const u = (t - cap) / stackW;
    const pairW = 1 / benches;
    const idx = Math.min(benches - 1, Math.floor(u / pairW));
    const inPair = (u - idx * pairW) / pairW;
    const tilt = f.tilt || 0;
    const spread = benches > 1 ? benches - 1 : 1;
    const weightOf = (i) => 1 + tilt * ((i / spread) - 0.5) * 2;
    let total = 0;
    for (let i = 0; i < benches; i++) total += weightOf(i);
    const unit = (capEnd - talusTop) / Math.max(1e-6, total);
    let above = capEnd;
    for (let i = 0; i < idx; i++) above -= unit * weightOf(i);
    const pairDrop = unit * weightOf(idx);
    // Cliffs take most of a storey's drop; benches give away only a little.
    // That ratio is what makes a bench read as a shelf rather than a slope.
    const cliffDrop = pairDrop * 0.82;
    const benchDrop = pairDrop * 0.18;
    const cliffShare = clamp01(f.cliff / Math.max(1e-6, stackW * pairW));
    if (inPair <= cliffShare) {
      const c = cliffShare > 1e-6 ? inPair / cliffShare : 1;
      // Eased only across the cliff's own tiny width: the fall stays
      // effectively vertical, it simply does not start and stop on a corner.
      const eased = soften > 0 ? c * c * (3 - 2 * c) * soften + c * (1 - soften) : c;
      return above - cliffDrop * eased;
    }
    const b = (inPair - cliffShare) / Math.max(1e-6, 1 - cliffShare);
    return above - cliffDrop - benchDrop * b;
  }

  // --- talus apron -------------------------------------------------------
  const u = (t - cap - stackW) / Math.max(1e-6, talus);
  // Straight at the angle of repose, easing very slightly concave into the
  // floor the way a real debris fan does.
  return talusTop * Math.pow(1 - u, 1 / Math.max(0.2, TALUS_REPOSE * 1.6));
}

/**
 * Pick a formation for one summit.
 *
 * Driven by the song rather than by chance where it can be: a bright,
 * high-crest section gets the tall isolated monuments, a bass-heavy one gets
 * broad mesas, and the tilted reef appears where the section already leans.
 * `rand` only breaks ties, so the same song always builds the same country.
 *
 * @param {object} [p]
 * @param {number} [p.crest] litho.crest -- bright/high spectral mass
 * @param {number} [p.foot]  litho.foot  -- bass mass
 * @param {number} [p.tilt]  the layer's profileMix; a leaning section reefs
 * @param {number} [p.spiky] 0..1 spike-vs-organic, from the shape grammar
 */
export function pickFormation(rand, {
  crest = 0.5, foot = 0.5, tilt = 0, spiky = 0.5,
} = {}) {
  const r = typeof rand === 'function' ? rand() : 0.5;
  // `spiky` is the song's own spike-vs-organic DNA (RidgeShape.flankQs builds
  // the same number for the alpine flanks). Under the old model it bent the
  // superellipse exponent; here there is no exponent to bend, so it chooses
  // WHICH FORMATION instead -- a spiky song erodes its country down to
  // isolated towers, an organic one leaves broad layered mesas standing.
  // Routing it here is what keeps the shape-grammar table composing: without
  // it, spireMixAdd stopped reaching the height field at all.
  const s = Math.max(0, Math.min(1, spiky));
  const towerBias = (s - 0.5) * 0.9; // +-0.45 shift toward towers / tables
  if (Math.abs(tilt) > 0.55 && r < 0.72) return PLATEAU_FORMS.REEF;
  if (crest > 0.62) return r < 0.55 ? PLATEAU_FORMS.MONUMENT : PLATEAU_FORMS.SPIRE;
  if (foot > 0.60 && s < 0.62) return r < 0.66 ? PLATEAU_FORMS.MESA : PLATEAU_FORMS.STAIRCASE;
  const rr = Math.max(0, Math.min(1, r + towerBias));
  if (rr < 0.20) return PLATEAU_FORMS.DOME;
  if (rr < 0.44) return PLATEAU_FORMS.MESA;
  if (rr < 0.68) return PLATEAU_FORMS.STAIRCASE;
  if (rr < 0.86) return PLATEAU_FORMS.MONUMENT;
  return PLATEAU_FORMS.SPIRE;
}

/**
 * How far apart formations want to stand, as a multiple of their own width.
 *
 * Monument Valley is as much about the empty floor as about the rock: buttes
 * that touch are a mountain range, and the isolation is the whole read. This
 * is handed to the composer so spacing is a property of the LANDFORM rather
 * than a constant buried in the placer.
 */
export function isolationFor(form) {
  if (form === PLATEAU_FORMS.MONUMENT || form === PLATEAU_FORMS.SPIRE) return 2.6;
  if (form === PLATEAU_FORMS.MESA) return 1.5;
  if (form === PLATEAU_FORMS.REEF) return 1.15; // a reef is continuous by definition
  return 1.8;
}
