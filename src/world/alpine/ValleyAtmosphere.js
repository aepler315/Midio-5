import { projectSurfacePoint, surfaceCopies } from './RidgeSurfaceDraw.js';
import { hexToRgb } from '../../utils/color.js';

export function valleyFogPatches({ surface, geom, terrain, moisture, nowMs = 0, phraseLift = 0, maxBanks = 4 }) {
  if (!surface || !geom?.pts?.length || moisture < .35 || maxBanks < 1) return [];
  const patches = [];
  const offsets = surfaceCopies(surface.width, geom.pts[0].stripX, geom.pts.at(-1).stripX, terrain);
  for (const offset of offsets) for (const valley of surface.valleys) {
    const p = projectSurfacePoint({ sx: valley.sx + offset, depth01: 0 },
      { geom, stripWidth: surface.width, terrain });
    if (!p) continue;
    patches.push({ id: `${valley.id}:${offset}`, x: p.x + Math.sin(nowMs / 13000 + valley.sx) * 5,
      y: p.y + 8, rx: valley.widthPx * .55, ry: 12 + valley.widthPx * .1,
      alpha: Math.min(.12, moisture * .11) * (1 - Math.min(.25, Math.max(0, phraseLift) * .25)) });
    if (patches.length >= maxBanks) return patches;
  }
  return patches;
}

export function drawValleyFog(ctx, patches, color, alpha = 1) {
  ctx.save();
  const { r, g, b } = hexToRgb(color);
  for (const patch of patches) {
    ctx.save(); ctx.translate(patch.x, patch.y); ctx.scale(1, patch.ry / patch.rx);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, patch.rx);
    gradient.addColorStop(0, `rgba(${r},${g},${b},${Math.min(.12, patch.alpha * alpha)})`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath(); ctx.arc(0, 0, patch.rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  ctx.restore();
}
