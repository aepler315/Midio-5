// Single house look: CGI mountains + atmosphere, selective sky energy,
// solid ocean with soft wave contours. No classic/neon dual mode.
// Pure helpers + storage; Renderer / BiomeManager / MeshDrawer consume dials.
import { hexToRgb, rgbToHsl, hslToRgb, rgbToHex } from '../utils/color.js';

export const STYLE_CLASSIC = 'classic'; // kept for URL/storage compat → maps to house
export const STYLE_RENDERED = 'rendered';
export const VISUAL_STYLES = [STYLE_RENDERED];

const STORAGE_KEY = 'smw:visualStyle';

/** Everything resolves to the one house look. */
export function resolveVisualStyle(_raw) {
  return STYLE_RENDERED;
}

export function getVisualStyle() {
  return STYLE_RENDERED;
}

export function setVisualStyle(_v) {
  try { localStorage.setItem(STORAGE_KEY, STYLE_RENDERED); } catch { /* no storage */ }
  return STYLE_RENDERED;
}

export function isRendered(_style) {
  return true;
}

export function styleLabel(_style) {
  return 'Look: Midio';
}

/** Toggle is a no-op — one look only. */
export function nextVisualStyle(_style) {
  return STYLE_RENDERED;
}

/**
 * House presentation dials. One set for the whole show.
 */
export function styleDials(_style) {
  return {
    id: STYLE_RENDERED,
    // Post
    retroFilter: false,
    bloomBaseMul: 1.4,
    filmGradeMul: 1.45,
    vignetteDepthMul: 1.08,
    // Atmosphere
    hazeMul: 1.2,
    fogMul: 1.4,
    spaceWash: true,
    starAmbient: 1.3,
    oceanPresence: 1.35,
    // Characters — wireframe + glow
    glowHaloMul: 1.25,
    rimAmount: 0.9,
    widthBase: 1.8,
    widthGlow: 2.35,
    outlineWidthAdd: 2.7,
    // Ocean — water mass + soft contours (keep them dim so they don't stripe mountains)
    oceanLineAlpha: 0.18,
    oceanDrawContours: true,
    oceanBodyAlpha: 1.25,
    oceanReflect: 1.15,
    rowCountMul: 0.28,
    heatShimmerSlices: false,
    groundCrestCaps: true,
    massifCrestCaps: true,
    // Sky music
    horizonEqAlpha: 0.42,
    crestGlowAlpha: 0.55,
    crestStroke: true,
    spaceRidgeAlpha: 0.55,
    skyWireAlpha: 0.38,
  };
}

/** Darken/lighten a hex by shifting HSL lightness (delta in -1..1 space). */
export function shiftLightness(hex, delta) {
  const { r, g, b } = hexToRgb(hex);
  const hsl = rgbToHsl(r, g, b);
  const l = Math.max(0, Math.min(1, hsl.l + delta));
  const s = Math.max(0, Math.min(1, hsl.s + (delta < 0 ? 0.08 : -0.04)));
  const rgb = hslToRgb(hsl.h, s, l);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}
