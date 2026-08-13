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

// Secondary lights: the celestial above is the only thing that has ever
// illuminated anything else in this scene -- every character and event
// (Midasus's core, a kick-synced ground pulse) reads as bright on its own,
// but none of them casts light. These are small, local, falloff-limited
// sources (see MeshDrawer's `lights` param) that fix that in kind, not in
// scale: they light up whoever's nearby, they don't relight the world.

const GLOW_LIGHT_RADIUS_PX = 130; // a ground pulse's reach -- roughly one slice's neighbors, not the whole screen
const GLOW_LIGHT_INTENSITY_MUL = 0.55; // modest next to the celestial's own budget-scaled intensity

/** Kick-synced ground-glow pulses as MeshDrawer light sources, in screen
 *  space. `glows` is GroundField.activeGlowScreenLights()'s own output
 *  (already resolved to screen x/y + current 0..1 envelope) -- this just
 *  reshapes each into the {x,y,colorHex,intensity,radius} MeshDrawer
 *  expects. Empty in, empty out: silent (zero cost) whenever no pulse is
 *  active, same discipline as the glow itself. */
export function groundGlowLights(glows, haloColorHex) {
  if (!glows || !glows.length) return [];
  const out = [];
  for (const g of glows) {
    const intensity = GLOW_LIGHT_INTENSITY_MUL * g.intensity;
    if (intensity > 0.02) out.push({ x: g.x, y: g.y, colorHex: haloColorHex, intensity, radius: GLOW_LIGHT_RADIUS_PX });
  }
  return out;
}

const CHARACTER_LIGHT_RADIUS_PX = 100;

/** A character's own glow as a light on whoever else is nearby -- e.g.
 *  Midasus's core lighting up Midio when she's drawing close beside him,
 *  not just glowing at him. `hueDeg` (not colorHex) since characters
 *  already work in hue-degrees internally; MeshDrawer reads either.
 *  Returns null below a negligible intensity so callers can push the
 *  result straight into a lights array with a plain truthy filter. */
export function characterGlowLight(x, y, hueDeg, intensity, radius = CHARACTER_LIGHT_RADIUS_PX) {
  if (!(intensity > 0.02)) return null;
  return { x, y, hueDeg, intensity, radius };
}
