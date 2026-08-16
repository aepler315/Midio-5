// The Ground Catches It, item 1: per-bar surface facing for the ground
// ridge, so the ground plane can shade toward/away from the celestial the
// same way the mountains already do. Pure -- mirrors ContactShadow.js's
// shape (constants + one function, no drawing, no ctx).
import { clamp01 } from '../utils/math.js';

/**
 * Per-bar surface facing against a light, for the ground ridge.
 * @param {{x:number,width:number,y:number}[]} bars  GroundField.visibleBars() output (screen space)
 * @param {{x:number,y:number,intensity:number}|null} light
 * @returns {number[]} one value per bar in -1..1: +1 fully facing the light,
 *   -1 fully turned away, 0 edge-on. All zeros when `light` is null/degenerate,
 *   which is what makes every consumer's "no light" path the current look.
 */
export function terrainFacing(bars, light) {
  if (!bars || bars.length === 0) return [];
  const intensity = light && Number.isFinite(light.intensity) ? clamp01(light.intensity) : 0;
  if (!light || !Number.isFinite(light.x) || !Number.isFinite(light.y) || intensity <= 0) {
    return bars.map(() => 0);
  }

  const centers = bars.map((b) => ({ x: b.x + b.width / 2, y: b.y }));
  const out = new Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    const prev = centers[Math.max(0, i - 1)];
    const next = centers[Math.min(centers.length - 1, i + 1)];
    // Local tangent along the ridge, then rotate -90deg to get the outward
    // normal. Canvas y grows downward and the solid is BELOW the curve, so
    // the outward normal is the one with the negative y component: rotating
    // (tx, ty) by -90deg gives (ty, -tx).
    const tx = next.x - prev.x, ty = next.y - prev.y;
    let nx = ty, ny = -tx;
    const nLen = Math.hypot(nx, ny) || 1;
    nx /= nLen; ny /= nLen;
    if (ny > 0) { nx = -nx; ny = -ny; } // guard: normal must point up/out, never into the solid

    const c = centers[i];
    const lx = light.x - c.x, ly = light.y - c.y;
    const lLen = Math.hypot(lx, ly) || 1;
    const lightDirX = lx / lLen, lightDirY = ly / lLen;
    // Raw incidence against a perfectly flat patch under the same light is
    // (0,-1)·lightDir -- constant baseline brightness that carries no relief
    // information (every bar would get it, flat or not). Subtracting it out
    // leaves the part that actually varies with slope: which is the point --
    // "facing" is a relief cue, not raw illumination, so flat ground reports
    // 0 regardless of where overhead the light sits.
    const baseline = -lightDirY;
    const facing = (nx * lightDirX + ny * lightDirY) - baseline;
    out[i] = Math.max(-1, Math.min(1, facing)) * intensity;
  }
  return out;
}
