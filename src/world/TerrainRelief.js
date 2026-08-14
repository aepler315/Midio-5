// Terrain relief (The Ground Catches It): per-bar surface facing against
// a light, for the ground ridge. Pure and stateless -- numbers in, a
// plain array out; the caller owns ctx. Same shape as ContactShadow.
//
// Facing is the *slope's* lean toward the light, not a full Lambertian
// term: a flat bar under an overhead sun is edge-on (0), so omitting the
// light *or* standing on level ground is byte-identical to today's flat
// fill. A rising face lights when the celestial is on the side it points
// toward and sinks when the light crosses its vertical.
import { clamp, clamp01 } from '../utils/math.js';

// Same neutrals `_drawShoulders` argues for (BiomeManager.js): an ARCTIC
// blue and a SOLAR orange both just want their lit face caught and their
// shaded face darker. Tinted relief would muddy whatever the sky already
// did, across seventeen palettes.
export const RELIEF_LIT = '#fff8e6';
export const RELIEF_SHADE = '#000000';
// Peak coefficients at or below the mountains' own crest-catch / foot-sink
// (0.17 / 0.32). The ground is nearer and larger, so equal numbers would
// read as *more*.
export const RELIEF_LIT_ALPHA = 0.17;
export const RELIEF_SHADE_ALPHA = 0.32;
// Crest stroke: today's uniform 0.18, modulated by facing so the rim of
// each hump brightens on the sun's side and dims on the other.
export const CREST_BASE_ALPHA = 0.18;
export const CREST_FACING_K = 0.85;

/**
 * Per-bar surface facing against a light, for the ground ridge.
 * @param {{x:number,width:number,y:number}[]} bars  GroundField.visibleBars() output (screen space)
 * @param {{x:number,y:number,intensity?:number}|null} light
 * @returns {number[]} one value per bar in -1..1: +1 fully facing the light,
 *   -1 fully turned away, 0 edge-on. All zeros when `light` is null/degenerate,
 *   which is what makes every consumer's "no light" path the current look.
 */
export function terrainFacing(bars, light) {
  const n = bars ? bars.length : 0;
  const out = new Array(n).fill(0);
  if (!n) return out;
  if (!light || !Number.isFinite(light.x) || !Number.isFinite(light.y)) return out;
  const intensity = clamp01(light.intensity ?? 1);
  if (!(intensity > 0)) return out;

  for (let i = 0; i < n; i++) {
    const prev = bars[Math.max(0, i - 1)];
    const next = bars[Math.min(n - 1, i + 1)];
    const tx = (next.x + next.width * 0.5) - (prev.x + prev.width * 0.5);
    const ty = next.y - prev.y;
    // Degenerate (single bar, or a run of identical points): no tangent,
    // so no lean -- edge-on, same as flat.
    if (tx === 0 && ty === 0) continue;

    // Rotate the tangent to the outward (air-facing) normal. Canvas y
    // grows downward and the solid is *below* the curve, so the outward
    // normal is the one with the negative y component: (ty, -tx).
    let nx = ty;
    let ny = -tx;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const nLen = Math.hypot(nx, ny) || 1;
    nx /= nLen;

    const bar = bars[i];
    const cx = bar.x + bar.width * 0.5;
    const cy = bar.y;
    const lx = light.x - cx;
    const ly = light.y - cy;
    const lLen = Math.hypot(lx, ly) || 1;
    // Horizontal component only: a flat ridge (nx == 0) stays 0 even
    // with the sun directly overhead, which is the regression the first
    // test pins down. Intensity fades the whole field with the light
    // (the coda's unravel already drives intensity to 0).
    const facing = clamp(nx * (lx / lLen), -1, 1) * intensity;
    out[i] = facing || 0; // collapse -0 so "exactly 0" assertions stay honest
  }
  return out;
}
