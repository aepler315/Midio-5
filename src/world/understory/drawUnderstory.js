// Understory draw path. A dense forest floor where light filters through
// a living canopy. God rays and dappled light replace haze. The parallax
// layers are trunk columns and undergrowth, not ridges. Spores, pollen,
// and fireflies instead of weather.
import { drawTiledStrip } from '../SilhouetteGenerator.js';
import { CodaDirector } from '../../sim/CodaDirector.js';
import { ensureContrast, styleDials } from '../../render/VisualStyle.js';
import { groundGlowLights } from '../../render/LightField.js';
import { celestialYFracFor, celestialXFracFor, horizonFade } from '../DayNight.js';
import { capFlashAlpha, flashCompositeOp } from '../../ui/Accessibility.js';
import { sampleManagerMusic } from '../WorldMusic.js';
import { canopyGrowth, shaftOpen, sporeBurst, boundaryLift01 } from './Canopy.js';

const LAYER_RATIOS = { L2: 0.03, L3: 0.08, L4: 0.20, L5: 0.48 };
const Y_OFF = { L2: 8, L3: 18, L4: 38, L5: 66 };

function blit(ctx, canvas, strip, scrollX, yOff, alpha = 1) {
  if (!strip) return;
  ctx.save();
  if (alpha < 0.999) ctx.globalAlpha = alpha;
  drawTiledStrip(ctx, strip, scrollX, canvas.width, canvas.height, yOff);
  ctx.restore();
}

export function drawUnderstoryWorld(mgr, frame) {
  const { ctx, canvas, worldX, originX, A, B, t, dn, phenomenaFull, particleMul, groundView, skyVoyage } = frame;
  const music = sampleManagerMusic(mgr, { energyCurves: mgr.energyCurves, worldRhythm: mgr.worldRhythm });
  const lift = boundaryLift01(mgr.sections?.[mgr._lastSectionIdx], mgr.sections?.[mgr._lastSectionIdx - 1]);
  const growth = canopyGrowth({ energy: music.energy, orogeny: mgr.orogenyGrowth ?? 0 });
  const open = shaftOpen({ growth, reveal: music.reveal, lift });

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

  // Canopy light shafts. Spread and brightness follow growth and earned
  // phrases, not elapsed time. Continuity sway is WorldMusic.current,
  // which is already zero under reduced flash. Gated the same way every
  // other heavy-post-fx layer in BiomeManager is.
  const heavyOk = !mgr._perf || mgr._perf.heavyPostFx;
  if (phenomenaFull && heavyOk) {
    const sway = music.current * canvas.width * 0.03;
    ctx.save();
    ctx.globalCompositeOperation = flashCompositeOp(mgr.reducedFlash);
    for (let i = 0; i < 3; i++) {
      const xBase = canvas.width * (0.15 + 0.3 * i) + sway * (i % 2 ? 1 : -1);
      ctx.globalAlpha = capFlashAlpha(0.04 + 0.14 * open, mgr.reducedFlash);
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
      mgr._drawRidgeVolume(ctx, canvas, stripsA[key], sx, yOff, key, a, A.terrainEnergy ?? 1, 1, 1, { geology: false, geometry: 'static' });
    }
    if (to !== from && t > 0.02 && stripsB) {
      blit(ctx, canvas, stripsB[key], sx, yOff, t);
      mgr._drawRidgeVolume(ctx, canvas, stripsB[key], sx, yOff, key, t, B.terrainEnergy ?? 1, 1, 1, { geology: false, geometry: 'static' });
    }
  };

  drawRange('L2');
  // Green haze between far layers — forest atmosphere. Growth thickens it.
  ctx.save();
  ctx.globalAlpha = 0.03 + 0.05 * growth;
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

  if (particleMul > 0) drawSpores(ctx, canvas, worldX, music, mgr.reducedFlash, particleMul);

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

function drawSpores(ctx, canvas, worldX, music, reducedFlash, particleMul) {
  ctx.save();
  ctx.globalCompositeOperation = flashCompositeOp(reducedFlash);
  ctx.fillStyle = '#d8f0a8';
  for (let colony = 0; colony < 4; colony++) {
    const scroll = worldX * (0.05 + colony * 0.012);
    const x = ((canvas.width * (colony + 0.5) / 4 - scroll) % canvas.width + canvas.width) % canvas.width;
    const y = canvas.height * (0.38 + (colony % 3) * 0.12) + music.current * 6;
    const burst = sporeBurst(music.accent, music.group, colony);
    ctx.globalAlpha = capFlashAlpha(Math.min(1, particleMul) * (0.12 + burst * 0.55), reducedFlash);
    for (let dot = 0; dot < 3; dot++) {
      ctx.beginPath();
      ctx.arc(x + dot * 8, y + Math.sin(dot * 2 + colony) * 6, 1.4 + burst * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
