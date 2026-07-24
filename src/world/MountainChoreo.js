// Choreography math for the parallax ranges: the traveling ridge wave and
// kick bounce that make the mountains dance, geometric scale/shear that
// turns the dance into real silhouette morphing (not just a vertical
// blit), and the spectrum massif — the one super-distant mountain whose
// skyline IS a live bar graph of the current 7-band frequency content.
// Pure functions, no canvas: BiomeManager consumes these, tests exercise
// them directly.
import { clamp01 } from '../utils/math.js';

/** Per-layer dance personalities. Near layers move more and bounce sooner;
 *  far layers follow a beat-fraction later — a crowd wave rolling into the
 *  distance. waveLen/phase are deliberately co-prime-ish across layers so
 *  the ranges never move in lockstep. scaleAmp / shearAmp drive the
 *  geometric (stretch + sway) half of the animation. */
export const DANCE_LAYERS = {
  L2:  { waveAmp: 2.5, bounceAmp: 2.0, waveLen: 460, waveHz: 0.09, phase: 0.0, delaySec: 0.19, scaleAmp: 0.035, shearAmp: 1.2 },
  L2b: { waveAmp: 3.4, bounceAmp: 3.0, waveLen: 400, waveHz: 0.105, phase: 0.7, delaySec: 0.14, scaleAmp: 0.045, shearAmp: 1.8 },
  L3:  { waveAmp: 4.2, bounceAmp: 3.8, waveLen: 350, waveHz: 0.12, phase: 1.3, delaySec: 0.11, scaleAmp: 0.055, shearAmp: 2.4 },
  L4:  { waveAmp: 6.0, bounceAmp: 5.5, waveLen: 290, waveHz: 0.15, phase: 2.6, delaySec: 0.05, scaleAmp: 0.07,  shearAmp: 3.2 },
  L5:  { waveAmp: 7.5, bounceAmp: 7.0, waveLen: 250, waveHz: 0.18, phase: 4.0, delaySec: 0.0,  scaleAmp: 0.09,  shearAmp: 4.0 },
};

export const DANCE_COL_W = 64; // finer columns so geometric stretch reads continuous
const IDLE_DRIVE = 0.15;        // the ranges never stand perfectly still
export const FEVER_DANCE_GAIN = 1.8;

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
  // Primary traveling wave + a co-prime secondary harmonic so the ridge
  // never collapses into a single sinusoid (geometric multi-mode motion).
  const th = stripX / cfg.waveLen + tSec * cfg.waveHz * 2 * Math.PI + cfg.phase;
  const wave = Math.sin(th) + 0.35 * Math.sin(th * 1.7 + 0.9);
  return (cfg.waveAmp * drive * wave - cfg.bounceAmp * clamp01(kick)) * mul;
}

/**
 * Geometric deformation for one strip column: vertical stretch (peaks
 * breathe) and a small horizontal shear (the range sways). Returns
 * scaleY around 1 and shear in px. Kick expands the silhouette briefly
 * instead of only translating it. Fever amplifies both channels.
 */
export function danceGeom(stripX, tSec, groove, kick, cfg, fever = 0) {
  const mul = 1 + FEVER_DANCE_GAIN * clamp01(fever) * 0.55;
  const drive = IDLE_DRIVE + (1 - IDLE_DRIVE) * clamp01(groove);
  const th = stripX / cfg.waveLen + tSec * cfg.waveHz * 2 * Math.PI + cfg.phase;
  const breathe = Math.sin(th * 0.85 + 0.4);
  const sway = Math.sin(th * 0.55 + tSec * 0.31 + cfg.phase * 0.5);
  const k = clamp01(kick);
  const scaleAmp = (cfg.scaleAmp ?? 0.06) * mul;
  const shearAmp = (cfg.shearAmp ?? 2.5) * mul;
  // Kick lifts scale (range "stands up"), wave breathes around 1.
  const scaleY = 1 + scaleAmp * drive * breathe + scaleAmp * 1.4 * k;
  const shear = shearAmp * drive * sway;
  return { scaleY, shear };
}

/**
 * Full geometric dance sample: offset + scale + shear in one call so the
 * draw path doesn't recompute the wave thrice.
 */
export function danceSample(stripX, tSec, groove, kick, cfg, fever = 0) {
  const dy = danceOffset(stripX, tSec, groove, kick, cfg, fever);
  const g = danceGeom(stripX, tSec, groove, kick, cfg, fever);
  return { dy, scaleY: g.scaleY, shear: g.shear };
}

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
