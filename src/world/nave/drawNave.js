// The Nave draw path. A cathedral interior that rebuilds itself every
// chorus. The parallax layers are vaulted bays and buttresses, not
// mountains. Stained glass color spill (edgeLight) and god rays replace
// aerial perspective. The "sky" is the vault ceiling.
import { drawTiledStrip } from '../SilhouetteGenerator.js';
import { CodaDirector } from '../../sim/CodaDirector.js';
import { ensureContrast } from '../../render/VisualStyle.js';
import { groundGlowLights } from '../../render/LightField.js';
import { celestialYFracFor, celestialXFracFor, horizonFade } from '../DayNight.js';
import { capFlashAlpha } from '../../ui/Accessibility.js';
import { hexToRgb } from '../../utils/color.js';

const LAYER_RATIOS = { L2: 0.03, L3: 0.08, L4: 0.18, L5: 0.44 };
const Y_OFF = { L2: 6, L3: 16, L4: 36, L5: 66 };

function blit(ctx, canvas, strip, scrollX, yOff, alpha = 1) {
  if (!strip) return;
  ctx.save();
  if (alpha < 0.999) ctx.globalAlpha = alpha;
  drawTiledStrip(ctx, strip, scrollX, canvas.width, canvas.height, yOff);
  ctx.restore();
}

export function drawNaveWorld(mgr, ctx, canvas, worldX, originX, A, B, t, dn, phenomenaFull, particleMul, groundView) {
  mgr._drawSky(ctx, canvas, A, B, t, 0.8);

  // Deliberately NOT wired here: BiomeManager's classic path draws
  // drawDeepSky/weaver/meteors (Midasus's sky-writing trail, ambient
  // constellations, reward-volley meteors) for the other newer world kinds,
  // but this file's own header says the "sky" here is an interior vault
  // ceiling, not open air -- open-sky constellations sailing across a
  // cathedral roof would contradict the space, not fill a gap in it.

  // The rose window: a stained-glass celestial, always visible. Use the
  // existing celestial renderer at moderate scale.
  const celestialAlt = 0.65;
  const celestialYFrac = celestialYFracFor(celestialAlt);
  const celestialXFrac = celestialXFracFor(0.5);
  mgr._drawCelestial?.(ctx, canvas, A, B, t, celestialYFrac, 1.0, celestialXFrac);

  // Stained glass color spill: the edgeLight bleeds across the stone.
  const edgeColor = A.edgeLight || B.edgeLight || null;
  if (edgeColor && phenomenaFull) {
    const { r, g, b } = hexToRgb(edgeColor);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const energy = mgr.energyCurves && typeof mgr.energyCurves.globalEnergyNorm === 'function'
      ? mgr.energyCurves.globalEnergyNorm(mgr.tSec * 1000) : 0.4;
    ctx.globalAlpha = capFlashAlpha(0.03 + 0.04 * energy, false);
    // Diagonal shafts of colored light from the windows.
    for (let i = 0; i < 4; i++) {
      const xBase = canvas.width * (0.1 + 0.25 * i);
      const sg = ctx.createLinearGradient(xBase, 0, xBase + 60, canvas.height * 0.7);
      sg.addColorStop(0, `rgba(${r},${g},${b},0.08)`);
      sg.addColorStop(0.5, `rgba(${r},${g},${b},0.03)`);
      sg.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = sg;
      ctx.fillRect(xBase - 10, 0, 80, canvas.height * 0.7);
    }
    ctx.restore();
  }

  const { from, to } = mgr.currentBlend || { from: A.name, to: B.name };
  const skyHorizon = mgr._rotated(mgr.lerpCache.get(A.sky[2], B.sky[2], t));
  const tint = ensureContrast(mgr._rotated(mgr.lerpCache.get(A.silhouette, B.silhouette, t)), skyHorizon, 0.16);

  const unravel = mgr.unravel || 0;
  const scroll = (key) => worldX * CodaDirector.delaminateRatio(LAYER_RATIOS[key], unravel);

  const stripsA = mgr.stripsFor(from);
  const stripsB = mgr.stripsFor(to);

  const drawRange = (key) => {
    const yOff = Y_OFF[key] || 0;
    const sx = scroll(key);
    // The strip bake is a single FLAT fill by design (SilhouetteGenerator: a
    // baked gradient sliced into independently-offset dance columns is a hard
    // seam at every column boundary), so a bare blit is a bare flat shape --
    // which is what these ranges were. _drawRidgeVolume is the only source of
    // shading depth a range has in ANY world, and it was reachable only from
    // the classic alpine path; every kind with its own draw function returned
    // before reaching it. Geology (snowcaps, sedimentary bedding) stays off
    // -- that half is alpine-specific. The shading half is not.
    if (stripsA) {
      const a = to === from ? 1 : 1 - t;
      blit(ctx, canvas, stripsA[key], sx, yOff, a);
      mgr._drawRidgeVolume(ctx, canvas, stripsA[key], sx, yOff, key, a, A.terrainEnergy ?? 1, 1, 1, { geology: false });
    }
    if (to !== from && t > 0.02 && stripsB) {
      blit(ctx, canvas, stripsB[key], sx, yOff, t);
      mgr._drawRidgeVolume(ctx, canvas, stripsB[key], sx, yOff, key, t, B.terrainEnergy ?? 1, 1, 1, { geology: false });
    }
  };

  drawRange('L2');
  drawRange('L3');

  // Particles: sunshine motes, censer smoke.
  const openA = mgr.openingGain;
  const mandalaColor = mgr._rotated(mgr.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t));
  const rimOn = mgr._perf ? mgr._perf.rimLightEnabled : true;
  const particleLights = rimOn
    ? [mgr.light, ...groundGlowLights(mgr.groundField ? mgr.groundField.activeGlowScreenLights(worldX, originX) : [], mandalaColor)].filter(Boolean)
    : null;
  ctx.save();
  if (openA < 0.999) ctx.globalAlpha = openA;
  mgr.fields.get(from)?.draw(ctx, particleMul * 0.7, mandalaColor, unravel, particleLights);
  ctx.restore();
  if (to !== from && t > 0.02) {
    ctx.save(); ctx.globalAlpha = t * openA;
    mgr.fields.get(to)?.draw(ctx, particleMul * 0.7, mandalaColor, unravel, particleLights);
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
