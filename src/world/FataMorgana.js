// The fata morgana: a pale, jagged, snow-capped mountain range hovering
// right at the ocean's own horizon -- not a real landmass (see FarShore.js
// for that, drawn dark and vague), but a mirage: the same warm-over-cold
// atmospheric refraction that lets a real Fata Morgana lift the Alps into
// view over open sea from far beyond the horizon's true reach. Where
// FarShore is deliberately featureless (distance dissolves detail), this is
// the opposite illusion -- jagged, glaciated peaks read with unnatural
// clarity precisely because refraction, not distance, is doing the work,
// and the whole band shimmers and stretches instead of holding still.
//
// Pure math only -- BiomeManager clips, warps and fills it; tests exercise
// the silhouette and shimmer directly.
import { mulberry32, clamp01 } from '../utils/math.js';

// Slower even than FarShore: a mirage does not creep past like scenery, it
// simply hangs there, so any parallax at all would give away that it is a
// drawn object rather than an atmospheric event.
export const MIRAGE_PARALLAX = 0.006;

// The silhouette tiles over this many px of (near-static) scrolled space.
export const MIRAGE_TILE_PX = 2200;

/**
 * Seeded silhouette recipe: a run of narrow, jagged summits (unlike
 * FarShore's broad smooth lobes) with a snow line partway down each one.
 * Sharpness is the point -- a mirage is recognized by how impossibly crisp
 * something that far away has no business being.
 */
export function mirageRecipe(seed) {
  const rand = mulberry32(seed >>> 0 || 1);
  const peakCount = 7 + Math.floor(rand() * 5); // 7-11 jagged summits
  const peaks = [];
  for (let i = 0; i < peakCount; i++) {
    peaks.push({
      center: rand(),
      width: 0.035 + rand() * 0.05,
      height: 0.55 + rand() * 1.0,
      // A superellipse-ish sharpness knob: higher = more needle-like.
      sharp: 1.4 + rand() * 1.6,
    });
  }
  return {
    peaks,
    grainPhase: rand() * Math.PI * 2,
    shimmerPhase: rand() * Math.PI * 2,
    // Fraction of each summit's own height that reads as snow, from the
    // top down -- varied per range so it never looks like one flat rule.
    snowFrac: 0.30 + rand() * 0.18,
  };
}

/**
 * Silhouette height at fractional position u (0..1, wraps): >=0, roughly
 * 0..1.4. Peaks are narrow and pointed (unlike FarShore's broad lobes),
 * which is what sells "mountain range" instead of "distant landmass."
 */
export function mirageHeight01(recipe, u) {
  const uu = ((u % 1) + 1) % 1;
  let h = 0;
  for (const p of recipe.peaks) {
    let d = Math.abs(uu - p.center);
    d = Math.min(d, 1 - d); // wrap around the tile
    const t = clamp01(1 - d / Math.max(0.01, p.width));
    if (t <= 0) continue;
    h = Math.max(h, p.height * Math.pow(t, p.sharp));
  }
  h += 0.03 * Math.sin(uu * 53 + recipe.grainPhase);
  return Math.max(0, h);
}

/**
 * Heat-shimmer vertical displacement (px, signed) for one column, as a
 * function of its position and time. Slow and lazy -- a real mirage
 * wavers over seconds, not the fast flicker a "glitch" would read as -- and
 * built from two mismatched periods so it never repeats in an obviously
 * mechanical way.
 */
export function mirageShimmerPx(recipe, u, tSec, ampPx) {
  const uu = ((u % 1) + 1) % 1;
  const a = Math.sin(uu * 23 + tSec * 0.17 + recipe.shimmerPhase);
  const b = Math.sin(uu * 11 - tSec * 0.09 + recipe.shimmerPhase * 1.7);
  return (a * 0.6 + b * 0.4) * ampPx;
}

/**
 * Slow breathing presence (0..1) -- how strongly the mirage is "resolved"
 * right now, on a long, quiet cycle so it fades in and out of legibility
 * rather than snapping on and off like a rendered layer.
 */
export function miragePresence01(tSec, periodSec = 37) {
  return 0.5 + 0.5 * Math.sin((tSec / periodSec) * Math.PI * 2);
}
