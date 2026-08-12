// Choreography math for the parallax ranges: the traveling ridge wave and
// kick bounce that make the mountains dance, and the geometry of the
// spectrum massif — the one super-distant mountain whose skyline IS a live
// bar graph of the current 7-band frequency content. Pure functions, no
// canvas: BiomeManager consumes these, tests exercise them directly.
import { clamp01 } from '../utils/math.js';

/** Per-layer dance personalities.
 *
 *  The drama belongs to the FAR ranges. This used to run the other way --
 *  the nearest hills heaved hardest and bounced first, with the wave
 *  rolling away into the distance -- and it read badly: the biggest, most
 *  violent motion was the thing sitting closest to the camera, right behind
 *  the characters, so the foreground flapped while the horizon sat still.
 *  Reversed, the same choreography reads as intended: a huge slow skyline
 *  heaving away in the distance, the ground underfoot comparatively steady,
 *  and the kick wave rolling FORWARD out of the back of the scene.
 *
 *  waveLen/waveHz/phase stay as they were and are deliberately co-prime-ish
 *  across layers, so the ranges never move in lockstep. */
export const DANCE_LAYERS = {
  L2: { waveAmp: 11.5, bounceAmp: 10.8, waveLen: 430, waveHz: 0.10, phase: 0.0, delaySec: 0.0 },
  L3: { waveAmp: 8.8, bounceAmp: 8.1, waveLen: 350, waveHz: 0.12, phase: 1.3, delaySec: 0.05 },
  L4: { waveAmp: 6.1, bounceAmp: 5.4, waveLen: 290, waveHz: 0.15, phase: 2.6, delaySec: 0.11 },
  L5: { waveAmp: 4.1, bounceAmp: 3.4, waveLen: 250, waveHz: 0.18, phase: 4.0, delaySec: 0.17 },
};

// Strip-space slice width for the ridge wave. Halved from 128: each slice
// is blitted at its own vertical offset, which also shifts the depth
// gradient baked into the strip, so at every slice boundary the same screen
// row samples a different part of that gradient -- a hard vertical shade
// step marching across the range as it dances. The step scales with the
// offset difference between neighbours, so narrower slices shrink it
// proportionally (the crest stroke and GeoCrest's danceOffsetSmooth both
// derive from this constant, so they follow automatically).
export const DANCE_COL_W = 64;
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

export const FEVER_DANCE_GAIN = 2.4; // fever now cranks the dance up to ~3.4x

/** The range Midio takes his cue from: the furthest, biggest-moving skyline
 *  (see DANCE_LAYERS -- L2 has the largest waveAmp/bounceAmp of the four). */
export const FAR_DANCE_LAYER = 'L2';

/** How much of a kick the swell reading gives away. Small on purpose: the
 *  beat gets a vote on exactly when the gate opens, the slow swell decides
 *  whether it opens at all. */
export const SWELL_KICK_GAIN = 0.18;

/**
 * How high one column of a range is heaved right now, as a scale-free 0..1
 * ("0 = this column is at the bottom of its own swing, 1 = at the top").
 *
 * This is danceOffset's own lift, normalized: the wave term is the same
 * sine, read with the sign flipped so up reads high, and the kick term is
 * the same envelope (a kick lifts the range, hence a positive contribution).
 * What is deliberately dropped is every amplitude factor -- waveAmp,
 * bounceAmp, groove, fever, terrainEnergy, orogeny. A gate built on absolute
 * pixels would swing wide open under fever and clamp shut in a flat, low-
 * energy biome (terrainEnergy near 0 flattens the dance to nothing); read in
 * phase instead, "the skyline near the top of its current swing" means the
 * same thing in every section of every song.
 */
export function ridgeSwell01(stripX, tSec, cfg, kick = 0) {
  const wave = Math.sin(stripX / cfg.waveLen + tSec * cfg.waveHz * 2 * Math.PI + cfg.phase);
  return clamp01(0.5 - 0.5 * wave + SWELL_KICK_GAIN * clamp01(kick));
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

// Orogeny: how much each range's height grows as the mountains build across
// the song (see OrogenyDirector). Far layers grow the most -- a skyline
// visibly rearing up behind everything -- near layers barely at all, so the
// player's own scale reference never shifts underfoot.
// Gains are modest: the hard frame-fit in mountainStripDrawHeight is the
// real ceiling. Huge multipliers only ever made invisible off-screen mesas.
const OROGENY_GROWTH_MUL = { L2: 0.42, L3: 0.32, L4: 0.22, L5: 0.12 };

/** Height multiplier for a layer at orogeny growth g (0..1). g=0 -> 1.0
 *  (baseline height, "not yet built"); g=1 -> the layer's full grown height. */
export function orogenyHeightMul(layerKey, g) {
  const gain = OROGENY_GROWTH_MUL[layerKey] ?? 0;
  return 1 + gain * clamp01(g);
}

/**
 * Top of screen reserved for sky / celestial / upper ocean. Peaks that would
 * sit above this are clipped by the frame — they may as well not exist.
 * ~0.16 leaves the ocean horizon (≈0.26) and some open sky readable.
 */
export const MOUNTAIN_SKY_HEADROOM_FRAC = 0.16;

/** Bounce/wave lift budget so a kick doesn't shove a fitted peak off the top. */
const MOUNTAIN_DANCE_PAD_PX = 22;

/**
 * Screen-space strip draw height (px), anchored at groundY+40.
 * Caps orogeny so the range top never leaves the frame.
 *
 * @param {number} stripHeight  baked strip bitmap height
 * @param {number} growthMul    from orogenyHeightMul
 * @param {number} canvasHeight stage height
 * @param {number} groundY      playable ground line
 */
export function mountainStripDrawHeight(stripHeight, growthMul, canvasHeight, groundY) {
  const desired = Math.max(1, stripHeight) * Math.max(0.05, growthMul);
  const bottom = groundY + 40;
  const topMin = canvasHeight * MOUNTAIN_SKY_HEADROOM_FRAC;
  const maxDh = Math.max(96, bottom - topMin - MOUNTAIN_DANCE_PAD_PX);
  return Math.min(desired, maxDh);
}
