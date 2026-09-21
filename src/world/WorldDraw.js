// Shared mechanics only. Worlds retain geometry, light sources and draw order.
import { drawTiledStrip } from './SilhouetteGenerator.js';
import { groundGlowLights } from '../render/LightField.js';

const STATIC_SHADE = Object.freeze({ geology: false, geometry: 'static' });

export function drawStaticStrip(mgr, ctx, canvas, strip, scrollX, yOff, key, alpha, terrainEnergy) {
  if (strip) {
    ctx.save();
    if (alpha < 0.999) ctx.globalAlpha = alpha;
    drawTiledStrip(ctx, strip, scrollX, canvas.width, canvas.height, yOff);
    ctx.restore();
  }
  mgr._drawRidgeVolume(ctx, canvas, strip, scrollX, yOff, key, alpha, terrainEnergy, 1, 1, STATIC_SHADE);
}

export function drawParticleBlend(mgr, frame, multiplier = 1) {
  const { ctx, A, B, t, worldX, originX, particleMul } = frame;
  const { from, to } = mgr.currentBlend || { from: A.name, to: B.name };
  const openA = mgr.openingGain;
  const unravel = mgr.unravel || 0;
  const color = mgr._rotated(mgr.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t));
  const rimOn = mgr._perf ? mgr._perf.rimLightEnabled : true;
  const lights = rimOn
    ? [mgr.light, ...groundGlowLights(mgr.groundField ? mgr.groundField.activeGlowScreenLights(worldX, originX) : [], color)].filter(Boolean)
    : null;
  ctx.save();
  if (openA < 0.999) ctx.globalAlpha = openA;
  mgr.fields.get(from)?.draw(ctx, particleMul * multiplier, color, unravel, lights);
  ctx.restore();
  if (to !== from && t > 0.02) {
    ctx.save(); ctx.globalAlpha = t * openA;
    mgr.fields.get(to)?.draw(ctx, particleMul * multiplier, color, unravel, lights);
    ctx.restore();
  }
}

export function drawGroundBase(mgr, frame, tint) {
  const { ctx, canvas, groundView, worldX, originX, A, B, t } = frame;
  const groundCanvas = groundView ? groundView.stage : canvas;
  if (groundView) groundView.apply();
  mgr._drawGround(ctx, groundCanvas, worldX, originX, A, B, t, tint);
  mgr._drawTerrainFooting(ctx, groundCanvas, worldX, originX, A, B, t);
  return groundCanvas;
}
