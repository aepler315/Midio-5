// The Fathom draw path. Underwater column: light descends, pressure climbs.
// No stars, no weather. Caustic ripples replace haze; depth darkening
// replaces aerial perspective. The "sky" is the water surface overhead.
import { drawTiledStrip } from '../SilhouetteGenerator.js';
import { CodaDirector } from '../../sim/CodaDirector.js';
import { ensureContrast } from '../../render/VisualStyle.js';
import { groundGlowLights } from '../../render/LightField.js';
import { celestialYFracFor, celestialXFracFor, horizonFade } from '../DayNight.js';

const LAYER_RATIOS = { L2: 0.03, L3: 0.08, L4: 0.18, L5: 0.42 };
const Y_OFF = { L2: 10, L3: 22, L4: 44, L5: 70 };
const DEPTH_DARKEN = { L2: 0.38, L3: 0.24, L4: 0.10, L5: 0 };

function blit(ctx, canvas, strip, scrollX, yOff, alpha = 1) {
  if (!strip) return;
  ctx.save();
  if (alpha < 0.999) ctx.globalAlpha = alpha;
  drawTiledStrip(ctx, strip, scrollX, canvas.width, canvas.height, yOff);
  ctx.restore();
}

export function drawFathomWorld(mgr, ctx, canvas, worldX, originX, A, B, t, dn, phenomenaFull, particleMul, groundView) {
  mgr._drawSky(ctx, canvas, A, B, t, 1);

  // The "celestial" is the sun seen through the surface — always veiled,
  // always high, shimmer-distorted by the water column.
  const sunAlt = Math.max(dn.sunAlt ?? 0.6, 0.55);
  const celestialYFrac = celestialYFracFor(sunAlt);
  const celestialXFrac = celestialXFracFor(dn.sunAz01 ?? 0.5);
  mgr._drawCelestial?.(ctx, canvas, A, B, t, celestialYFrac, horizonFade(sunAlt) * 0.6, celestialXFrac);

  // Caustic ripple overlay — shimmering light bands on the water column.
  const phase = (mgr.tSec || 0) * 0.8;
  ctx.save();
  ctx.globalAlpha = 0.04 + 0.03 * Math.sin(phase * 2.1);
  ctx.globalCompositeOperation = 'lighter';
  const cg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height * 0.6);
  cg.addColorStop(0, 'rgba(120, 220, 220, 0.12)');
  cg.addColorStop(0.5, 'rgba(80, 180, 200, 0.06)');
  cg.addColorStop(1, 'rgba(40, 100, 140, 0)');
  ctx.fillStyle = cg;
  ctx.fillRect(0, 0, canvas.width, canvas.height * 0.7);
  ctx.restore();

  const { from, to } = mgr.currentBlend || { from: A.name, to: B.name };
  const skyHorizon = mgr._rotated(mgr.lerpCache.get(A.sky[2], B.sky[2], t));
  const DEEP = '#020a0e';
  const tint = ensureContrast(mgr._rotated(mgr.lerpCache.get(A.silhouette, B.silhouette, t)), skyHorizon, 0.14);

  const unravel = mgr.unravel || 0;
  const scroll = (key) => worldX * CodaDirector.delaminateRatio(LAYER_RATIOS[key], unravel);

  const stripsA = mgr.strips.get(from);
  const stripsB = mgr.strips.get(to);

  // Depth darkening instead of aerial perspective: far layers darken
  // toward the deep water color rather than fading toward sky.
  const layerTint = (key) => {
    const pull = DEPTH_DARKEN[key] || 0;
    return pull > 0.001 ? mgr.lerpCache.get(tint, DEEP, pull) : tint;
  };

  const drawRange = (key) => {
    const yOff = Y_OFF[key] || 0;
    const sx = scroll(key);
    if (stripsA) blit(ctx, canvas, stripsA[key], sx, yOff, to === from ? 1 : 1 - t);
    if (to !== from && t > 0.02 && stripsB) blit(ctx, canvas, stripsB[key], sx, yOff, t);
  };

  drawRange('L2');
  drawRange('L3');

  // Particles: bubbles and spores drifting upward.
  const openA = mgr.openingGain;
  const mandalaColor = mgr._rotated(mgr.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t));
  ctx.save();
  if (openA < 0.999) ctx.globalAlpha = openA;
  mgr.fields.get(from)?.draw(ctx, particleMul * 0.7, mandalaColor, unravel, null);
  ctx.restore();
  if (to !== from && t > 0.02) {
    ctx.save(); ctx.globalAlpha = t * openA;
    mgr.fields.get(to)?.draw(ctx, particleMul * 0.7, mandalaColor, unravel, null);
    ctx.restore();
  }

  drawRange('L4');
  drawRange('L5');

  // Ground
  const groundCanvas = groundView ? groundView.stage : canvas;
  if (groundView) groundView.apply();
  mgr._drawGround(ctx, groundCanvas, worldX, originX, A, B, t, tint);
  mgr._drawTerrainFooting(ctx, groundCanvas, worldX, originX, A, B, t);
  mgr._drawFlood(ctx, groundCanvas);
  mgr._drawTransitionOverlays(ctx, groundCanvas, B);
}
