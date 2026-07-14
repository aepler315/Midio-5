// Contact shadows (The Light Show, pass 4): a soft ground-anchored ellipse
// per character that fades and shrinks with height above the local
// terrain, so jumps/hops/flight read as leaving the ground instead of
// floating. Pure and stateless -- mirrors MountainChoreo's danceOffset
// (numbers in, a plain object out; the caller owns ctx).
import { clamp, smoothstep } from '../utils/math.js';

// Absolute px above ground at which the shadow has fully vanished. Chosen
// so a soft hop (Midio's weakest kick, apex ~83px) keeps a dimming-but-
// present shadow through the whole arc, while a hard jump (apex ~193px)
// is fully shadow-less at the hang -- no shadow dragged into the sky.
export const SHADOW_FADE_HEIGHT_PX = 130;
// Footprint radius as a fraction of the character's on-screen width --
// narrower than the full silhouette span, since none of the three meshes
// are footprint-shaped (spiky crowns/haunches splay well past the feet).
export const SHADOW_WIDTH_FRAC = 0.42;
export const SHADOW_ASPECT = 0.34;   // ry = rx * SHADOW_ASPECT -- a flattened ~1:3 oval
export const SHADOW_RX_MIN = 9;      // px floor (guards Midasus's tiny hexagram)
export const SHADOW_RX_MAX = 46;     // px ceiling (headroom against future width inputs)
export const SHADOW_ALPHA_MAX = 0.32; // peak opacity directly underfoot
export const SHADOW_HEIGHT_SHRINK = 0.35; // fraction the ellipse shrinks from grounded to fully faded

/**
 * @param {number} screenX          character's screen-space x (shadow center)
 * @param {number} groundY          local ground y at screenX (shadow center)
 * @param {number} heightAbove      px above ground the character currently is
 * @param {number} characterWidthPx character's current on-screen width
 * @returns {{cx:number, cy:number, rx:number, ry:number, alpha:number}}
 */
export function contactShadow(screenX, groundY, heightAbove, characterWidthPx) {
  const h = Number.isFinite(heightAbove) ? Math.max(0, heightAbove) : 0;
  const visibility = 1 - smoothstep(0, SHADOW_FADE_HEIGHT_PX, h);
  if (visibility <= 0) {
    return { cx: screenX, cy: groundY, rx: 0, ry: 0, alpha: 0 };
  }

  const w = Number.isFinite(characterWidthPx) ? Math.max(0, characterWidthPx) : 0;
  const rxBase = clamp(w * SHADOW_WIDTH_FRAC, SHADOW_RX_MIN, SHADOW_RX_MAX);
  const shrink = 1 - SHADOW_HEIGHT_SHRINK * (1 - visibility);
  const rx = rxBase * shrink;
  const ry = rx * SHADOW_ASPECT;

  return { cx: screenX, cy: groundY, rx, ry, alpha: SHADOW_ALPHA_MAX * visibility };
}
