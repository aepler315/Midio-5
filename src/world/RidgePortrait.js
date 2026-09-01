// Ridge portrait: the parallax ranges' OUTLINE, derived from a song.
//
// What was wrong: alpineHeightField placed 3–13 peaks at even intervals
// with random heights, then chewed the skyline with ridged-noise notches
// and teeth. Every song, every biome, got a generic jagged picket fence —
// random AND bland, and musically mute. The live equalizers (spectrum
// massif, GeoCrest) already paint the *now*; orogeny already scales the
// *arc*. The baked silhouette — the thing you actually look at for the
// whole song — was leftover geology from a seed.
//
// What this does instead is an orogenic inversion of two stable parts of
// the sonic profile, neither of which is a waveform or a live EQ:
//
//   1. SPECTRAL MASS (timbre as geology). The 7-band shape is a VERTICAL
//      mass distribution, foot to crest — not a left-to-right spectrogram
//      (that's the massif). Bass is basement rock: broad flanks, high
//      saddles, an altiplano. Mids are the working triangle. Presence/air
//      are the horn at the top. Two songs can share a centroid and still
//      be different rock: a scooped mix (bass+air, empty mids) is a
//      plateau with horns; a mid-forward mix is a classic alpine triangle.
//      Dynamic range sets how far heights spread. Weathering (couloirs,
//      arete teeth) is the high-frequency leftover, and even then, quietly.
//
//   2. ENERGY LANDMARKS (form as composition). The song is sampled at
//      phrase scale (~64 points), prominence-filtered down to a handful
//      of named summits (a drop, a chorus, a bridge — not every kick).
//      Those become the peaks. Placement keeps relative spacing so a
//      song with two choruses flanking a drop reads as two similar
//      summits around a king, but it is a composed skyline, not a
//      scrolling spectrogram: we only keep 3–12 landmarks, we leave
//      margins so the tile wrap is foothills, and we never let the
//      outline move with the beat (that's the dance, already).
//
// Layers read different facets of the same genome so the stack rhymes
// without cloning (L2 = macro form, L3 = timbre, L4 = grain, L5 =
// phrase-scale bass undulation under rolling fbm). Intensity is capped
// on purpose: music decides WHERE the mountains are, HOW they lean, and
// what ROCK they are (the flank's hypsometry). The landform type
// (massif/range/crags) still decides the register.
//
// Pure, DOM-free, deterministic. BiomeManager builds one portrait per
// song and hands it to generateSilhouette; tests exercise every step
// without a canvas.
import { clamp, clamp01, lerp, mulberry32 } from '../utils/math.js';
import { FLAT_WEIGHTS } from '../audio/bands.js';

export const PORTRAIT_SAMPLES = 64;
export const MAX_LANDMARKS = 12;
const MARGIN = 0.12;            // keep peaks off the tile wrap (matches generateSilhouette's blend)
const PROMINENCE_FLOOR = 0.08;  // ripples are not mountains (same idea as SHOULDER_MIN_PROMINENCE)
const MIN_SPACING_SAMPLES = 4;  // ~6% of the song — phrase-scale, not note-scale
const PHRASE_CORR_FLOOR = 0.25;
const SPINE_SMOOTH_PASSES = 3;

/** Per-layer reading of the same portrait. take/min/max control how many
 *  landmarks become summits; phase slides the composition so stacked
 *  ranges don't clone; width/height/spine/weather set the geological
 *  register (far = huge and few, near = grainy and many). */
export const LAYER_ROLES = {
  L2: { take: 0.42, minPeaks: 3, maxPeaks: 5, phase: 0.00, widthMul: 1.18, heightMul: 1.00, spineAmp: 0.10, notchMul: 0.55, teethMul: 0.40, profileMix: 0.55 },
  L3: { take: 0.72, minPeaks: 4, maxPeaks: 7, phase: 0.07, widthMul: 1.00, heightMul: 0.96, spineAmp: 0.08, notchMul: 0.80, teethMul: 0.70, profileMix: 0.72 },
  L4: { take: 1.00, minPeaks: 6, maxPeaks: 11, phase: -0.05, widthMul: 0.82, heightMul: 0.90, spineAmp: 0.06, notchMul: 1.05, teethMul: 1.10, profileMix: 0.38 },
  L5: { take: 0, minPeaks: 0, maxPeaks: 0, phase: 0.11, widthMul: 1, heightMul: 1, spineAmp: 0.22, notchMul: 0, teethMul: 0, profileMix: 0.20 },
};

// Three-term flank, foot → crest. Exponents chosen so the FOOT term is
// fuller than a triangle (mass carried out onto the plain — a shield or
// a plateau), the BODY term is a working alpine shoulder, and the TIP
// is a horn. Weights come from the spectrum; the shape of the mountain
// IS the shape of the mix.
const MASS_FOOT_K = 0.34;
const MASS_BODY_K = 1.05;
const MASS_TIP_K = 2.85;

/** Per-layer tilt of the three-term mass. Distant ranges show basement
 *  (you read the bulk from far away, not the seracs). The mid range is
 *  the timbre layer — spectral geology speaks loudest there. Near crags
 *  tilt toward the crest, where you're close enough to see the horns. */
const LAYER_LITH_TILT = {
  L2: [1.28, 1.04, 0.62],
  L3: [1.00, 1.08, 1.00],
  L4: [0.78, 0.92, 1.35],
  L5: [1.22, 0.90, 0.48],
};

/**
 * Spectral mass as lithology. The 7 bands are a VERTICAL mass distribution
 * from foot (sub/bass) to crest (presence/air). This is the opposite of
 * the spectrum massif, which spreads bands left-to-right; here the mix
 * decides how a single mountain is built, not where the EQ bars sit.
 *
 *   0 SUB       basement / plateau — connecting saddles
 *   1 BASS      body width / bulk  — lower-mid flanks
 *   2 LOW-MID   shoulders          — mass carried high
 *   3 MID       primary structure  — the working triangle
 *   4 HIGH-MID  couloirs           — mid-flank carving
 *   5 PRESENCE  aretes / sub-spires
 *   6 AIR       seracs at the crest
 *
 * `foot`/`mid`/`tip` are the three-term flank weights (sum to 1). A
 * scooped mix (bass+air, empty mids) loads foot AND tip — a plateau with
 * horns. A mid-forward mix loads `mid` — a classic alpine triangle.
 * Floors keep a pure-bass track from losing its summit and a pure-air
 * track from losing its foot.
 */
export function lithologyFromShares(shares) {
  const raw = shares && shares.length >= 7 ? shares : [1, 1, 1, 1, 1, 1, 1];
  let tot = 0;
  for (let i = 0; i < 7; i++) tot += Math.max(0, raw[i] || 0);
  const n = tot > 1e-9 ? tot : 7;
  const b = new Float32Array(7);
  for (let i = 0; i < 7; i++) b[i] = Math.max(0, raw[i] || 0) / n;

  const basement = b[0] + b[1];
  const body = b[2] + b[3];
  const edge = b[4] + b[5];
  const crest = b[5] + b[6];
  const air = b[6];
  // Positive = hollow mids (electronic scoop). Negative = mid-forward.
  const scoop = clamp((basement + crest) - (b[2] + b[3] + b[4]), -1, 1);
  let hypso = 0;
  for (let i = 0; i < 7; i++) hypso += b[i] * (i / 6);

  let foot = Math.max(0.12, basement * 1.18);
  let mid = Math.max(0.16, body * 1.12 + edge * 0.16);
  let tip = Math.max(0.08, crest * 1.22 + air * 0.35);
  const wsum = foot + mid + tip;
  foot /= wsum; mid /= wsum; tip /= wsum;

  return { basement, body, edge, crest, air, scoop, hypso, foot, mid, tip, bands: b };
}

// Per-section landform (mountain overhaul Stage 1): the same 5-rung ladder
// CHARACTER_SCHEMES' three named triples already window into (monumental =
// rungs 0-2, classic = 1-3, jagged = 2-4) -- a section's own spectral
// position + relative energy picks which 3-rung window it gets, so a
// bright, energetic chorus can land on true spires while a dark, quiet
// verse settles on plateau/massif, without inventing a second landform
// vocabulary the rest of the game doesn't already know.
export const LANDFORM_LADDER = ['plateau', 'massif', 'range', 'crags', 'spires'];

/** Which 3-rung window of LANDFORM_LADDER a section lands on, from its
 *  spectral position (bass-heavy 0 .. bright 1) and its energy relative to
 *  the rest of the song (quiet 0 .. loud 1). Both bias the window the same
 *  direction (brighter/louder -> higher rungs -> spires) so the two signals
 *  reinforce rather than fight. */
export function landformWindow(spectralPos01 = 0.5, relEnergy01 = 0.5) {
  const offset = Math.round(clamp01(0.5 * clamp01(spectralPos01) + 0.5 * clamp01(relEnergy01)) * 2);
  return LANDFORM_LADDER.slice(offset, offset + 3);
}

/** Each value's rank against the group's own min..max, 0..1 -- scale
 *  invariant: doubling every input changes none of the outputs, so a quiet
 *  song's chorus still reads as its biggest section and a loud song's
 *  bridge still reads as a lull. A group with no spread (every value
 *  equal) reads as 0.5 everywhere rather than an arbitrary 0 or 1. */
export function relEnergyLadder(energies) {
  if (!energies || energies.length === 0) return [];
  const lo = Math.min(...energies), hi = Math.max(...energies);
  const span = hi - lo;
  return energies.map((e) => (span > 1e-6 ? clamp01((e - lo) / span) : 0.5));
}

/** Tilt the three-term mass toward the layer's geological register. */
export function layerLithology(litho, layerKey = 'L2') {
  const src = litho || lithologyFromShares(null);
  const tilt = LAYER_LITH_TILT[layerKey] || LAYER_LITH_TILT.L2;
  let foot = src.foot * tilt[0];
  let mid = src.mid * tilt[1];
  let tip = src.tip * tilt[2];
  const s = foot + mid + tip;
  if (s > 1e-9) { foot /= s; mid /= s; tip /= s; }
  return { ...src, foot, mid, tip };
}

/**
 * Unit-height flank at normalized distance `d` (0 at the summit, 1 at the
 * foot). Three power laws, weighted by the song's lithology — the spectrum
 * IS the mountain's cross-section. Always 1 at d=0 and 0 at d>=1.
 */
export function massProfile(d, litho) {
  const t = Math.max(0, 1 - Math.max(0, d));
  if (t <= 0 || !litho) return 0;
  return litho.foot * Math.pow(t, MASS_FOOT_K)
    + litho.mid * Math.pow(t, MASS_BODY_K)
    + litho.tip * Math.pow(t, MASS_TIP_K);
}

function boxBlur(src, radius = 1) {
  const n = src.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      s += src[j];
      c++;
    }
    out[i] = c ? s / c : src[i];
  }
  return out;
}

function herfindahlSpread01(shares) {
  // 0 when a single band owns everything, 1 when the spectrum is flat.
  let hhi = 0;
  for (let i = 0; i < shares.length; i++) hhi += shares[i] * shares[i];
  const min = 1 / shares.length;
  return clamp01((1 - hhi) / (1 - min));
}

function centroid01(shares) {
  let wsum = 0, sum = 0;
  for (let b = 0; b < shares.length; b++) {
    wsum += shares[b] * b;
    sum += shares[b];
  }
  return sum > 1e-9 ? wsum / ((shares.length - 1) * sum) : 0.5;
}

function brightnessOf(bands) {
  let num = 0, den = 0;
  for (let b = 0; b < 7; b++) {
    const v = Math.max(0, bands[b] || 0);
    num += v * b;
    den += v;
  }
  return den > 1e-9 ? num / (6 * den) : 0.5;
}

/**
 * Phrase-scale energy wave, 0..1, length PORTRAIT_SAMPLES. Uses the song's
 * own normalized energy so a quiet master and a brickwalled one draw the
 * same landmarks.
 *
 * `window` ({startMs, endMs}), when given, samples only that span of the
 * song (a single section's own timeline) instead of the whole track --
 * everything else about the read (normalization, blur) is identical, so a
 * windowed read and a whole-song read differ only in WHERE they look.
 * Omitted (the default), this is byte-identical to the original whole-song
 * call -- existing callers/tests are unaffected.
 */
export function sampleEnergyWave(energyCurves, durationMs, samples = PORTRAIT_SAMPLES, window = null) {
  const n = Math.max(8, samples | 0);
  const wave = new Float32Array(n);
  const winStart = window ? Math.max(0, window.startMs) : 0;
  const winEnd = window ? Math.min(durationMs, window.endMs) : durationMs;
  const dur = Math.max(1, winEnd - winStart);
  const hasNorm = typeof energyCurves.globalEnergyNorm === 'function';
  for (let i = 0; i < n; i++) {
    const tMs = winStart + (i / Math.max(1, n - 1)) * dur;
    const e = hasNorm
      ? energyCurves.globalEnergyNorm(tMs, FLAT_WEIGHTS)
      : energyCurves.globalEnergy(tMs, FLAT_WEIGHTS);
    wave[i] = clamp01(e);
  }
  return boxBlur(wave, 1);
}

/**
 * Topographic prominence on a 1-D wave. A local max only counts as a
 * landmark if it stands `prominenceFloor` above the higher of the two
 * valleys that bound it, and no two kept landmarks sit closer than
 * `minSpacing` samples. Tallest-first, so the cap keeps the mountains
 * that matter — same selection idea as BiomeManager._ridgePeaks.
 */
export function findLandmarks(wave, {
  minSpacing = MIN_SPACING_SAMPLES,
  maxCount = MAX_LANDMARKS,
  prominenceFloor = PROMINENCE_FLOOR,
} = {}) {
  const n = wave.length;
  const maxima = [];
  for (let i = 1; i < n - 1; i++) {
    if (wave[i] >= wave[i - 1] && wave[i] > wave[i + 1]) maxima.push(i);
  }
  const scored = maxima.map((i) => {
    let left = wave[i], right = wave[i];
    for (let j = i - 1; j >= 0; j--) {
      if (wave[j] > wave[i]) break;
      if (wave[j] < left) left = wave[j];
    }
    for (let j = i + 1; j < n; j++) {
      if (wave[j] > wave[i]) break;
      if (wave[j] < right) right = wave[j];
    }
    return { i, energy: wave[i], prominence: wave[i] - Math.max(left, right) };
  });
  scored.sort((a, b) => b.prominence - a.prominence || b.energy - a.energy);

  const kept = [];
  for (const s of scored) {
    if (s.prominence < prominenceFloor) continue;
    if (kept.some((k) => Math.abs(k.i - s.i) < minSpacing)) continue;
    kept.push(s);
    if (kept.length >= maxCount) break;
  }

  // A song that just gets loud and stays loud has no local max. Treat the
  // high plateau's centre as a single broad summit so we never fall back
  // to a random picket fence on a real track.
  if (kept.length === 0 && n > 2) {
    let maxE = -Infinity, maxI = Math.floor(n / 2);
    for (let i = 0; i < n; i++) if (wave[i] > maxE) { maxE = wave[i]; maxI = i; }
    if (maxE > 0.05) kept.push({ i: maxI, energy: maxE, prominence: maxE });
  }
  return kept;
}

function landmarkWidth01(wave, i) {
  const half = wave[i] * 0.55;
  let lo = i, hi = i;
  while (lo > 0 && wave[lo] >= half) lo--;
  while (hi < wave.length - 1 && wave[hi] >= half) hi++;
  return clamp01((hi - lo) / Math.max(1, wave.length));
}

function landmarkAttack(wave, i) {
  const span = Math.max(2, Math.round(wave.length * 0.06));
  const pre = wave[Math.max(0, i - span)];
  const post = wave[Math.min(wave.length - 1, i + span)];
  const rise = Math.max(0, wave[i] - pre);
  const fall = Math.max(0, wave[i] - post);
  return (rise - fall) / (rise + fall + 1e-6); // [-1, 1]: drop → + (steeper left)
}

/**
 * Autocorrelation of the energy wave over phrase-to-section lags. A clear
 * period (verse loop, four-on-the-floor hypermeter) becomes the nearest
 * hills' undulation so the foothills breathe at the song's own scale
 * without tracing the full envelope.
 */
export function phrasePeriod(wave) {
  const n = wave.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += wave[i];
  mean /= n;
  const c = new Float32Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    c[i] = wave[i] - mean;
    energy += c[i] * c[i];
  }
  const empty = { period01: 0, strength: 0, phrase: new Float32Array(16) };
  if (energy < 1e-9) return empty;

  let bestLag = 0, best = 0;
  const lo = 4, hi = Math.min(20, Math.floor(n / 2));
  const ac = new Float64Array(hi + 2);
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    if (lag < 1 || lag >= n) continue;
    let dot = 0;
    for (let i = 0; i < n - lag; i++) dot += c[i] * c[i + lag];
    ac[lag] = dot / energy;
  }
  // A slow trend (a drone, a single swell) has a monotonically falling
  // autocorrelation — high at lag 4, higher at lag 3, never a peak in the
  // phrase window. A repeating verse has a bump at its period. We only
  // accept a local maximum, so the drone doesn't invent a "phrase".
  for (let lag = lo; lag <= hi; lag++) {
    if (ac[lag] >= ac[lag - 1] && ac[lag] > ac[lag + 1] && ac[lag] > best) {
      best = ac[lag];
      bestLag = lag;
    }
  }
  if (best < PHRASE_CORR_FLOOR || bestLag < lo) return empty;

  const phrase = new Float32Array(bestLag);
  const cycles = Math.max(1, Math.floor(n / bestLag));
  for (let k = 0; k < bestLag; k++) {
    let s = 0, cnt = 0;
    for (let cyc = 0; cyc < cycles; cyc++) {
      const j = cyc * bestLag + k;
      if (j < n) { s += wave[j]; cnt++; }
    }
    phrase[k] = cnt ? s / cnt : 0;
  }
  let pMin = Infinity, pMax = -Infinity;
  for (let k = 0; k < phrase.length; k++) {
    if (phrase[k] < pMin) pMin = phrase[k];
    if (phrase[k] > pMax) pMax = phrase[k];
  }
  const span = pMax - pMin;
  if (span > 1e-6) {
    for (let k = 0; k < phrase.length; k++) phrase[k] = (phrase[k] - pMin) / span;
  }
  return { period01: bestLag / n, strength: clamp01(best), phrase };
}

function meanShares(energyCurves) {
  const shares = new Float32Array(7);
  const n = energyCurves.n || 0;
  if (!energyCurves.bands || n < 1) {
    shares.fill(1 / 7);
    return shares;
  }
  const sums = new Float64Array(7);
  for (let i = 0; i < n; i++) {
    for (let b = 0; b < 7; b++) sums[b] += Math.max(0, energyCurves.bands[b][i] || 0);
  }
  let tot = 0;
  for (let b = 0; b < 7; b++) tot += sums[b];
  if (tot < 1e-9) {
    shares.fill(1 / 7);
    return shares;
  }
  for (let b = 0; b < 7; b++) shares[b] = sums[b] / tot;
  return shares;
}

function smoothSpine(wave) {
  let s = wave;
  for (let p = 0; p < SPINE_SMOOTH_PASSES; p++) s = boxBlur(s, 3);
  return s;
}

/**
 * Compact, stable reading of a song. Returns null when there isn't enough
 * signal to hang a range on — callers fall back to seeded geology.
 *
 * @param {import('../audio/EnergyCurves.js').EnergyCurves|null} energyCurves
 * @param {number} durationMs
 * @param {{startMs:number,endMs:number}|null} window restrict the read to
 *   one span of the song (a section's own timeline) instead of the whole
 *   track. Omitted (the default) is byte-identical to a whole-song read.
 */
export function extractRidgePortrait(energyCurves, durationMs, window = null) {
  if (!energyCurves || !(durationMs > 1000)) return null;
  if (!energyCurves.bands || !(energyCurves.n >= 8)) return null;

  const winStart = window ? Math.max(0, window.startMs) : 0;
  const winEnd = window ? Math.min(durationMs, window.endMs) : durationMs;
  const winDur = Math.max(1, winEnd - winStart);

  const shares = meanShares(energyCurves);
  const wave = sampleEnergyWave(energyCurves, durationMs, PORTRAIT_SAMPLES, window);
  const rawLandmarks = findLandmarks(wave);
  const hasSampleAll = typeof energyCurves.sampleAll === 'function';

  const landmarks = rawLandmarks.map((lm) => {
    const t01 = lm.i / Math.max(1, wave.length - 1);
    const tMs = winStart + t01 * winDur;
    const bands = hasSampleAll ? energyCurves.sampleAll(tMs) : null;
    return {
      t01,
      energy: lm.energy,
      prominence: lm.prominence,
      brightness: bands ? brightnessOf(bands) : 0.5,
      attack: landmarkAttack(wave, lm.i),
      width01: landmarkWidth01(wave, lm.i),
    };
  });

  let dyn = 0.4;
  if (typeof energyCurves.calibration === 'function') {
    const cal = energyCurves.calibration(FLAT_WEIGHTS);
    dyn = clamp01((cal?.spread ?? 0.2) / 0.5);
  }

  const phrase = phrasePeriod(wave);
  const lithology = lithologyFromShares(shares);
  const bassShare = lithology.basement;
  const bodyShare = lithology.body;
  const edgeShare = lithology.edge;
  const airShare = lithology.air;

  return {
    shares,
    centroid01: centroid01(shares),
    spread01: herfindahlSpread01(shares),
    bassShare,
    bodyShare,
    edgeShare,
    airShare,
    lithology,
    dynamicRange: dyn,
    landmarks,
    phrasePeriod01: phrase.period01,
    phraseStrength: phrase.strength,
    phraseWave: phrase.phrase,
    energyWave: wave,
    spine: smoothSpine(wave),
  };
}

function sampleLoop(arr, u) {
  if (!arr || arr.length === 0) return 0;
  const n = arr.length;
  const x = ((u % 1) + 1) % 1 * n;
  const i0 = Math.floor(x) % n;
  const i1 = (i0 + 1) % n;
  const f = x - Math.floor(x);
  return arr[i0] * (1 - f) + arr[i1] * f;
}

/** 0..1 spine height at strip-normalized x. Tiny on purpose — a family
 *  resemblance under the named summits, not a second skyline. */
export function spineAt(portrait, u01, amp = 0.08) {
  if (!portrait?.spine) return 0;
  return amp * sampleLoop(portrait.spine, u01);
}

/** Phrase-shaped undulation for the nearest rolling hills. */
export function phraseAt(portrait, u01) {
  if (!portrait?.phraseWave || portrait.phraseWave.length < 4) return 0;
  return sampleLoop(portrait.phraseWave, u01);
}

function resolveCollisions(placed, minSep) {
  // A few relaxation passes: the less prominent peak yields. Drop a peak
  // that still collides after being pushed to the margin — better fewer
  // readable summits than a hairball.
  const out = placed.map((p) => ({ ...p }));
  out.sort((a, b) => a.u - b.u);
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < out.length; i++) {
      const gap = out[i].u - out[i - 1].u;
      if (gap >= minSep) continue;
      const push = (minSep - gap) / 2 + 0.002;
      if (out[i].prominence <= out[i - 1].prominence) {
        out[i].u = Math.min(1 - MARGIN, out[i].u + push);
      } else {
        out[i - 1].u = Math.max(MARGIN, out[i - 1].u - push);
      }
    }
    out.sort((a, b) => a.u - b.u);
  }
  const kept = [];
  for (const p of out) {
    if (kept.length && p.u - kept[kept.length - 1].u < minSep * 0.72) {
      if (p.prominence > kept[kept.length - 1].prominence) kept[kept.length - 1] = p;
      continue;
    }
    kept.push(p);
  }
  return kept;
}

function fillGaps(placed, need, rand, minSep) {
  const out = placed.slice();
  let guard = 0;
  while (out.length < need && guard++ < 24) {
    out.sort((a, b) => a.u - b.u);
    let bestGap = 0, bestAt = 0.5, left = null, right = null;
    const edges = [{ u: MARGIN, prominence: 0, energy: 0.3, brightness: 0.5, attack: 0, width01: 0.12 }, ...out, { u: 1 - MARGIN, prominence: 0, energy: 0.3, brightness: 0.5, attack: 0, width01: 0.12 }];
    for (let i = 1; i < edges.length; i++) {
      const gap = edges[i].u - edges[i - 1].u;
      if (gap > bestGap) {
        bestGap = gap;
        bestAt = (edges[i].u + edges[i - 1].u) / 2;
        left = edges[i - 1];
        right = edges[i];
      }
    }
    if (bestGap < minSep * 1.6) break;
    const jitter = (rand() - 0.5) * Math.min(0.04, bestGap * 0.2);
    const parent = (left && right)
      ? (left.prominence >= right.prominence ? left : right)
      : (left || right);
    out.push({
      u: clamp(bestAt + jitter, MARGIN, 1 - MARGIN),
      energy: (parent?.energy ?? 0.4) * (0.42 + rand() * 0.18),
      prominence: (parent?.prominence ?? 0.2) * (0.32 + rand() * 0.18),
      brightness: parent?.brightness ?? 0.5,
      attack: (rand() - 0.5) * 0.6,
      width01: (parent?.width01 ?? 0.12) * (0.7 + rand() * 0.25),
      fill: true,
    });
  }
  return out;
}

/**
 * Compose a mountain-range peak list from a portrait. Same `{x,h,w,wL,wR}`
 * shape alpineHeightField already consumes. `cfg` is an ALPINE_CHARACTERS
 * entry (passed in to avoid a circular import).
 *
 * Placement is a *composition*, not a timeline: landmarks keep their
 * relative order and spacing (so two choruses around a drop still read
 * as two similar summits around a king) but the whole set is centred on
 * the song's energy-weighted mass and slid by the layer's phase so the
 * four ranges rhyme without stacking as copies.
 */
export function composeAlpinePeaks({ portrait, cfg, layerKey = 'L2', seed, width }) {
  const role = LAYER_ROLES[layerKey] || LAYER_ROLES.L2;
  const rand = mulberry32((seed ^ 0xc0de) >>> 0 || 1);
  const lms = portrait?.landmarks?.slice() || [];
  lms.sort((a, b) => b.prominence - a.prominence);

  const want = clamp(
    Math.round(Math.max(role.minPeaks, Math.min(role.maxPeaks, lms.length * role.take + (portrait?.centroid01 ?? 0.5) * 1.2))),
    role.minPeaks,
    role.maxPeaks,
  );
  const taken = lms.slice(0, Math.max(1, Math.min(lms.length, Math.max(want, role.minPeaks))));

  // Mass centre of the song's energy landmarks: back-loaded songs sit
  // their king slightly right of centre, front-loaded slightly left.
  // Never dead-centre — that was the bland part of the old generator.
  let mass = 0, massW = 0;
  for (const lm of taken) {
    const w = Math.max(0.05, lm.energy);
    mass += lm.t01 * w;
    massW += w;
  }
  const massCenter = massW > 0 ? mass / massW : 0.5;
  const kingU = lerp(0.36, 0.64, clamp01(massCenter));
  // Per-biome / per-layer slide: the genome stays the same (relative
  // spacing, king identity) but the composition isn't stamped identically
  // onto every range. Small on purpose — enough that TWILIGHT and EMBER
  // don't share a stencil, not enough to scramble the song's architecture.
  const slide = (rand() - 0.5) * 0.06;

  if (taken.length === 0) return [];

  const times = taken.map((lm) => lm.t01);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const span = Math.max(0.18, tMax - tMin);
  const usable = 1 - 2 * MARGIN;
  const king = taken.reduce((a, b) => (b.prominence > a.prominence ? b : a), taken[0]);
  const uRaw = (t) => MARGIN + ((t - tMin) / span) * usable;
  const shift = kingU - uRaw(king.t01) + role.phase + slide;

  const placed = taken.map((lm) => ({
    ...lm,
    u: clamp(uRaw(lm.t01) + shift + (rand() - 0.5) * 0.02, MARGIN, 1 - MARGIN),
  }));

  const minSep = layerKey === 'L2' ? 0.11 : layerKey === 'L3' ? 0.08 : 0.055;
  let resolved = resolveCollisions(placed, minSep);
  if (resolved.length < want) resolved = fillGaps(resolved, want, rand, minSep);
  resolved = resolveCollisions(resolved, minSep);

  const maxProm = Math.max(...resolved.map((p) => p.prominence), 1e-6);
  const dyn = portrait?.dynamicRange ?? 0.4;
  // Flat songs bunch heights (0.68–0.92); dynamic ones get a real 0.50–1.0.
  const hLo = lerp(0.68, 0.50, dyn);
  const hHi = lerp(0.90, 1.00, dyn);
  const bass = portrait?.bassShare ?? 0.3;
  const centroid = portrait?.centroid01 ?? 0.5;
  const widthBias = lerp(1.22, 0.82, centroid) * role.widthMul;

  const peaks = resolved.map((p, idx) => {
    const isKing = p.prominence >= maxProm * 0.97 && idx === resolved.findIndex((q) => q.prominence >= maxProm * 0.97);
    const rel = clamp01(p.prominence / maxProm);
    // Fill peaks (geological extras) stay subordinate so they don't compete
    // with the song's actual landmarks.
    const fillMul = p.fill ? 0.62 : 1;
    let h = lerp(hLo, hHi, Math.pow(rel, 0.72)) * role.heightMul * fillMul;
    if (isKing) h = Math.max(h, lerp(0.92, 0.98, dyn));
    h = clamp(h, 0.42, 1);

    const eventW = clamp01(p.width01);
    // Bright landmarks (presence/air) are thinner spires; dark/bass ones
    // are bulky. A long chorus is a broad mountain, a sharp drop is a horn.
    const brightMul = lerp(1.18, 0.78, clamp01(p.brightness));
    let w = (cfg.wBase + eventW * cfg.wSpan) * widthBias * brightMul;
    if (isKing) w = Math.max(w, cfg.wBase * (1.22 + bass * 0.35));
    w = Math.max(28, w);

    const lean = 1 + cfg.asym * clamp(p.attack, -1, 1) * 0.9;
    return {
      x: p.u * width,
      h,
      w,
      wL: w * lean,
      wR: w / Math.max(0.35, lean),
      king: isKing,
    };
  });

  // Guarantee a king even if prominence ties.
  if (peaks.length && !peaks.some((p) => p.king)) {
    let best = 0;
    for (let i = 1; i < peaks.length; i++) if (peaks[i].h > peaks[best].h) best = i;
    peaks[best].king = true;
    peaks[best].h = Math.max(peaks[best].h, 0.94);
  }
  return peaks;
}

/**
 * Weathering + lithology for a layer. Bass lifts the connecting bed and
 * the apron cap (high saddles — an altiplano). Air/edge add couloirs and
 * arete teeth — scaled down from the old constants so the named summits
 * actually read. `litho` and `profileMix` are what alpineHeightField
 * uses to blend the song's three-term flank onto the landform type.
 */
export function layerWeathering(portrait, cfg, layerKey = 'L2') {
  const role = LAYER_ROLES[layerKey] || LAYER_ROLES.L2;
  const litho = layerLithology(portrait?.lithology || lithologyFromShares(portrait?.shares), layerKey);
  const basement = litho.basement;
  const edge = litho.edge;
  const air = litho.air;
  const crest = litho.crest;
  const spread = portrait?.spread01 ?? 0.5;
  return {
    notch: cfg.notch * role.notchMul * (0.38 + 0.85 * edge),
    teeth: cfg.teeth * role.teethMul * (0.28 + 0.90 * air + 0.12 * spread),
    bed: cfg.bed * (0.70 + 0.95 * basement),
    apronGain: cfg.apronGain * (0.85 + 0.42 * basement),
    apronCap: clamp(cfg.apronCap + basement * 0.20 - crest * 0.14, 0.36, 0.64),
    apronSpread: clamp(cfg.apronSpread + basement * 0.50 - edge * 0.28, 1.8, 3.4),
    spineAmp: role.spineAmp,
    profileMix: role.profileMix ?? 0.55,
    litho,
  };
}

/**
 * Seeded fallback when there's no portrait (tests, missing curves). Dart-
 * throwing instead of even spacing so the no-music path isn't a picket
 * fence either; the king is the tallest peak, not the centre one.
 */
export function seedPeaks(cfg, seed, width) {
  const rand = mulberry32((seed ^ 0xa1b1) >>> 0 || 1);
  const nPeaks = cfg.peakMin + Math.floor(rand() * cfg.peakSpan);
  const minSep = 0.52 / Math.max(1, nPeaks);
  const us = [];
  let attempts = 0;
  while (us.length < nPeaks && attempts < 100) {
    attempts++;
    const u = MARGIN + rand() * (1 - 2 * MARGIN);
    if (us.every((v) => Math.abs(v - u) >= minSep)) us.push(u);
  }
  if (us.length < nPeaks) {
    for (let i = us.length; i < nPeaks; i++) us.push(MARGIN + ((i + 0.5) / nPeaks) * (1 - 2 * MARGIN));
  }
  us.sort((a, b) => a - b);

  const peaks = us.map((u) => {
    const w = cfg.wBase + rand() * cfg.wSpan;
    const lean = 1 + (rand() * 2 - 1) * cfg.asym;
    return {
      x: clamp01(u) * width,
      h: 0.52 + rand() * 0.38,
      w,
      wL: w * lean,
      wR: w / lean,
      king: false,
    };
  });
  let best = 0;
  for (let i = 1; i < peaks.length; i++) if (peaks[i].h > peaks[best].h) best = i;
  const main = peaks[best];
  main.h = Math.max(main.h, 0.94 + rand() * 0.06);
  const kingW = Math.max(main.w, cfg.wBase * (1.25 + rand() * 0.4));
  const kingLean = 1 + (rand() * 2 - 1) * cfg.asym;
  main.w = kingW;
  main.wL = kingW * kingLean;
  main.wR = kingW / kingLean;
  main.king = true;
  return peaks;
}
