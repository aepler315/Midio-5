// Song structure from a beat-synchronous self-similarity matrix.
//
// What this replaces: the schedule builder in BiomeManager._buildSchedule
// measured novelty as the Euclidean distance between a 4-point trailing mean
// of seven band energies and the same mean four points earlier, and labelled
// the resulting sections by greedily clustering that same 7-band shape
// (SongForm.analyzeSongForm). Band energy is a timbre proxy and nothing else,
// so a verse and a chorus sharing an arrangement were indistinguishable, and
// nothing in the pipeline ever looked at harmony at all.
//
// What this does instead is the textbook pair:
//   * boundaries  -- Foote novelty: correlate a checkerboard kernel down the
//     diagonal of a self-similarity matrix. It answers "does the music before
//     this instant resemble itself, does the music after resemble itself, and
//     do the two halves resemble each other?", which is what a section
//     boundary actually IS. A trailing-mean difference can only see a jump in
//     level.
//   * labels -- a time-lag matrix: a chorus is not "material with a similar
//     average spectrum", it is "material that literally recurs". Scoring
//     diagonals of the SSM finds the repeats directly.
//
// The features are chroma (pitch class, transposition-aware harmony) fused
// with the seven band energies (timbre). Chroma is weighted higher because
// harmony is what separates sections that share a texture.
//
// Costs nothing extra to run: PitchTracker.computePitchFeatures already runs
// the FFT over the whole song for melody/bass tracking, and its per-frame
// semitone energies fold straight into chroma. Pure and DOM-free -- it takes
// plain arrays, so it is directly testable.
import { SEMITONE_LO } from './PitchTracker.js';
import { clamp, clamp01 } from '../utils/math.js';

// Checkerboard kernel half-width, in analysis steps (bars, or ~2s slices when
// there is no bar grid). 4 bars either side = an 8-bar view, which is the
// scale real pop/rock sections change on.
const KERNEL_RADIUS = 4;
// Gaussian taper on the kernel: an abrupt-edged checkerboard rings and
// produces satellite peaks beside every real boundary.
const KERNEL_SIGMA = KERNEL_RADIUS / 1.5;
// Feature fusion. Harmony carries more of the "is this the same section"
// signal than texture does, but texture is what catches a drop or a
// breakdown that stays on the same chords.
const CHROMA_WEIGHT = 0.65, TIMBRE_WEIGHT = 0.35;
// Repetition labelling: two segments are the same material when their mean
// cross-similarity clears a threshold. Deliberately strict -- a false merge
// makes a verse wear the chorus's biome, which reads far worse than a missed
// repeat.
//
// This is the FALLBACK value. It used to be the only value, and a flat
// cosine cutoff is the wrong shape for the question, because how similar two
// DIFFERENT sections look depends on how much timbral and harmonic contrast
// the arrangement has at all. Measured on a fixed A-B-A-C form with the
// contrast between its classes swept: above ~0.8 contrast the read is correct,
// and below it every pairwise similarity is squeezed above 0.82 and the whole
// song collapses to a SINGLE label -- one biome, start to finish, with the
// form invisible. That is not an exotic input; a track built on one synth
// patch, an acoustic singer-songwriter take, or a lo-fi loop lives there.
//
// So the cutoff is placed against the song's OWN distribution of segment
// similarities instead (see `repeatThresholdFor`), and this constant now
// serves only the cases where that distribution can't be estimated.
export const REPEAT_THRESHOLD = 0.82;
// Where in the song's own similarity range the cutoff sits. Halfway: a
// repeat is material that resembles its twin more than the song's typical
// pair does, by the song's own standard.
const REPEAT_LEVEL = 0.5;
// Fewer pairs than this and there is no distribution to speak of -- two
// segments give exactly one similarity, whose min and max are the same
// number, which would merge them unconditionally. Fall back to the absolute
// cutoff there.
const REPEAT_MIN_PAIRS = 3;
// A similarity range narrower than this means the song genuinely has one
// texture: every pair is alike, and the peaks in that range are noise rather
// than form. Stretching THAT to full scale manufactures repeats out of
// nothing, so fall back to the absolute cutoff -- the same guard, and the
// same reasoning, as EnergyCurves.FLAT_SPREAD_MIN.
const REPEAT_SPREAD_MIN = 0.02;
// Hard floor on what may ever be called "the same material". A
// through-composed piece has no repeats at all, and its own range tops out
// low; without this its least-dissimilar pair would still be promoted to a
// repeat purely for being the best of a bad lot.
const REPEAT_ABS_MIN = 0.5;
// Ceiling on the confidence of a read that produced a single section, i.e.
// found no boundaries at all. Must sit below BiomeManager's
// SSM_CONFIDENCE_FLOOR so such a read can never win over the energy path.
export const NO_STRUCTURE_CONFIDENCE = 0.2;
// Below this many analysis points the SSM is too small for a checkerboard
// kernel to mean anything; the caller should fall back.
const MIN_POINTS = 3 * KERNEL_RADIUS;

/** L2-normalize in place; a zero vector is left alone (silence stays silent
 *  rather than becoming an arbitrary unit direction). */
function l2normalize(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s);
  if (n > 1e-9) for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 1e-9 ? clamp(dot / d, -1, 1) : 0;
}

/**
 * Average PitchTracker frames over [fromMs, toMs) and fold to 12 pitch
 * classes. Folding by pitch class (rather than keeping absolute semitones)
 * is what makes a chorus match its earlier self even when it was voiced an
 * octave apart the second time.
 */
export function chromaBetween(features, fromMs, toMs) {
  const out = new Float64Array(12);
  if (!features || !features.frames || features.frames.length === 0) return out;
  const { rate, frames } = features;
  const i0 = clamp(Math.floor((fromMs / 1000) * rate), 0, frames.length - 1);
  const i1 = clamp(Math.ceil((toMs / 1000) * rate), i0 + 1, frames.length);
  for (let i = i0; i < i1; i++) {
    const semis = frames[i];
    for (let s = 0; s < semis.length; s++) {
      if (semis[s] > 0) out[(((SEMITONE_LO + s) % 12) + 12) % 12] += semis[s];
    }
  }
  return l2normalize(out);
}

/** Build the fused per-point feature vectors: 12 chroma ⊕ 7 band energies,
 *  each block normalized on its own before weighting so one can't drown the
 *  other by happening to have a larger scale. */
function buildFeatures(pointsMs, features, energyCurves) {
  const out = [];
  for (let i = 0; i < pointsMs.length; i++) {
    const from = pointsMs[i];
    const to = i + 1 < pointsMs.length ? pointsMs[i + 1] : from + 2000;
    const chroma = chromaBetween(features, from, to);
    const bands = energyCurves
      ? l2normalize(Float64Array.from(energyCurves.sampleAll((from + to) / 2)))
      : new Float64Array(7);
    const v = new Float64Array(19);
    for (let k = 0; k < 12; k++) v[k] = chroma[k] * CHROMA_WEIGHT;
    for (let k = 0; k < 7; k++) v[12 + k] = bands[k] * TIMBRE_WEIGHT;
    out.push(v);
  }
  return out;
}

/** Self-similarity matrix (cosine) over the fused features. */
export function selfSimilarity(feats) {
  const n = feats.length;
  const S = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    S[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const s = cosine(feats[i], feats[j]);
      S[i][j] = s;
      S[j][i] = s;
    }
  }
  return S;
}

/**
 * Foote novelty: slide a Gaussian-tapered checkerboard kernel down the SSM's
 * diagonal. The kernel's positive quadrants sit on "past vs past" and "future
 * vs future"; its negative quadrants on "past vs future". A high response
 * means both sides are internally coherent AND unlike each other -- a
 * boundary. Edges are zeroed rather than padded: half a kernel of real data
 * produces a meaningless (and usually huge) response.
 */
export function footeNovelty(S, radius = KERNEL_RADIUS) {
  const n = S.length;
  const nov = new Float64Array(n);
  if (n < 2 * radius + 1) return nov;

  const size = 2 * radius;
  const kernel = Array.from({ length: size }, () => new Float64Array(size));
  for (let a = 0; a < size; a++) {
    for (let b = 0; b < size; b++) {
      const da = a - radius + 0.5, db = b - radius + 0.5;
      const taper = Math.exp(-(da * da + db * db) / (2 * KERNEL_SIGMA * KERNEL_SIGMA));
      const sign = (da < 0) === (db < 0) ? 1 : -1; // same quadrant sign -> coherence
      kernel[a][b] = sign * taper;
    }
  }

  for (let c = radius; c < n - radius; c++) {
    let sum = 0;
    for (let a = 0; a < size; a++) {
      const i = c - radius + a;
      for (let b = 0; b < size; b++) sum += kernel[a][b] * S[i][c - radius + b];
    }
    nov[c] = Math.max(0, sum);
  }
  return nov;
}

/**
 * Assign a structural label per segment by direct repetition: two segments
 * are the same material when the mean similarity between their points clears
 * REPEAT_THRESHOLD. Labels are integers in first-appearance order, matching
 * what SongForm.analyzeSongForm returns so downstream casting is unchanged.
 */
export function labelByRepetition(S, cuts) {
  const segs = [];
  for (let i = 0; i < cuts.length - 1; i++) segs.push([cuts[i], cuts[i + 1]]);

  const meanSim = (p, q) => {
    let sum = 0, n = 0;
    for (let i = segs[p][0]; i < segs[p][1]; i++) {
      for (let j = segs[q][0]; j < segs[q][1]; j++) { sum += S[i][j]; n++; }
    }
    return n > 0 ? sum / n : 0;
  };

  // Every pairwise segment similarity, computed once. The labelling pass below
  // needs each of these anyway; taking them up front is what makes the song's
  // own similarity distribution available to set the cutoff from.
  const sim = Array.from({ length: segs.length }, () => new Float64Array(segs.length));
  const pairs = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = meanSim(i, j);
      sim[i][j] = s;
      sim[j][i] = s;
      pairs.push(s);
    }
  }
  const threshold = repeatThresholdFor(pairs);

  const labels = new Array(segs.length).fill(-1);
  let next = 0;
  for (let i = 0; i < segs.length; i++) {
    if (labels[i] >= 0) continue;
    labels[i] = next;
    // Compare against this segment only -- not a running centroid. A centroid
    // drifts as members join and can chain two genuinely different sections
    // together through a middling third.
    for (let j = i + 1; j < segs.length; j++) {
      if (labels[j] < 0 && sim[i][j] >= threshold) labels[j] = next;
    }
    next++;
  }
  return labels;
}

/**
 * The "same material" cutoff for one song, from its own spread of pairwise
 * segment similarities.
 *
 * A flat cutoff asks "are these two segments similar in absolute terms?",
 * which conflates two different things: whether the material recurs, and how
 * much contrast the arrangement has to begin with. A song on one synth patch
 * has every pair sitting high and reads as all-one-section; a densely
 * arranged one has every pair sitting low and reads as all-distinct. Placing
 * the cutoff inside the song's own range separates those.
 *
 * Falls back to the absolute REPEAT_THRESHOLD in the two cases where the
 * range says nothing: too few pairs to have a distribution, and a range so
 * narrow the song genuinely is one texture.
 *
 * @param {number[]} pairs every distinct pairwise segment similarity
 * @returns {number} the cutoff a pair must reach to count as a repeat
 */
export function repeatThresholdFor(pairs) {
  if (!pairs || pairs.length < REPEAT_MIN_PAIRS) return REPEAT_THRESHOLD;
  let lo = Infinity, hi = -Infinity;
  for (const p of pairs) {
    if (!Number.isFinite(p)) continue;
    if (p < lo) lo = p;
    if (p > hi) hi = p;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return REPEAT_THRESHOLD;
  const spread = hi - lo;
  if (spread < REPEAT_SPREAD_MIN) return REPEAT_THRESHOLD;
  return Math.max(REPEAT_ABS_MIN, lo + REPEAT_LEVEL * spread);
}

/**
 * @param {object}  opts
 * @param {number[]} opts.pointsMs  analysis grid (bar starts, or an even
 *   split), ascending. Sections can only begin on one of these.
 * @param {object}  opts.pitchFeatures  from PitchTracker.computePitchFeatures
 * @param {object}  opts.energyCurves
 * @param {number}  opts.durationMs
 * @param {number}  opts.minGapMs   minimum time between two cuts
 * @param {number}  opts.maxCuts
 * @returns {?{boundariesMs: number[], labels: number[], cutIndices: number[],
 *   novelty: Float64Array, confidence: number}} null when there isn't enough
 *   material to say anything -- callers fall back to the energy-novelty path.
 */
export function analyzeStructure({
  pointsMs, pitchFeatures, energyCurves, durationMs,
  minGapMs = 11000, maxCuts = 12,
} = {}) {
  if (!Array.isArray(pointsMs) || pointsMs.length < MIN_POINTS) return null;
  if (!pitchFeatures || !pitchFeatures.frames || pitchFeatures.frames.length === 0) return null;

  const feats = buildFeatures(pointsMs, pitchFeatures, energyCurves);
  // Degenerate input (digital silence, a single sustained tone) produces
  // all-zero feature vectors. Their SSM is an identity matrix, and running a
  // checkerboard kernel over an identity matrix yields a perfectly real-
  // looking novelty curve made entirely of the diagonal -- boundaries out of
  // nothing. Bail instead and let the caller keep its own schedule.
  const informative = feats.filter((v) => v.some((x) => x > 0)).length;
  if (informative < feats.length * 0.5) return null;

  const S = selfSimilarity(feats);
  const novelty = footeNovelty(S);

  const peak = Math.max(...novelty);
  if (!(peak > 1e-6)) return null; // featureless input (silence, a pure tone)

  const avgStepMs = (pointsMs[pointsMs.length - 1] - pointsMs[0]) / (pointsMs.length - 1);
  const minGapIdx = Math.max(1, Math.round(minGapMs / Math.max(1, avgStepMs)));

  // Greedy peak picking, strongest first, honoring the spacing floor -- the
  // same discipline the energy-novelty path used, so section pacing is
  // unchanged and only the *choice* of boundary improves.
  const peaks = [];
  const order = Array.from(novelty, (v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const lastIdx = pointsMs.length - 1;
  for (const [v, i] of order) {
    if (peaks.length >= maxCuts) break;
    if (v <= peak * 0.15) break; // noise floor: don't manufacture boundaries
    // Spaced against the song's own edges as well as against each other --
    // index 0 and the final index are always cuts, so a peak crowding either
    // one produces a runt section just as surely as two adjacent peaks do.
    if (i < minGapIdx || lastIdx - i < minGapIdx) continue;
    if (peaks.some((p) => Math.abs(p - i) < minGapIdx)) continue;
    peaks.push(i);
  }
  peaks.sort((a, b) => a - b);

  const cutIndices = [0, ...peaks, pointsMs.length - 1];
  const labels = labelByRepetition(S, cutIndices);

  const boundariesMs = [];
  for (let i = 0; i < cutIndices.length - 1; i++) boundariesMs.push(pointsMs[cutIndices[i]]);

  // Confidence: how far the chosen peaks stand above the typical novelty. A
  // through-composed piece with no repeats and no clear boundaries scores
  // low, and BiomeManager keeps its existing schedule instead.
  let mean = 0, counted = 0;
  for (let i = 0; i < novelty.length; i++) if (novelty[i] > 0) { mean += novelty[i]; counted++; }
  mean = counted > 0 ? mean / counted : 0;
  const contrast = mean > 1e-9 ? clamp01((peak / mean - 1) / 2) : 0;
  const repeats = labels.length - new Set(labels).size; // how much material recurs
  const repeatBonus = clamp01(repeats / Math.max(1, labels.length - 1));
  let confidence = clamp01(0.6 * contrast + 0.4 * repeatBonus);

  // Finding NO structure is not a confident answer. When every candidate was
  // rejected we return the degenerate [0, last] -- a single section covering
  // the whole song -- and `repeatBonus` is structurally 0 there (one label
  // cannot recur), so contrast alone could still carry this to 0.6 and clear
  // BiomeManager's acceptance floor. It would then *override* an energy-novelty
  // read that had found real boundaries, and the song would wear one biome
  // start to finish. A detector that found nothing must say so.
  if (labels.length < 2) confidence = Math.min(confidence, NO_STRUCTURE_CONFIDENCE);

  return { boundariesMs, labels, cutIndices, novelty, confidence };
}
