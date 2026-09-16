// Cathode's musical envelope.
//
// A CRT is not a mountain. Shared WorldMusic sample, interpreted as raster,
// phosphor and sprite hits -- never as haze, bloom or orogeny. The existing
// beat-flinch and drop-tear stay; what they were missing is density. A 170
// BPM lock must not strobe the boss, and vibe.epic is a gameplay meter, not
// a song measurement.
//
// Raster travel is an inverted-U on the 1.2s energy average: quiet crawls,
// a groove cruises, dense material drops to half-time so the floor does not
// strobe. Phosphor is the same 1.2s bass. Isolated accents flash the screen;
// dense material raises the floor so only stronger hits mark the tube.
// Returning structural labels pick a scan motif; decorative cuts keep the
// default raster. Reduced flash kills the flinch, the tear and the screen
// hit, and halves the grid.
//
// Pure and causal. A rate held in a field would survive a backward seek.
import { clamp01, lerp } from '../../utils/math.js';
import { boundaryLift01 } from '../WorldMusic.js';
import { beatFlinchScale, FLINCH_SCALE } from './CathodeBoss.js';

const CRAWL = 18;
const CRUISE = 56;
const HALF_TIME = 28;
const PEAK_AT = 0.40;

const PHOSPHOR_FLOOR = 0.08;
const PHOSPHOR_CEIL = 0.72;

export { boundaryLift01, FLINCH_SCALE };

/**
 * Ground-grid travel, px/sec. Inverted-U so the densest material does not
 * strobe the floor. Reduced flash halves it. Quiet input still crawls --
 * a frozen grid reads as a paused machine, not a verse.
 */
export function rasterRate(energy = 0, reducedFlash = false) {
  const e = clamp01(energy);
  let rate;
  if (e <= PEAK_AT) rate = lerp(CRAWL, CRUISE, e / PEAK_AT);
  else rate = lerp(CRUISE, HALF_TIME, (e - PEAK_AT) / (1 - PEAK_AT));
  if (reducedFlash) rate *= 0.5;
  return rate;
}

/** Screen-weight from sustained bass, never a single-frame sample. */
export function phosphorGlow(bass = 0) {
  return lerp(PHOSPHOR_FLOOR, PHOSPHOR_CEIL, clamp01(bass));
}

/**
 * How much of a screen-flash this accent has earned, 0..1.
 * Dense songs filter to a subset; sparse songs let a lone hit show.
 */
export function screenHit(accent = 0, energy = 0) {
  const a = clamp01(accent);
  const floor = lerp(0.08, 0.55, clamp01(energy));
  if (a <= floor) return 0;
  return clamp01((a - floor) / Math.max(1e-6, 1 - floor));
}

/**
 * Boss flinch. Sparse confident beats still pop every time; dense material
 * only keeps the pop when the beat also earned a screen hit, so a locked
 * 170 BPM grid cannot strobe the sprite. Unmetered songs never invent a
 * pulse -- an isolated accent can still pop. Reduced flash is a statue.
 */
export function tubeFlinch({
  phase01 = 0, confidence = 0, accent = 0, energy = 0, reducedFlash = false,
} = {}) {
  if (reducedFlash) return 1;
  const locked = beatFlinchScale(phase01, confidence);
  if (locked !== 1) {
    if (clamp01(energy) < 0.42) return locked;
    return screenHit(accent, energy) > 0 ? locked : 1;
  }
  return screenHit(accent, energy) > 0.45 ? FLINCH_SCALE : 1;
}

/** 0 = no motif (default raster). 1 = a measured label we will honour. */
export function motifTrust(section) {
  if (!section || !Number.isFinite(section.label)) return 0;
  if (section.provenance === 'detected') return 1;
  if (section.provenance === 'inferred') return 0.5;
  return 0;
}

/**
 * Scanline tile height in destination pixels. Returning labels pick the
 * same period; decorative cuts and missing labels keep the authored 3.
 */
export function scanPeriod(section) {
  const trust = motifTrust(section);
  if (trust <= 0) return 3;
  const id = Math.abs(Math.round(section.label)) % 3;
  return 2 + id;
}

/** Drop tear intensity. Reduced flash gets the hit, not the shatter. */
export function tearAmount(dropStrength = 0, reducedFlash = false) {
  if (reducedFlash) return 0;
  return clamp01(dropStrength);
}

/** Current and previous section at a clock, so a seek cannot keep a later motif. */
export function sectionAt(sections, nowMs) {
  if (!Array.isArray(sections) || !sections.length) return { section: null, prev: null };
  const t = Number.isFinite(nowMs) ? nowMs : 0;
  let idx = 0;
  for (let i = 1; i < sections.length; i++) {
    if ((sections[i].startMs ?? 0) <= t) idx = i;
    else break;
  }
  return { section: sections[idx], prev: idx > 0 ? sections[idx - 1] : null };
}
