// Choreography math for the parallax ranges: the traveling ridge wave and
// kick bounce that make the mountains dance, and the geometry of the
// spectrum massif — the one super-distant mountain whose skyline IS a live
// bar graph of the current 7-band frequency content. Pure functions, no
// canvas: BiomeManager consumes these, tests exercise them directly.
import { clamp01 } from '../utils/math.js';

/** Per-layer dance personalities. Near layers move more and bounce sooner;
 *  far layers follow a beat-fraction later — a crowd wave rolling into the
 *  distance. waveLen/phase are deliberately co-prime-ish across layers so
 *  the ranges never move in lockstep. */
export const DANCE_LAYERS = {
  L2: { waveAmp: 3.0, bounceAmp: 2.5, waveLen: 430, waveHz: 0.10, phase: 0.0, delaySec: 0.17 },
  L3: { waveAmp: 4.5, bounceAmp: 4.0, waveLen: 350, waveHz: 0.12, phase: 1.3, delaySec: 0.11 },
  L4: { waveAmp: 6.5, bounceAmp: 6.0, waveLen: 290, waveHz: 0.15, phase: 2.6, delaySec: 0.05 },
  L5: { waveAmp: 8.5, bounceAmp: 8.0, waveLen: 250, waveHz: 0.18, phase: 4.0, delaySec: 0.0 },
};

export const DANCE_COL_W = 128; // strip-space slice width for the ridge wave
const IDLE_DRIVE = 0.15;        // the ranges never stand perfectly still

/**
 * Vertical offset (px, negative = lifted) for one strip column.
 * @param {number} stripX   column position in scroll-stable strip space
 * @param {number} tSec     song time
 * @param {number} groove   smoothed 0..1 global energy (calm-attenuated)
 * @param {number} kick     0..1 kick envelope, already layer-delayed
 * @param {object} cfg      a DANCE_LAYERS entry
 * @param {number} fever    0..1 player fever — steady accurate taps at high
 *                          song energy crank the whole dance up to ~2.8×
 */
export function danceOffset(stripX, tSec, groove, kick, cfg, fever = 0) {
  const mul = 1 + FEVER_DANCE_GAIN * clamp01(fever);
  const drive = IDLE_DRIVE + (1 - IDLE_DRIVE) * clamp01(groove);
  const wave = Math.sin(stripX / cfg.waveLen + tSec * cfg.waveHz * 2 * Math.PI + cfg.phase);
  return (cfg.waveAmp * drive * wave - cfg.bounceAmp * clamp01(kick)) * mul;
}

export const FEVER_DANCE_GAIN = 1.8;

/**
 * Kick envelope at `tauMs` after the (layer-delayed) hit: a 40 ms snap up,
 * then a ~180 ms exponential settle. 0 before the hit reaches this layer.
 */
export function kickEnv(tauMs) {
  if (!(tauMs >= 0)) return 0;
  if (tauMs < 40) return tauMs / 40;
  return Math.exp(-(tauMs - 40) / 180);
}

// Band order across the massif: bass in the middle (band 0 is the lowest,
// most energetic band), treble falling away to the flanks — so the loudest
// content builds the summit and the silhouette stays mountain-shaped.
const MASSIF_ORDER = [5, 3, 1, 0, 2, 4, 6];
// Bell profile: even at total silence the pedestal keeps a mountain outline.
const MASSIF_BELL = [0.30, 0.55, 0.80, 1.00, 0.80, 0.55, 0.30];
const PEDESTAL_FRAC = 0.34; // share of each bar's height that never moves

/**
 * The spectrum massif's bars: for each of the 7 columns (left to right),
 * which band it reads and its 0..1 height — pedestal bell plus the live
 * band level. h01 is always in (0, 1].
 * @param {ArrayLike<number>} eq  7 smoothed band levels, 0..1
 */
export function spectrumBars(eq) {
  return MASSIF_ORDER.map((band, i) => ({
    band,
    h01: MASSIF_BELL[i] * (PEDESTAL_FRAC + (1 - PEDESTAL_FRAC) * clamp01(eq?.[band] ?? 0)),
  }));
}

// Orogeny: how much each range's height grows as the mountains build across
// the song (see OrogenyDirector). Far layers grow the most -- a skyline
// visibly rearing up behind everything -- near layers barely at all, so the
// player's own scale reference never shifts underfoot.
const OROGENY_GROWTH_MUL = { L2: 0.75, L3: 0.55, L4: 0.40, L5: 0.25 };

/** Height multiplier for a layer at orogeny growth g (0..1). g=0 -> 1.0
 *  (baseline height, "not yet built"); g=1 -> the layer's full grown height. */
export function orogenyHeightMul(layerKey, g) {
  const gain = OROGENY_GROWTH_MUL[layerKey] ?? 0;
  return 1 + gain * clamp01(g);
}
