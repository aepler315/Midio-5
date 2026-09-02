// The shape language of southern Utah.
//
// An alpine flank is one continuous curve from summit to foot -- a
// superellipse quarter, which is what RidgeShape.flankProfile draws. That is
// the right primitive for a mountain built by uplift and carved by ice. It is
// the wrong one for the Colorado Plateau, where the rock is flat-lying
// sedimentary layers of alternating hardness and erosion works on them
// LAYER BY LAYER rather than sculpting a continuous slope.
//
// The first version of this file drew that insight and then stopped there:
// six formations that were all the same skeleton -- caprock, cliff/bench
// stack, talus -- differing only in their fractions. On screen that reads as
// a row of trapezoids, because that is what it is. Southern Utah is not one
// idea. It is Monument Valley AND Bryce's hoodoo forests AND the Waterpocket
// Fold AND Arches' fins AND the Henry Mountains, which are eleven-thousand-
// foot laccoliths and look nothing like a butte at all.
//
// So the vocabulary here is six SKELETONS, each a different function of
// distance, not one skeleton with six parameter sets:
//
//   STACK    caprock over cliff-and-bench storeys over talus. The butte
//            family: Monument Valley, the Grand Staircase, mesas.
//   CUESTA   the same storeys, but wildly asymmetric -- one plumb face and
//            one long dip slope. Comb Ridge, the Waterpocket Fold.
//   DOME     rounded all the way, no flat top anywhere. Navajo sandstone:
//            Capitol Dome, the petrified dunes.
//   CONE     an actual mountain -- rounded summit, steep flanks, a flaring
//            concave base. The Henry Mountains, the La Sals, the Abajos are
//            laccoliths and they are the tallest thing in the region.
//   BADLAND  a soft rilled cone with no cap at all. Factory Butte, the
//            bentonite hills of Cathedral Valley.
//   TOWER    a narrow column: small cap, a capstone step, then wall. Bryce's
//            hoodoos, the Needles, Fisher Towers, the fins at Arches.
//
// Three levers carry the variety, and the last two matter as much as the
// profile: WIDTH (a fin is a fifth the width of a mesa), HEIGHT, and
// ASYMMETRY (a cuesta's dip slope runs several times longer than its face). A
// shape language with one width and one height is still a row of trapezoids
// however many profiles it has.
//
// The width range is deliberately not as wide as the real geology. A true
// fin is a hundred times longer than it is thick, and drawn honestly at this
// scale it comes out a single pixel across -- which reads as a render
// artifact, an antenna, anything but rock. The towers are therefore drawn
// stockier than they are, and the ratio to a mesa is held around four rather
// than ten. This is the one place the vocabulary knowingly lies, because the
// alternative does not read as the thing it accurately describes.
//
// Pure geometry, no canvas. SilhouetteGenerator composes these the same way
// it composed the alpine flanks.
import { clamp01 } from '../utils/math.js';

/** Angle of repose for sandstone debris, as a rise/run the talus follows. */
export const TALUS_REPOSE = 0.62;

/** The profile skeletons. Each is a different function of distance. */
export const FORM_KIND = Object.freeze({
  STACK: 'stack',
  CUESTA: 'cuesta',
  DOME: 'dome',
  CONE: 'cone',
  BADLAND: 'badland',
  TOWER: 'tower',
});

/**
 * The formation archetypes.
 *
 * `kind`     which skeleton draws it
 * `family`   what it reads as, for weighting and spacing
 * `widthMul` half-width as a multiple of the peak's nominal width -- the
 *            single most important field for variety after `kind`
 * `heightMul` height as a multiple of the peak's nominal height. NORMALIZED
 *            so the tallest form is exactly 1: anything above it overshoots
 *            the field's ceiling and gets resolved by clamp01, which saws
 *            the tops off precisely the formations that most need them.
 *            Relative variety is what matters here anyway -- generateSilhouette
 *            refits the whole ridge to its headroom afterwards. The floor is
 *            not 0 for the opposite reason: if the short forms sit too low,
 *            a field that happens to draw none of the tall ones never spans
 *            its own range, and everything reading raw height sees a flat,
 *            starved ridge.
 * `asym`     dip-slope length over face length; 1 is symmetric
 *
 * STACK/CUESTA also carry:
 * `cap`      fraction of the half-width that is flat caprock
 * `benches`  how many cliff+bench pairs sit under the cap
 * `cliff`    fraction of the half-width ONE cliff spends falling
 * `talus`    fraction given to the debris apron
 * `talusTop` height the apron starts at
 * `tilt`     monoclinal dip: benches step down along the profile
 * `round`    0 = flat caprock, 1 = a fully rounded crown
 */
export const PLATEAU_FORMS = {
  // --- the butte family -------------------------------------------------
  // A broad table -- more table than tower.
  MESA: {
    kind: FORM_KIND.STACK, family: 'table',
    cap: 0.52, benches: 1, cliff: 0.06, talus: 0.22, talusTop: 0.26, tilt: 0, round: 0,
    widthMul: 1.60, heightMul: 0.625, asym: 1.15,
  },
  // Between a mesa and a monument: the everyday landform of the region.
  BUTTE: {
    kind: FORM_KIND.STACK, family: 'table',
    cap: 0.34, benches: 2, cliff: 0.05, talus: 0.24, talusTop: 0.28, tilt: 0, round: 0,
    widthMul: 1.00, heightMul: 0.750, asym: 1.2,
  },
  // Monument Valley: one commanding wall, little else, standing alone.
  MONUMENT: {
    kind: FORM_KIND.STACK, family: 'tower',
    cap: 0.30, benches: 1, cliff: 0.04, talus: 0.26, talusTop: 0.30, tilt: 0, round: 0,
    widthMul: 0.70, heightMul: 0.864, asym: 1.1,
  },
  // The stacked storeys of the Grand Staircase.
  STAIRCASE: {
    kind: FORM_KIND.STACK, family: 'table',
    cap: 0.20, benches: 3, cliff: 0.045, talus: 0.24, talusTop: 0.22, tilt: 0, round: 0,
    widthMul: 1.35, heightMul: 0.687, asym: 1.25,
  },
  // A narrow remnant: what a butte erodes down to before it goes.
  SPIRE: {
    kind: FORM_KIND.STACK, family: 'tower',
    cap: 0.13, benches: 1, cliff: 0.04, talus: 0.20, talusTop: 0.34, tilt: 0, round: 0,
    widthMul: 0.48, heightMul: 0.812, asym: 1.05,
  },

  // --- the monocline ----------------------------------------------------
  // Capitol Reef's Waterpocket Fold and Comb Ridge: storeys tilted along
  // their length, and a dip slope running several times the face.
  REEF: {
    kind: FORM_KIND.CUESTA, family: 'ridge',
    cap: 0.18, benches: 3, cliff: 0.05, talus: 0.26, talusTop: 0.24, tilt: 0.42, round: 0,
    widthMul: 1.45, heightMul: 0.718, asym: 3.6,
  },

  // --- Navajo sandstone -------------------------------------------------
  // Capitol Dome: rounded, but still standing on a cliff band.
  DOME: {
    kind: FORM_KIND.STACK, family: 'round',
    cap: 0.40, benches: 1, cliff: 0.09, talus: 0.24, talusTop: 0.30, tilt: 0, round: 0.85,
    widthMul: 1.05, heightMul: 0.676, asym: 1.15,
  },
  // Petrified dunes: broad, low, smooth the whole way down.
  SLICKROCK: {
    kind: FORM_KIND.DOME, family: 'round',
    domeP: 2.3, domeQ: 0.46, talus: 0.2, talusTop: 0.2,
    widthMul: 2.15, heightMul: 0.447, asym: 1.35,
  },

  // --- real mountains ---------------------------------------------------
  // The Henry Mountains, the La Sals, the Abajos. Laccoliths: magma that
  // never reached the surface, doming the rock above it into genuine peaks
  // above eleven thousand feet. The tallest thing in the region and the one
  // silhouette a butte vocabulary can never produce.
  LACCOLITH: {
    kind: FORM_KIND.CONE, family: 'peak',
    coneP: 1.6, coneQ: 0.72,
    widthMul: 1.95, heightMul: 1.000, asym: 1.3,
  },

  // --- soft rock --------------------------------------------------------
  // Factory Butte's flanks, Cathedral Valley's bentonite: no caprock, no
  // cliff, just a steep rilled cone that erodes as one piece.
  BADLAND: {
    kind: FORM_KIND.BADLAND, family: 'soft',
    badP: 1.18, widthMul: 0.95, heightMul: 0.541, asym: 1.2,
  },

  // --- columns ----------------------------------------------------------
  // Bryce. A capstone over a narrow neck, in forests of them.
  HOODOO: {
    kind: FORM_KIND.TOWER, family: 'tower',
    cap: 0.30, capStep: 0.14, talus: 0.20, talusTop: 0.16, wallPow: 0.42,
    widthMul: 0.46, heightMul: 0.708, asym: 1.05,
  },
  // The Needles, Fisher Towers: taller and thinner still, barely a cap.
  NEEDLE: {
    kind: FORM_KIND.TOWER, family: 'tower',
    cap: 0.16, capStep: 0.06, talus: 0.16, talusTop: 0.12, wallPow: 0.32,
    widthMul: 0.36, heightMul: 0.896, asym: 1.0,
  },
  // The fins at Arches, before the holes open: a thin blade of rock.
  FIN: {
    kind: FORM_KIND.TOWER, family: 'ridge',
    cap: 0.44, capStep: 0.05, talus: 0.14, talusTop: 0.14, wallPow: 0.30,
    widthMul: 0.30, heightMul: 0.781, asym: 1.4,
  },
  // Goblin Valley: squat, wide-capped lumps, knee-high beside the rest.
  GOBLIN: {
    kind: FORM_KIND.TOWER, family: 'soft',
    cap: 0.42, capStep: 0.22, talus: 0.28, talusTop: 0.30, wallPow: 0.6,
    widthMul: 0.66, heightMul: 0.400, asym: 1.1,
  },
};

export const PLATEAU_FORM_NAMES = Object.keys(PLATEAU_FORMS);

/** Ease a 0..1 ramp, but only as far as `soften` asks. */
function eased(c, soften) {
  return soften > 0 ? c * c * (3 - 2 * c) * soften + c * (1 - soften) : c;
}

/**
 * Height of one formation at normalized distance `d` from its center.
 *
 * `d` runs 0 (the middle of the crown) to 1 (the outer toe). Returns 0..1,
 * and is MONOTONIC NON-INCREASING for every form -- a rise anywhere is a
 * notch bitten out of the rock, which is what the first version shipped
 * twice before the sweep in the tests caught it.
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
  switch (f.kind) {
    case FORM_KIND.DOME: return domeProfile(t, f);
    case FORM_KIND.CONE: return coneProfile(t, f);
    case FORM_KIND.BADLAND: return badlandProfile(t, f);
    case FORM_KIND.TOWER: return towerProfile(t, f, soften);
    // A cuesta's asymmetry lives in its WIDTH, not its profile -- see
    // plateauMass -- so its cross-section is the same storeyed stack.
    case FORM_KIND.CUESTA:
    case FORM_KIND.STACK:
    default: return stackProfile(t, f, soften);
  }
}

/** Caprock over cliff-and-bench storeys over a talus apron. */
function stackProfile(t, f, soften) {
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

  if (t <= cap) {
    if (round <= 0) return 1;
    const u = cap > 1e-6 ? t / cap : 1;
    // Circular shoulder: flat at the crown, steepening toward the rim.
    return 1 - (1 - capEnd) * (1 - Math.sqrt(Math.max(0, 1 - u * u)));
  }

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
      return above - cliffDrop * eased(c, soften);
    }
    const b = (inPair - cliffShare) / Math.max(1e-6, 1 - cliffShare);
    return above - cliffDrop - benchDrop * b;
  }

  const u = (t - cap - stackW) / Math.max(1e-6, talus);
  // Straight at the angle of repose, easing very slightly concave into the
  // floor the way a real debris fan does.
  return talusTop * Math.pow(1 - u, 1 / Math.max(0.2, TALUS_REPOSE * 1.6));
}

/** Rounded from crown to floor: no flat anywhere, no cliff band. */
function domeProfile(t, f) {
  const p = f.domeP ?? 2.2, q = f.domeQ ?? 0.5;
  return Math.pow(Math.max(0, 1 - Math.pow(t, p)), q);
}

/**
 * A mountain, not a butte.
 *
 * Rounded summit (the exponent above 1 kills the slope at the crown), steep
 * flanks, and a base that flares out concave into the surrounding country --
 * a laccolith's whole silhouette, and the one shape the butte vocabulary
 * cannot approximate.
 */
function coneProfile(t, f) {
  const p = f.coneP ?? 1.6, q = f.coneQ ?? 0.72;
  return Math.pow(Math.max(0, 1 - Math.pow(t, p)), q);
}

/** A soft rilled cone: sharp ridge, no caprock, straight-ish sides. */
function badlandProfile(t, f) {
  return Math.pow(Math.max(0, 1 - t), f.badP ?? 1.18);
}

/**
 * A column: small cap, a capstone step, then wall.
 *
 * The wall's near-verticality comes from two places working together -- the
 * profile spending nearly all its height in the first fraction of its width,
 * AND `widthMul` making the whole formation narrow to begin with. Either
 * alone gives a cone.
 */
function towerProfile(t, f, soften) {
  const cap = clamp01(f.cap);
  const talus = clamp01(f.talus);
  const talusTop = clamp01(f.talusTop);
  const capStep = clamp01(f.capStep ?? 0.12);
  const wallEnd = Math.max(cap + 1e-6, 1 - talus);
  if (t <= cap) return 1;
  if (t <= wallEnd) {
    const u = (t - cap) / (wallEnd - cap);
    // The capstone's underside: a short, hard step just below the cap. On a
    // hoodoo this is the whole silhouette; on a needle it is barely there.
    const stepW = 0.2;
    if (u < stepW) return 1 - capStep * eased(u / stepW, soften);
    const c = (u - stepW) / (1 - stepW);
    // A low exponent spends the height early -- that is the wall.
    return (1 - capStep) - ((1 - capStep) - talusTop) * Math.pow(c, f.wallPow ?? 0.4);
  }
  const u = (t - wallEnd) / Math.max(1e-6, talus);
  return talusTop * Math.pow(1 - u, 1 / Math.max(0.2, TALUS_REPOSE * 1.6));
}

/**
 * Pick a formation for one summit.
 *
 * Weighted rather than branched. The first version hard-branched on the
 * section's lithology -- `if (crest > 0.62) return r < 0.55 ? MONUMENT :
 * SPIRE` -- and since lithology is constant across a section, every summit in
 * it drew from the same TWO forms. That is why the country read as a row of
 * trapezoids however many archetypes the table held. Weighting keeps the song
 * in charge of what a section LEANS toward while letting anything appear.
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
  const c = clamp01(crest), f = clamp01(foot);
  // `spiky` is the song's own spike-vs-organic DNA (RidgeShape.flankQs builds
  // the same number for the alpine flanks). Under the old model it bent the
  // superellipse exponent; here there is no exponent to bend, so it shifts
  // the whole distribution toward towers or toward tables. Routing it here is
  // what keeps the shape-grammar table composing: without it, spireMixAdd
  // stops reaching the height field at all.
  const s = clamp01(spiky);
  const lean = Math.min(1, Math.abs(tilt) / 0.8);
  const F = PLATEAU_FORMS;

  // Ordered so the monocline is reached first: a strongly leaning section is
  // a reef before it is anything else.
  //
  // The stack family carries the base weight and the smooth skeletons are
  // accents. Weighted evenly, domes, cones and badlands crowd out the
  // cliff-and-bench rock and the country stops reading as the Colorado
  // Plateau at all -- it reads as generic hills, which is a different
  // failure from the row of trapezoids but no better.
  const weights = [
    [F.REEF, 0.05 + lean * 4.0],
    [F.FIN, 0.10 + lean * 1.1 + s * 0.55],
    [F.MONUMENT, 0.30 + c * 1.5 + s * 0.7],
    [F.SPIRE, 0.16 + c * 1.0 + s * 0.9],
    [F.NEEDLE, 0.08 + c * 0.8 + s * 0.8],
    [F.HOODOO, 0.14 + c * 0.7 + s * 0.6],
    [F.BUTTE, 0.80 + f * 0.6],
    [F.MESA, 0.42 + f * 1.7 - s * 0.45],
    [F.STAIRCASE, 0.38 + f * 1.3 - s * 0.35],
    [F.DOME, 0.20 + (1 - s) * 0.45],
    [F.SLICKROCK, 0.09 + (1 - s) * 0.40 + f * 0.20],
    [F.LACCOLITH, 0.10 + (1 - c) * 0.26 + (1 - s) * 0.24],
    [F.BADLAND, 0.10 + (1 - c) * 0.26],
    [F.GOBLIN, 0.07 + (1 - c) * 0.20],
  ];

  let total = 0;
  for (const [, w] of weights) total += Math.max(0, w);
  let pick = clamp01(r) * total;
  for (const [form, w] of weights) {
    pick -= Math.max(0, w);
    if (pick <= 0) return form;
  }
  return F.BUTTE;
}

/**
 * One summit's own variation on its form.
 *
 * Two mesas built from the identical parameter set are the same rock twice,
 * and a ridge of them reads as a repeated stamp. This perturbs each summit's
 * copy so the family is recognisable but no two members are traceable to each
 * other. Every field stays inside the range its profile function is monotonic
 * over, so the correctness property survives the jitter.
 */
export function varyFormation(form, rand) {
  const f = form || PLATEAU_FORMS.BUTTE;
  const r = typeof rand === 'function' ? rand : () => 0.5;
  const jit = (amt) => 1 + (r() * 2 - 1) * amt;
  const out = {
    ...f,
    widthMul: Math.max(0.06, (f.widthMul ?? 1) * jit(0.30)),
    // Capped at 1 for the same reason the table is normalized to it: past
    // the ceiling, clamp01 turns a summit into a flat top.
    heightMul: Math.min(1, Math.max(0.12, (f.heightMul ?? 1) * jit(0.24))),
    asym: Math.max(1, (f.asym ?? 1) * jit(0.22)),
  };
  if (f.cap != null) out.cap = clamp01(f.cap * jit(0.20));
  if (f.talus != null) out.talus = clamp01(f.talus * jit(0.18));
  if (f.talusTop != null) out.talusTop = clamp01(f.talusTop * jit(0.16));
  // An extra storey now and then, so a staircase is not always three.
  if (f.benches != null) out.benches = Math.max(1, f.benches + (r() < 0.28 ? 1 : 0));
  // Keep cap + talus from swallowing the stack between them.
  if (out.cap != null && out.talus != null && out.cap + out.talus > 0.9) {
    const k = 0.9 / (out.cap + out.talus);
    out.cap *= k; out.talus *= k;
  }
  return out;
}

/**
 * How far apart formations want to stand, as a multiple of their own width.
 *
 * Monument Valley is as much about the empty floor as about the rock: buttes
 * that touch are a mountain range, and the isolation is the whole read. Bryce
 * is the opposite -- hoodoos mean nothing alone and everything in a crowd.
 * This is handed to the composer so spacing is a property of the LANDFORM
 * rather than a constant buried in the placer.
 */
export function isolationFor(form) {
  const f = form || PLATEAU_FORMS.BUTTE;
  if (f === PLATEAU_FORMS.MONUMENT || f === PLATEAU_FORMS.SPIRE) return 2.6;
  // Columns cluster: a lone hoodoo is a curiosity, a thousand is Bryce.
  if (f.kind === FORM_KIND.TOWER) return f === PLATEAU_FORMS.GOBLIN ? 0.75 : 0.85;
  if (f.kind === FORM_KIND.CUESTA) return 1.15; // a reef is continuous by definition
  if (f === PLATEAU_FORMS.MESA) return 1.5;
  if (f.kind === FORM_KIND.CONE) return 2.2;    // a mountain owns its horizon
  if (f.kind === FORM_KIND.DOME) return 1.1;    // dunes run together
  return 1.8;
}
