// The sun and moon are not just crossing the sky. They are coming.
//
// The old behaviour was an arc: a body tracks left-to-right across the frame
// at a fixed size, which reads as scenery. Correct, and completely inert --
// nothing about it ever asks you to reconsider what you are looking at.
//
// This layers an APPROACH on top of that arc. Over the length of the song the
// body closes on a convergence point set just up and to the left of Midio,
// and the whole effect rests on the two halves moving at very different
// rates:
//
//   POSITION moves linearly and slowly. Its pixels-per-second is roughly
//   constant and small enough to sit under conscious notice -- you are never
//   watching something travel.
//
//   SIZE grows as 1/distance, which is what apparent size actually does. A
//   linear closing rate therefore produces a convex size curve: almost
//   nothing for most of the song, then a lot, quickly.
//
// That gap is the whole trick. Something that has barely moved cannot be
// close, so the eye files it as far away and stops tracking it -- and then it
// is much too big for the size it was a moment ago, and the only way to
// reconcile those two facts is that it is enormous and it has been enormous
// the entire time. That is the vertigo of misjudged scale, and it comes from
// the RATIO of the two rates, not from either one being dramatic.
//
// Pure geometry, no canvas: BiomeManager applies these to the body's screen
// position and radius, tests exercise them directly.
import { clamp01 } from '../utils/math.js';

// Distance in arbitrary units -- only the ratio matters, since apparent size
// is D_FAR/d. Starting far and ending at roughly a quarter of that gives a
// ~4x growth across a full song, which is large enough to be unmistakable
// once noticed and small enough that no single minute of the song contains
// an obvious change.
export const D_FAR = 1;
export const D_NEAR = 0.26;
// Hard ceiling on apparent growth. Without it a long song would put the body
// through the top of the frame, and "it got bigger" stops being unsettling
// once it becomes the only thing on screen.
export const MAX_SCALE = 3.4;

// Where it is heading: up and to the left of Midio. Not AT him -- a body on
// a collision course reads as a threat and as an event about to happen,
// where the intent here is that it passes, enormously, close by.
//
// These were -500/-500, which put the target OFF THE SCREEN. Midio rides
// around x=0.32 of a 1280 stage, so the convergence point sat at x=-90, and
// the body spent the whole song drifting toward a place the viewer cannot
// see: it slid off the left edge and was simply gone. The effect is supposed
// to end with the thing enormous and unmistakably close, which requires it to
// still be IN FRAME when it gets there. Now it converges just above and
// slightly left of him, which reads as arrival rather than exit.
export const CONVERGE_DX = -110;
export const CONVERGE_DY = -300;

/** Distance at song progress t01, closing linearly. Linear IS the point:
 *  it is what makes the positional drift constant-rate and unremarkable
 *  while the size curve it feeds is convex. */
export function approachDistance(t01) {
  const t = clamp01(t01);
  return D_FAR + (D_NEAR - D_FAR) * t;
}

/**
 * Apparent-size multiplier at song progress t01.
 *
 * 1 at the start, rising as 1/d -- slowly at first, then steeply. Capped at
 * MAX_SCALE.
 */
export function approachScale(t01) {
  const d = approachDistance(t01);
  return Math.min(MAX_SCALE, D_FAR / Math.max(1e-6, d));
}

// How much of the observer's own vertical motion the body's apparent position
// picks up, at closest approach. Parallax is real -- a nearer object shifts
// more against the background as you move -- but for something this far away
// it is almost nothing, and it GROWS as the body closes rather than being
// constant. 2% of a jump is a couple of pixels: present in the model, and
// nothing you could point at.
//
// The first version of this had no such term and simply used Midio's live
// render Y as the anchor, which is a 1:1 hard anchor: he jumped three feet
// and the sun jumped three feet with him, welding a body at astronomical
// distance to a character's pose. The fix is not a smaller number on that
// coupling -- it is anchoring to the GROUND, which does not move, and then
// adding back the small amount of parallax that should have been there.
export const OBSERVER_PARALLAX = 0.02;

/**
 * The convergence point, in screen space.
 *
 * @param {number} anchorX  Midio's screen x -- stable, he holds his column
 * @param {number} groundY  the GROUND line, not his live render Y. An
 *   observer's jump does not move the sun.
 * @param {number} [observerDy] how far above the ground the observer
 *   currently is (positive = airborne), for the parallax term
 * @param {number} [t01] song progress, since parallax grows as it nears
 */
export function convergencePoint(anchorX, groundY, observerDy = 0, t01 = 0) {
  const closeness = clamp01(1 - approachDistance(t01) / D_FAR);
  return {
    x: anchorX + CONVERGE_DX,
    y: groundY + CONVERGE_DY + observerDy * OBSERVER_PARALLAX * closeness,
  };
}

/**
 * Blend a body's orbital screen position toward the convergence point.
 *
 * The orbit is NOT replaced -- it still rises, crosses and sets, because a
 * body that stopped orbiting would read as broken rather than as near. What
 * changes is that the arc is progressively pulled toward the convergence
 * point, the way a distant object's apparent path flattens toward the point
 * you are closing on.
 *
 * The pull is `1 - d/D_FAR`, so it is exactly linear in t: constant drift
 * rate, no acceleration for the eye to catch.
 *
 * @returns {{x:number, y:number}} the drawn position
 */
export function approachedPos(orbitX, orbitY, targetX, targetY, t01) {
  const d = approachDistance(t01);
  const pull = clamp01(1 - d / D_FAR);
  return {
    x: orbitX + (targetX - orbitX) * pull,
    y: orbitY + (targetY - orbitY) * pull,
  };
}

/**
 * Everything a caller needs for one frame.
 *
 * @param {object} p
 * @param {number} p.orbitX current orbital screen x
 * @param {number} p.orbitY current orbital screen y
 * @param {number} p.midioX
 * @param {number} p.groundY the ground line -- NOT Midio's live render y
 * @param {number} [p.observerDy] his height above the ground, for parallax
 * @param {number} p.progress01 song progress
 * @returns {{x:number, y:number, scale:number, distance:number}}
 */
export function celestialApproach({
  orbitX, orbitY, midioX, groundY, observerDy = 0, progress01,
}) {
  const target = convergencePoint(midioX, groundY, observerDy, progress01);
  const pos = approachedPos(orbitX, orbitY, target.x, target.y, progress01);
  return {
    x: pos.x,
    y: pos.y,
    scale: approachScale(progress01),
    distance: approachDistance(progress01),
  };
}
