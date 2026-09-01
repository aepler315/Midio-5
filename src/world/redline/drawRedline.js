// Redline draw path. A desert highway that only exists at speed.
// Flat horizon, heat shimmer, neon signage. The parallax layers are
// road infrastructure — gantries, guardrails, billboards — not mountains.
import { drawTiledStrip } from '../SilhouetteGenerator.js';
import { CodaDirector } from '../../sim/CodaDirector.js';
import { ensureContrast, styleDials } from '../../render/VisualStyle.js';
import { groundGlowLights } from '../../render/LightField.js';
import { celestialYFracFor, celestialXFracFor, horizonFade } from '../DayNight.js';
import { capFlashAlpha } from '../../ui/Accessibility.js';
import { hexToRgb } from '../../utils/color.js';

const LAYER_RATIOS = { L2: 0.06, L3: 0.14, L4: 0.32, L5: 0.70 };
const Y_OFF = { L2: 4, L3: 14, L4: 34, L5: 64 };
const AERIAL_PULL = { L2: 0.30, L3: 0.18, L4: 0.06, L5: 0 };

function blit(ctx, canvas, strip, scrollX, yOff, alpha = 1) {
  if (!strip) return;
  ctx.save();
  if (alpha < 0.999) ctx.globalAlpha = alpha;
  drawTiledStrip(ctx, strip, scrollX, canvas.width, canvas.height, yOff);
  ctx.restore();
}

export function drawRedlineWorld(mgr, ctx, canvas, worldX, originX, A, B, t, dn, phenomenaFull, particleMul, groundView, skyVoyage = null) {
  mgr._drawSky(ctx, canvas, A, B, t, 0.6);

  // Deep-sky layer ported in from BiomeManager's classic path -- a desert
  // highway at night gets the same open, star-heavy sky as the alpine
  // biomes: Midasus's sky-writing trail, the ambient constellations, and
  // reward-volley meteors. Missing here only because Redline got its own
  // draw function without carrying these calls along.
  mgr.drawDeepSky(ctx, skyVoyage, canvas);
  const skyA = styleDials(mgr.visualStyle).skyWireAlpha ?? 1;
  if (phenomenaFull && skyA > 0.02) {
    const nightAlphaMul = (1 + 1.2 * 0.6) * Math.max(0.25, skyA);
    mgr.weaver.draw(ctx, canvas, mgr.reducedFlash, nightAlphaMul);
  }
  if (phenomenaFull) mgr.meteors.draw(ctx, canvas, mgr.reducedFlash);

  // Big sun or moon — always a dominant presence on the horizon.
  const sunUp = (dn.sunAlt ?? 0) > 0.01;
  const celestialAlt = sunUp ? Math.max(dn.sunAlt, 0.15) : Math.max(dn.moonAlt, 0.25);
  const celestialYFrac = celestialYFracFor(celestialAlt);
  const celestialXFrac = celestialXFracFor(sunUp ? (dn.sunAz01 ?? 0.5) : (dn.moonAz01 ?? 0.65));
  if (sunUp) {
    mgr._drawCelestial?.(ctx, canvas, A, B, t, celestialYFrac, horizonFade(celestialAlt), celestialXFrac);
  } else {
    mgr._drawMoon(
      ctx, canvas, celestialYFrac, horizonFade(celestialAlt),
      0, celestialXFrac,
      0.5, 1.1, mgr._moonPhase01?.() ?? 0.55,
    );
  }

  const { from, to } = mgr.currentBlend || { from: A.name, to: B.name };
  const skyHorizon = mgr._rotated(mgr.lerpCache.get(A.sky[2], B.sky[2], t));
  const tint = ensureContrast(mgr._rotated(mgr.lerpCache.get(A.silhouette, B.silhouette, t)), skyHorizon, 0.16);

  const unravel = mgr.unravel || 0;
  const scroll = (key) => worldX * CodaDirector.delaminateRatio(LAYER_RATIOS[key], unravel);

  const stripsA = mgr.stripsFor(from);
  const stripsB = mgr.stripsFor(to);

  // Heat shimmer: a subtle horizontal distortion band near the horizon.
  const shimmerPhase = (mgr.tSec || 0) * 1.4;
  ctx.save();
  ctx.globalAlpha = 0.06 + 0.03 * Math.sin(shimmerPhase * 3);
  const hg = ctx.createLinearGradient(0, canvas.height * 0.55, 0, canvas.height * 0.75);
  hg.addColorStop(0, 'rgba(255, 200, 100, 0)');
  hg.addColorStop(0.5, 'rgba(255, 180, 80, 0.08)');
  hg.addColorStop(1, 'rgba(255, 200, 100, 0)');
  ctx.fillStyle = hg;
  ctx.fillRect(0, canvas.height * 0.55, canvas.width, canvas.height * 0.2);
  ctx.restore();

  const drawRange = (key) => {
    const yOff = Y_OFF[key] || 0;
    const sx = scroll(key);
    if (stripsA) blit(ctx, canvas, stripsA[key], sx, yOff, to === from ? 1 : 1 - t);
    if (to !== from && t > 0.02 && stripsB) blit(ctx, canvas, stripsB[key], sx, yOff, t);
  };

  drawRange('L2');
  drawRange('L3');

  // Neon edge glow between layers — road reflectors and signage.
  const edgeColor = A.edgeLight || B.edgeLight || null;
  if (edgeColor && phenomenaFull) {
    const { r, g, b } = hexToRgb(edgeColor);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = capFlashAlpha(0.06, false);
    const ng = ctx.createLinearGradient(0, canvas.height * 0.62, 0, canvas.height * 0.68);
    ng.addColorStop(0, `rgba(${r},${g},${b},0)`);
    ng.addColorStop(0.5, `rgba(${r},${g},${b},0.12)`);
    ng.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = ng;
    ctx.fillRect(0, canvas.height * 0.62, canvas.width, canvas.height * 0.06);
    ctx.restore();
  }

  // Particles: wind streaks, digital rain, flaresparks.
  const openA = mgr.openingGain;
  const mandalaColor = mgr._rotated(mgr.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t));
  const rimOn = mgr._perf ? mgr._perf.rimLightEnabled : true;
  const particleLights = rimOn
    ? [mgr.light, ...groundGlowLights(mgr.groundField ? mgr.groundField.activeGlowScreenLights(worldX, originX) : [], mandalaColor)].filter(Boolean)
    : null;
  ctx.save();
  if (openA < 0.999) ctx.globalAlpha = openA;
  mgr.fields.get(from)?.draw(ctx, particleMul, mandalaColor, unravel, particleLights);
  ctx.restore();
  if (to !== from && t > 0.02) {
    ctx.save(); ctx.globalAlpha = t * openA;
    mgr.fields.get(to)?.draw(ctx, particleMul, mandalaColor, unravel, particleLights);
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
