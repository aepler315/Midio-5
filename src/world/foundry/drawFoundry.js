// The Foundry draw path. Industrial: smokestacks, pour glow, molten
// rivers of light. Haze is smoke, not atmosphere. The edge-light on
// every layer is furnace glow bleeding through silhouette gaps.
import { drawTiledStrip } from '../SilhouetteGenerator.js';
import { CodaDirector } from '../../sim/CodaDirector.js';
import { ensureContrast, styleDials } from '../../render/VisualStyle.js';
import { groundGlowLights } from '../../render/LightField.js';
import { celestialYFracFor, celestialXFracFor, horizonFade } from '../DayNight.js';
import { capFlashAlpha } from '../../ui/Accessibility.js';
import { hexToRgb } from '../../utils/color.js';

const LAYER_RATIOS = { L2: 0.05, L3: 0.12, L4: 0.26, L5: 0.58 };
const Y_OFF = { L2: 2, L3: 14, L4: 36, L5: 66 };

function blit(ctx, canvas, strip, scrollX, yOff, alpha = 1) {
  if (!strip) return;
  ctx.save();
  if (alpha < 0.999) ctx.globalAlpha = alpha;
  drawTiledStrip(ctx, strip, scrollX, canvas.width, canvas.height, yOff);
  ctx.restore();
}

export function drawFoundryWorld(mgr, ctx, canvas, worldX, originX, A, B, t, dn, phenomenaFull, particleMul, groundView, skyVoyage = null) {
  mgr._drawSky(ctx, canvas, A, B, t, 0.85);

  // Deep-sky layer ported in from BiomeManager's classic path -- the same
  // celestial body here is "often veiled behind smoke", not always, so the
  // sky above the furnace glow can still carry Midasus's sky-writing trail,
  // the ambient constellations, and reward-volley meteors. Missing here
  // only because Foundry got its own draw function without them.
  mgr.drawDeepSky(ctx, skyVoyage, canvas);
  const skyA = styleDials(mgr.visualStyle).skyWireAlpha ?? 1;
  if (phenomenaFull && skyA > 0.02) {
    const nightAlphaMul = (1 + 1.2 * 0.85) * Math.max(0.25, skyA);
    mgr.weaver.draw(ctx, canvas, mgr.reducedFlash, nightAlphaMul);
  }
  if (phenomenaFull) mgr.meteors.draw(ctx, canvas, mgr.reducedFlash);

  // Celestial body — often veiled behind smoke, small in the hot palettes.
  const moonAlt = Math.max(dn.moonAlt, 0.30);
  const celestialYFrac = celestialYFracFor(moonAlt);
  const celestialXFrac = celestialXFracFor(dn.moonAz01 ?? 0.60);
  const sunUp = (dn.sunAlt ?? 0) > 0.01;
  if (sunUp) {
    mgr._drawCelestial?.(ctx, canvas, A, B, t, celestialYFrac, horizonFade(moonAlt) * 0.5, celestialXFrac);
  } else {
    mgr._drawMoon(
      ctx, canvas, celestialYFrac, horizonFade(moonAlt) * 0.5,
      0, celestialXFrac,
      0.5, 1.0, mgr._moonPhase01?.() ?? 0.45,
    );
  }

  const { from, to } = mgr.currentBlend || { from: A.name, to: B.name };
  const skyHorizon = mgr._rotated(mgr.lerpCache.get(A.sky[2], B.sky[2], t));
  const tint = ensureContrast(mgr._rotated(mgr.lerpCache.get(A.silhouette, B.silhouette, t)), skyHorizon, 0.18);

  const unravel = mgr.unravel || 0;
  const scroll = (key) => worldX * CodaDirector.delaminateRatio(LAYER_RATIOS[key], unravel);

  const stripsA = mgr.stripsFor(from);
  const stripsB = mgr.stripsFor(to);

  // Furnace glow: a warm uplight from below the horizon, strongest in
  // the hot palettes (POUR, WHITEHEAT).
  const edgeColor = A.edgeLight || B.edgeLight || null;
  if (edgeColor) {
    const { r, g, b } = hexToRgb(edgeColor);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const energy = mgr.energyCurves && typeof mgr.energyCurves.globalEnergyNorm === 'function'
      ? mgr.energyCurves.globalEnergyNorm(mgr.tSec * 1000) : 0.4;
    ctx.globalAlpha = capFlashAlpha(0.04 + 0.06 * energy, false);
    const fg = ctx.createLinearGradient(0, canvas.height, 0, canvas.height * 0.5);
    fg.addColorStop(0, `rgba(${r},${g},${b},0.15)`);
    fg.addColorStop(0.4, `rgba(${r},${g},${b},0.04)`);
    fg.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = fg;
    ctx.fillRect(0, canvas.height * 0.5, canvas.width, canvas.height * 0.5);
    ctx.restore();
  }

  // Smoke haze between layers instead of atmospheric haze.
  const drawSmoke = (yFrac) => {
    ctx.save();
    ctx.globalAlpha = 0.05;
    const sg = ctx.createLinearGradient(0, canvas.height * yFrac, 0, canvas.height * (yFrac + 0.08));
    sg.addColorStop(0, 'rgba(40, 30, 20, 0)');
    sg.addColorStop(0.5, 'rgba(40, 30, 20, 0.06)');
    sg.addColorStop(1, 'rgba(40, 30, 20, 0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, canvas.height * yFrac, canvas.width, canvas.height * 0.08);
    ctx.restore();
  };

  const drawRange = (key) => {
    const yOff = Y_OFF[key] || 0;
    const sx = scroll(key);
    if (stripsA) blit(ctx, canvas, stripsA[key], sx, yOff, to === from ? 1 : 1 - t);
    if (to !== from && t > 0.02 && stripsB) blit(ctx, canvas, stripsB[key], sx, yOff, t);
  };

  drawRange('L2');
  drawSmoke(0.42);
  drawRange('L3');
  drawSmoke(0.52);

  // Particles: embers, sparks, fog.
  const openA = mgr.openingGain;
  const mandalaColor = mgr._rotated(mgr.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t));
  const rimOn = mgr._perf ? mgr._perf.rimLightEnabled : true;
  const particleLights = rimOn
    ? [mgr.light, ...groundGlowLights(mgr.groundField ? mgr.groundField.activeGlowScreenLights(worldX, originX) : [], mandalaColor)].filter(Boolean)
    : null;
  ctx.save();
  if (openA < 0.999) ctx.globalAlpha = openA;
  mgr.fields.get(from)?.draw(ctx, particleMul * 1.2, mandalaColor, unravel, particleLights);
  ctx.restore();
  if (to !== from && t > 0.02) {
    ctx.save(); ctx.globalAlpha = t * openA;
    mgr.fields.get(to)?.draw(ctx, particleMul * 1.2, mandalaColor, unravel, particleLights);
    ctx.restore();
  }

  if (phenomenaFull && mgr.meteors) {
    mgr.meteors.draw(ctx, canvas, mgr.reducedFlash);
  }

  drawRange('L4');
  drawSmoke(0.62);
  drawRange('L5');

  // Ground
  const groundCanvas = groundView ? groundView.stage : canvas;
  if (groundView) groundView.apply();
  mgr._drawGround(ctx, groundCanvas, worldX, originX, A, B, t, tint);
  mgr._drawTerrainFooting(ctx, groundCanvas, worldX, originX, A, B, t);
  mgr._drawFlood(ctx, groundCanvas);
  mgr._drawTransitionOverlays(ctx, groundCanvas, B);
}
