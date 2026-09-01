// Far Side draw path. An airless body: no haze, no aerial perspective,
// no weather, no atmosphere effects. Distance carried by parallax rate
// and contrast only. The sky is black and full of stars at noon.
// The primary (a gas giant) occupies a quarter of the frame.
import { drawTiledStrip } from '../SilhouetteGenerator.js';
import { CodaDirector } from '../../sim/CodaDirector.js';
import { ensureContrast, styleDials } from '../../render/VisualStyle.js';
import { groundGlowLights } from '../../render/LightField.js';
import { celestialYFracFor, celestialXFracFor, horizonFade } from '../DayNight.js';

const LAYER_RATIOS = { L2: 0.04, L3: 0.10, L4: 0.22, L5: 0.50 };
const Y_OFF = { L2: 6, L3: 18, L4: 40, L5: 68 };

function blit(ctx, canvas, strip, scrollX, yOff, alpha = 1) {
  if (!strip) return;
  ctx.save();
  if (alpha < 0.999) ctx.globalAlpha = alpha;
  drawTiledStrip(ctx, strip, scrollX, canvas.width, canvas.height, yOff);
  ctx.restore();
}

export function drawFarsideWorld(mgr, ctx, canvas, worldX, originX, A, B, t, dn, phenomenaFull, particleMul, groundView, skyVoyage = null) {
  mgr._drawSky(ctx, canvas, A, B, t, 1);

  // Deep-sky layer ported in from BiomeManager's classic path -- an airless
  // sky "full of stars" is exactly where Midasus's sky-writing trail, the
  // ambient per-note constellations, and reward-volley meteors belong most.
  // This never rendered here before: the classic path's calls were left
  // behind when Far Side got its own draw function.
  mgr.drawDeepSky(ctx, skyVoyage, canvas);
  const skyA = styleDials(mgr.visualStyle).skyWireAlpha ?? 1;
  if (phenomenaFull && skyA > 0.02) {
    const nightAlphaMul = (1 + 1.2 * 1) * Math.max(0.25, skyA);
    mgr.weaver.draw(ctx, canvas, mgr.reducedFlash, nightAlphaMul);
  }
  if (phenomenaFull) mgr.meteors.draw(ctx, canvas, mgr.reducedFlash);

  // Stars: always at full brightness, never twinkle (no atmosphere).
  // Use the existing star catalogue at full fidelity.
  const showStars = true;
  if (showStars && mgr.starCatalogue) {
    ctx.save();
    ctx.globalAlpha = 1.0;
    mgr.starCatalogue.draw(ctx, canvas, mgr.tSec * 1000, {
      twinkle: false,
      night: 1,
      reducedFlash: mgr.reducedFlash,
    });
    ctx.restore();
  }

  // The primary: a large celestial body (gas giant). Use the existing moon
  // renderer at increased scale — the dominant flag on the palette already
  // drives the sizing.
  const moonAlt = Math.max(dn.moonAlt, 0.55);
  const celestialYFrac = celestialYFracFor(moonAlt);
  const celestialXFrac = celestialXFracFor(dn.moonAz01 ?? 0.65);
  mgr._drawMoon(
    ctx, canvas, celestialYFrac, horizonFade(moonAlt),
    0,
    celestialXFrac,
    0.5, 1.2, mgr._moonPhase01?.() ?? 0.72,
  );

  const { from, to } = mgr.currentBlend || { from: A.name, to: B.name };
  const skyHorizon = mgr._rotated(mgr.lerpCache.get(A.sky[2], B.sky[2], t));
  // No aerial perspective: tint is the raw silhouette color with no sky pull.
  const tint = ensureContrast(mgr._rotated(mgr.lerpCache.get(A.silhouette, B.silhouette, t)), skyHorizon, 0.18);

  const unravel = mgr.unravel || 0;
  const scroll = (key) => worldX * CodaDirector.delaminateRatio(LAYER_RATIOS[key], unravel);

  const stripsA = mgr.stripsFor(from);
  const stripsB = mgr.stripsFor(to);

  // Hard terminator shadow: a slow sweep across the song. In lieu of
  // the full DayNight cycle, the terminator is a simple gradient overlay
  // that shifts with song progress.
  const terminatorPhase = (mgr.tSec || 0) / Math.max(1, (mgr.durationMs || 180000) / 1000);
  const terminatorX = canvas.width * (0.2 + 0.6 * terminatorPhase);
  ctx.save();
  const tg = ctx.createLinearGradient(terminatorX - 80, 0, terminatorX + 80, 0);
  tg.addColorStop(0, 'rgba(0,0,0,0)');
  tg.addColorStop(0.5, 'rgba(0,0,0,0.08)');
  tg.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = tg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

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
  // No haze between layers — vacuum.
  drawRange('L3');

  // Meteor impacts: use existing meteor shower as silent ballistic impacts.
  if (phenomenaFull && mgr.meteors) {
    mgr.meteors.draw(ctx, canvas, mgr.reducedFlash);
  }

  // Particles — sparse regolith dust, no secondary lights (no atmosphere
  // to scatter them).
  const openA = mgr.openingGain;
  const mandalaColor = mgr._rotated(mgr.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t));
  ctx.save();
  if (openA < 0.999) ctx.globalAlpha = openA;
  mgr.fields.get(from)?.draw(ctx, particleMul * 0.6, mandalaColor, unravel, null);
  ctx.restore();
  if (to !== from && t > 0.02) {
    ctx.save(); ctx.globalAlpha = t * openA;
    mgr.fields.get(to)?.draw(ctx, particleMul * 0.6, mandalaColor, unravel, null);
    ctx.restore();
  }

  drawRange('L4');
  // No haze, no connector hills, no fog banks.
  drawRange('L5');

  // Ground
  const groundCanvas = groundView ? groundView.stage : canvas;
  if (groundView) groundView.apply();
  mgr._drawGround(ctx, groundCanvas, worldX, originX, A, B, t, tint);
  mgr._drawTerrainFooting(ctx, groundCanvas, worldX, originX, A, B, t);
  mgr._drawFlood(ctx, groundCanvas);
  mgr._drawTransitionOverlays(ctx, groundCanvas, B);
}
