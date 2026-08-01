// Movement VII (The Light): one source of truth for "where the sun/moon is
// and how strong it is" -- pure data, no drawing. BiomeManager already knows
// the celestial's screen position (used to draw it) and its crossfaded halo
// color (used by HUD-level effects); this module turns that into a light
// every other draw call can react to, instead of each consumer re-deriving it.

/** The celestial body's fixed screen anchor -- shared by _drawCelestial and computeLight so the light is always exactly where the sun/moon is drawn. */
export function celestialScreenPos(canvasWidth, canvasHeight, celestialYFrac = 0.22) {
  return { x: canvasWidth * 0.78, y: canvasHeight * celestialYFrac };
}

/**
 * @param {object} p
 * @param {number} p.canvasWidth
 * @param {number} p.canvasHeight
 * @param {number} p.celestialYFrac  vertical position from Dramaturgy's day arc
 * @param {string} p.haloColorHex    crossfaded biome halo color (currentHaloColor())
 * @param {number} p.budget          intensityBudget(progress), 0..1
 * @param {number} [p.unravel]       CodaDirector.unravel, 0..1 -- the light goes out with the ending
 * @param {number} [p.dayArcAlpha]   combined dawn/dusk wash alpha, dims the light during transitions
 * @param {boolean} [p.reducedFlash] accessibility toggle -- compresses intensity swings toward a steady
 *   baseline instead of capping a peak, since nothing here is a single flash to clamp
 * @returns {{x:number, y:number, colorHex:string, intensity:number, dirX:number, dirY:number}}
 */
const REDUCED_FLASH_BASELINE = 0.6;

export function computeLight({
  canvasWidth, canvasHeight, celestialYFrac = 0.22, haloColorHex = '#ffffff',
  budget = 1, unravel = 0, dayArcAlpha = 0, reducedFlash = false,
}) {
  const { x, y } = celestialScreenPos(canvasWidth, canvasHeight, celestialYFrac);
  let intensity = Math.max(0, budget * (1 - unravel) * (1 - 0.5 * dayArcAlpha));
  if (reducedFlash) intensity = 0.5 * intensity + 0.5 * REDUCED_FLASH_BASELINE;
  // Generic downward-ish direction toward the ground, for consumers that
  // want "which way the light falls" without a specific subject position.
  const dir = lightDirTo({ x, y }, canvasWidth * 0.5, canvasHeight);
  return { x, y, colorHex: haloColorHex, intensity, dirX: dir.x, dirY: dir.y };
}

/** Normalized vector pointing FROM the light TOWARD a screen point -- the direction light travels to reach it. */
export function lightDirTo(light, x, y) {
  const dx = x - light.x, dy = y - light.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}
