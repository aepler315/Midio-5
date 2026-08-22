// After Hours draw path. BiomeManager.draw() hands off here for city worlds.
//
// Translated from alpine: ridge portrait → skyline, parallax, haze, rain,
// ground field (street breathing with bass), section transitions, film
// finish (caller), characters (caller), window occupancy as orogeny.
//
// Scrapped: mountain dance / GeoCrest / orogeny-as-growth / ocean /
// spectrum massif / horizon EQ / mandala / cymatics / chaos ribbon /
// space ridge / connector hills / far vignettes / sun / aurora / canopy.
import { drawTiledStrip } from '../SilhouetteGenerator.js';
import { windowOccupancy } from './CitySilhouette.js';
import { CodaDirector } from '../../sim/CodaDirector.js';
import { capFlashAlpha } from '../../ui/Accessibility.js';
import { hexToRgb } from '../../utils/color.js';
import { groundGlowLights } from '../../render/LightField.js';
import { ensureContrast } from '../../render/VisualStyle.js';
import { celestialYFracFor, celestialXFracFor, horizonFade } from '../DayNight.js';

const LAYER_RATIOS = { L2: 0.10, L3: 0.18, L4: 0.30, L5: 0.65 };
const AERIAL_PULL = { L2: 0.50, L3: 0.32, L4: 0.14, L5: 0 };
const NIGHT_SKY = '#05060c';
const Y_OFF = { L2: -18, L3: 8, L4: 36, L5: 72 };

function layerTint(mgr, tint, skyHorizon, layerKey) {
  const pull = AERIAL_PULL[layerKey] || 0;
  return pull > 0.001 ? mgr.lerpCache.get(tint, skyHorizon, pull) : tint;
}

function blit(ctx, canvas, strip, scrollX, yOff, alpha = 1) {
  if (!strip) return;
  ctx.save();
  if (alpha < 0.999) ctx.globalAlpha = alpha;
  drawTiledStrip(ctx, strip, scrollX, canvas.width, canvas.height, yOff);
  ctx.restore();
}

function blitWindows(ctx, canvas, strip, scrollX, yOff, occ, neonHex) {
  if (!strip?.windows || occ < 0.02) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = capFlashAlpha(0.38 + 0.62 * occ, false);
  drawTiledStrip(ctx, strip.windows, scrollX, canvas.width, canvas.height, yOff);
  if (neonHex) {
    ctx.globalAlpha = capFlashAlpha(0.12 * occ, false);
    ctx.fillStyle = neonHex;
    // Sparse neon bands near the crest — a few signs, not a rave.
    const y = canvas.height - strip.height + yOff + 28;
    ctx.fillRect(0, y, canvas.width, 3);
  }
  ctx.restore();
}

export function drawCityWorld(mgr, ctx, canvas, worldX, originX, A, B, t, dn, phenomenaFull, particleMul, groundView) {
  const night = 1;
  mgr._drawSky(ctx, canvas, A, B, t, night);

  const moonAlt = Math.max(dn.moonAlt, 0.35);
  const celestialYFrac = celestialYFracFor(moonAlt);
  const celestialXFrac = celestialXFracFor(dn.moonAz01 ?? 0.72);
  mgr._drawMoon(
    ctx, canvas, celestialYFrac, horizonFade(moonAlt),
    0,
    celestialXFrac,
    0.5, 1.15, mgr._moonPhase01?.() ?? 0.6,
  );

  const { from, to } = mgr.currentBlend || { from: A.name, to: B.name };
  const skyHorizon = mgr._rotated(mgr.lerpCache.get(A.sky[2], B.sky[2], t));
  const skyHorizonNight = mgr.lerpCache.get(skyHorizon, NIGHT_SKY, 0.35);
  const tint = ensureContrast(mgr._rotated(mgr.lerpCache.get(A.silhouette, B.silhouette, t)), skyHorizonNight, 0.16);

  const unravel = mgr.unravel || 0;
  const scroll = (key) => worldX * CodaDirector.delaminateRatio(LAYER_RATIOS[key], unravel);

  const energy = mgr.energyCurves && typeof mgr.energyCurves.globalEnergyNorm === 'function'
    ? mgr.energyCurves.globalEnergyNorm(mgr.tSec * 1000)
    : 0.4;
  const occ = windowOccupancy({
    energy,
    openingGain: mgr.openingGain ?? 1,
    orogeny: mgr.orogenyGrowth ?? 0.5,
    fever: mgr.fever ?? 0,
  });
  const neonHex = A.edgeLight || B.edgeLight || null;

  const stripsA = mgr.strips.get(from);
  const stripsB = mgr.strips.get(to);
  const hazeLayers = mgr._perf ? mgr._perf.hazeLayers : 3;
  const arc = { hazeWarm: 0.15 };

  const drawRange = (key) => {
    const yOff = Y_OFF[key] || 0;
    const sx = scroll(key);
    const lt = layerTint(mgr, tint, skyHorizonNight, key);
    ctx.save();
    ctx.fillStyle = lt; // unused; strips are pre-tinted. keep transform clean.
    ctx.restore();
    if (stripsA) {
      blit(ctx, canvas, stripsA[key], sx, yOff, to === from ? 1 : 1 - t);
      blitWindows(ctx, canvas, stripsA[key], sx, yOff, occ * (to === from ? 1 : 1 - t), key === 'L4' ? neonHex : null);
    }
    if (to !== from && t > 0.02 && stripsB) {
      blit(ctx, canvas, stripsB[key], sx, yOff, t);
      blitWindows(ctx, canvas, stripsB[key], sx, yOff, occ * t, key === 'L4' ? neonHex : null);
    }
  };

  drawRange('L2');
  if (hazeLayers >= 3) mgr._drawHaze(ctx, canvas, 'L2', A, B, t, arc);
  drawRange('L3');
  mgr._drawHaze(ctx, canvas, 'L3', A, B, t, arc);

  const openA = mgr.openingGain;
  const rimOn = mgr._perf ? mgr._perf.rimLightEnabled : true;
  const mandalaColor = mgr._rotated(mgr.lerpCache.get(A.celestial.haloColor, B.celestial.haloColor, t));
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
  if (mgr._activeWeatherIntensity > 0.01) {
    const weatherField = mgr.weatherFields.get(mgr.weatherState?.kind);
    if (weatherField) weatherField.draw(ctx, mgr._activeWeatherIntensity * particleMul, mandalaColor, unravel, particleLights);
  }

  mgr._drawFogBanks(ctx, canvas);

  drawRange('L4');
  if (hazeLayers >= 3) mgr._drawHaze(ctx, canvas, 'L4', A, B, t, arc);
  drawRange('L5');

  const groundCanvas = groundView ? groundView.stage : canvas;
  if (groundView) groundView.apply();
  mgr._drawGround(ctx, groundCanvas, worldX, originX, A, B, t, tint);
  drawWetSheen(ctx, groundCanvas, occ);
  mgr._drawTerrainFooting(ctx, groundCanvas, worldX, originX, A, B, t);
  drawStreetLamps(ctx, groundCanvas, worldX, mgr, occ, mandalaColor);
  mgr._drawFlood(ctx, groundCanvas);
  mgr._drawTransitionOverlays(ctx, groundCanvas, B);
}

function drawWetSheen(ctx, canvas, occ) {
  ctx.save();
  const gy = canvas.height * 0.72;
  const g = ctx.createLinearGradient(0, gy, 0, canvas.height);
  g.addColorStop(0, 'rgba(180, 200, 220, 0)');
  g.addColorStop(0.15, `rgba(160, 180, 200, ${0.04 + 0.05 * occ})`);
  g.addColorStop(1, 'rgba(20, 24, 32, 0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(0, gy, canvas.width, canvas.height - gy);
  ctx.restore();
}

function drawStreetLamps(ctx, canvas, worldX, mgr, occ, halo) {
  const gy = mgr.groundField ? mgr.groundField.heightAt(worldX) : mgr.groundY;
  const spacing = 220;
  const phase = ((worldX * 0.65) % spacing + spacing) % spacing;
  const { r, g, b } = hexToRgb(halo || '#e0b060');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let x = -phase; x < canvas.width + 40; x += spacing) {
    const px = x;
    const glow = 0.10 + 0.12 * occ;
    const rad = ctx.createRadialGradient(px, gy - 36, 2, px, gy - 8, 70);
    rad.addColorStop(0, `rgba(${r},${g},${b},${glow})`);
    rad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = rad;
    ctx.beginPath();
    ctx.arc(px, gy - 20, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(${r},${g},${b},${0.35 + 0.4 * occ})`;
    ctx.fillRect(px - 1.5, gy - 52, 3, 40);
    ctx.beginPath();
    ctx.arc(px, gy - 54, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
