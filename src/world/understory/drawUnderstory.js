// Understory draw path. A dense forest floor where light filters through
// a living canopy. God rays and dappled light replace haze. The parallax
// layers are trunk columns and undergrowth, not ridges. Spores, pollen,
// and fireflies instead of weather.
import { drawTiledStrip } from '../SilhouetteGenerator.js';
import { CodaDirector } from '../../sim/CodaDirector.js';
import { ensureContrast, styleDials } from '../../render/VisualStyle.js';
import { groundGlowLights } from '../../render/LightField.js';
import { celestialYFracFor, celestialXFracFor, horizonFade } from '../DayNight.js';

const LAYER_RATIOS = { L2: 0.03, L3: 0.08, L4: 0.20, L5: 0.48 };
const Y_OFF = { L2: 8, L3: 18, L4: 38, L5: 66 };

function blit(ctx, canvas, strip, scrollX, yOff, alpha = 1) {
  if (!strip) return;
  ctx.save();
  if (alpha < 0.999) ctx.globalAlpha = alpha;
  drawTiledStrip(ctx, strip, scrollX, canvas.width, canvas.height, yOff);
  ctx.restore();
}

export function drawUnderstoryWorld(mgr, ctx, canvas, worldX, originX, A, B, t, dn, phenomenaFull, particleMul, groundView, skyVoyage = null) {
  mgr._drawSky(ctx, canvas, A, B, t, 0.7);

  // Deep-sky layer ported in from BiomeManager's classic path. The canopy
  // blocks direct view of the SUN (see the veiled-celestial draw below),
  // but says nothing about the rest of the sky -- gaps in the canopy are
  // exactly what the god-ray shafts a few lines down are already showing.
  // Midasus's sky-writing trail, the ambient per-note constellations, and
  // reward-volley meteors never rendered here at all: the calls were left
  // behind when Understory got its own draw function.
  mgr.drawDeepSky(ctx, skyVoyage, canvas);
  const skyA = styleDials(mgr.visualStyle).skyWireAlpha ?? 1;
  if (phenomenaFull && skyA > 0.02) {
    const nightAlphaMul = (1 + 1.2 * 0.7) * Math.max(0.25, skyA);
    mgr.weaver.draw(ctx, canvas, mgr.reducedFlash, nightAlphaMul);
  }
  if (phenomenaFull) mgr.meteors.draw(ctx, canvas, mgr.reducedFlash);

  // The sun filters through the canopy — never directly visible, but its
  // presence is felt through god rays and dappled light patches.
  const sunAlt = Math.max(dn.sunAlt ?? 0.4, 0.35);
  const celestialYFrac = celestialYFracFor(sunAlt);
  const celestialXFrac = celestialXFracFor(dn.sunAz01 ?? 0.5);
  // Veiled celestial: the canopy blocks direct view, so draw at reduced alpha.
  if (mgr._drawCelestial) {
    ctx.save();
    ctx.globalAlpha = 0.3;
    mgr._drawCelestial(ctx, canvas, A, B, t, celestialYFrac, horizonFade(sunAlt) * 0.4, celestialXFrac);
    ctx.restore();
  }

  // Canopy light shafts: diagonal beams of filtered sunlight.
  if (phenomenaFull) {
    const phase = (mgr.tSec || 0) * 0.3;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const xBase = canvas.width * (0.15 + 0.3 * i + 0.04 * Math.sin(phase + i * 1.7));
      const shaftAlpha = 0.025 + 0.015 * Math.sin(phase * 0.7 + i * 2.3);
      ctx.globalAlpha = shaftAlpha;
      ctx.beginPath();
      ctx.moveTo(xBase - 20, 0);
      ctx.lineTo(xBase + 40, 0);
      ctx.lineTo(xBase + 80, canvas.height * 0.8);
      ctx.lineTo(xBase - 10, canvas.height * 0.8);
      ctx.closePath();
      ctx.fillStyle = 'rgba(180, 220, 120, 0.15)';
      ctx.fill();
    }
    ctx.restore();
  }

  const { from, to } = mgr.currentBlend || { from: A.name, to: B.name };
  const skyHorizon = mgr._rotated(mgr.lerpCache.get(A.sky[2], B.sky[2], t));
  const tint = ensureContrast(mgr._rotated(mgr.lerpCache.get(A.silhouette, B.silhouette, t)), skyHorizon, 0.14);

  const unravel = mgr.unravel || 0;
  const scroll = (key) => worldX * CodaDirector.delaminateRatio(LAYER_RATIOS[key], unravel);

  const stripsA = mgr.stripsFor(from);
  const stripsB = mgr.stripsFor(to);

  // The strip bake is a single FLAT fill by design (SilhouetteGenerator: a
  // baked gradient sliced into independently-offset dance columns is a hard
  // seam at every column boundary), so a bare blit is a bare flat shape --
  // which is exactly what these ranges were. _drawRidgeVolume is the only
  // source of shading depth a range has in any world, and it was reachable
  // only from the classic alpine path; every kind with its own draw function
  // returned before it. Geology off: trunks and canopy are not sedimentary,
  // and snowcaps in a forest understory would be nonsense. The shading is
  // universal, the rock is not.
  const drawRange = (key) => {
    const yOff = Y_OFF[key] || 0;
    const sx = scroll(key);
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
  // Green haze between far layers — forest atmosphere.
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.fillStyle = 'rgba(30, 60, 20, 0.5)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  drawRange('L3');

  // Particles: pollen, spores, fireflies.
  const openA = mgr.openingGain;
  const mandalaColor = mgr._rotated(mgr.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t));
  const rimOn = mgr._perf ? mgr._perf.rimLightEnabled : true;
  const particleLights = rimOn
    ? [mgr.light, ...groundGlowLights(mgr.groundField ? mgr.groundField.activeGlowScreenLights(worldX, originX) : [], mandalaColor)].filter(Boolean)
    : null;
  ctx.save();
  if (openA < 0.999) ctx.globalAlpha = openA;
  mgr.fields.get(from)?.draw(ctx, particleMul * 0.8, mandalaColor, unravel, particleLights);
  ctx.restore();
  if (to !== from && t > 0.02) {
    ctx.save(); ctx.globalAlpha = t * openA;
    mgr.fields.get(to)?.draw(ctx, particleMul * 0.8, mandalaColor, unravel, particleLights);
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
