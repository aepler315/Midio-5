// Orchestrates the 8-layer parallax contract (spec §4.1.1), biome
// scheduling via novelty-curve segmentation (§4.1.3), and gamma-correct
// profile crossfading (§4.1.4). Each biome is pure data (BiomeProfiles.js);
// this file is the one place that knows how to render the contract.
import { BIOMES } from './BiomeProfiles.js';
import { generateSilhouette, drawTiledStrip } from './SilhouetteGenerator.js';
import { ParticleField } from './ParticleField.js';
import { clamp, clamp01, smoothstep, mulberry32, hashSeed } from '../utils/math.js';
import { LerpCache, hexToRgb } from '../utils/color.js';
import { ValueNoise1D, ridged } from '../utils/noise.js';
import { Role } from '../core/NoteEvent.js';

const LAYER_RATIOS = { L1: 0.05, L2: 0.10, L3: 0.18, L4: 0.30, L5: 0.65, L6: 1.00, L7: 1.20 };
const WORLD_SPEED_PX_S = 220;
const STRIP_HEIGHT = 320; // matches generateSilhouette's default (SilhouetteGenerator.js); kept here so the silhouette/ground seam-gap math stays resolution-independent (ground-horizon-depth).

// Per-layer depth model (ground-horizon-depth). nearer = more opaque = lower.
// `alpha` delivers atmospheric perspective (the already-drawn sky shows through
// distant ridges); `yOffsetPct` × the silhouette/ground gap closes the seam for
// the nearest layer (L5 pins to the ground top). Consumed in _drawLayer + _drawMountainEQ.
export const DEPTH = Object.freeze({
  L2: { alpha: 0.50, yOffsetPct: 0.00 },   // farthest, unchanged bottom anchor
  L3: { alpha: 0.66, yOffsetPct: 0.33 },
  L4: { alpha: 0.82, yOffsetPct: 0.66 },
  L5: { alpha: 0.95, yOffsetPct: 1.00 },   // nearest, pinned to ground top
});

export function layerDepth(key) {
  return DEPTH[key] ?? { alpha: 1, yOffsetPct: 0 };
}

export class BiomeManager {
  constructor({ conductor, paramBus, energyCurves, durationMs, canvasWidth, canvasHeight, groundY, songSeed }) {
    this.conductor = conductor;
    this.paramBus = paramBus || null;
    this.energyCurves = energyCurves;
    this.w = canvasWidth;
    this.h = canvasHeight;
    this.groundY = groundY;
    this.lerpCache = new LerpCache();
    this.tSec = 0;
    this._starSeed = mulberry32(9001);
    this.stars = Array.from({ length: 40 }, () => ({
      x: this._starSeed() * this.w, y: this._starSeed() * this.h * 0.6, phase: this._starSeed() * Math.PI * 2,
    }));
    this._glitchTimer = 2 + this._starSeed() * 3;
    this._glitchActiveMs = 0;
    this._scanlineY = 0;
    this._pylonFlash = 0;

    // Horizon EQ state (item 2): 7 bands, two-stage envelope.
    this._eqSmooth = new Float32Array(7);
    this._ridgeNoise = [
      new ValueNoise1D(7101, 256),
      new ValueNoise1D(7102, 256),
      new ValueNoise1D(7103, 256),
    ];

    this.strips = new Map(); // biomeName -> { L2, L3, L4, L5 }
    for (const b of BIOMES) {
      const seed = hashSeed(b.name);
      this.strips.set(b.name, {
        L2: generateSilhouette({ seed: seed + 1, octaves: 1, amplitude: 0.20, baseline: 0.45, color: b.silhouette }),
        L3: generateSilhouette({ seed: seed + 2, octaves: 2, amplitude: 0.26, baseline: 0.55, color: b.silhouette }),
        L4: generateSilhouette({ seed: seed + 3, octaves: 3, amplitude: 0.34, baseline: 0.70, color: b.silhouette }),
        L5: generateSilhouette({ seed: seed + 4, octaves: 2, amplitude: 0.22, baseline: 0.85, color: b.silhouette }),
      });
    }

    this.fields = new Map(); // biomeName -> ParticleField
    for (const b of BIOMES) this.fields.set(b.name, new ParticleField(b.particles, canvasWidth, canvasHeight, hashSeed(b.name + 'p')));

    this._buildSchedule(conductor.barGrid, energyCurves, durationMs, songSeed);

    conductor.onBar(() => { this._scanlineActive = true; this._scanlineY = 0; });
    conductor.on(Role.RHYTHM, (evt) => { if (evt.kick) this._pylonFlash = 1; });
  }

  _buildSchedule(barGrid, energyCurves, durationMs, songSeed) {
    let barTimes = barGrid.length >= 8 ? barGrid.map((b) => b.ms) : this._evenSplit(durationMs, 8);
    if (barTimes.length < 2) barTimes = [0, durationMs];

    const vectors = barTimes.map((ms) => (energyCurves ? energyCurves.sampleAll(ms) : new Array(7).fill(0)));
    const means = barTimes.map((_, i) => {
      const start = Math.max(0, i - 3);
      const slice = vectors.slice(start, i + 1);
      const avg = new Array(7).fill(0);
      for (const v of slice) for (let k = 0; k < 7; k++) avg[k] += v[k] / slice.length;
      return avg;
    });
    const novelty = barTimes.map((_, i) => {
      if (i < 4) return 0;
      let d = 0;
      for (let k = 0; k < 7; k++) d += (means[i][k] - means[i - 4][k]) ** 2;
      return Math.sqrt(d);
    });

    const minGap = 8;
    const peaks = [];
    const sorted = novelty.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    for (const [v, i] of sorted) {
      if (peaks.length >= 7) break;
      if (v <= 1e-6) continue;
      if (peaks.some((p) => Math.abs(p - i) < minGap)) continue;
      peaks.push(i);
    }
    peaks.sort((a, b) => a - b);

    const cuts = [0, ...peaks, barTimes.length - 1];
    const rand = mulberry32(songSeed >>> 0);
    const order = shuffle(BIOMES.map((b) => b.name), rand);

    this.sections = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      if (cuts[i + 1] <= cuts[i]) continue;
      this.sections.push({
        startMs: barTimes[cuts[i]],
        endMs: i === cuts.length - 2 ? durationMs : barTimes[cuts[i + 1]],
        profile: order[i % order.length],
        barMs: (barTimes[Math.min(barTimes.length - 1, cuts[i] + 1)] - barTimes[cuts[i]]) || 500,
      });
    }
    if (this.sections.length === 0) this.sections = [{ startMs: 0, endMs: durationMs, profile: order[0], barMs: 500 }];
  }

  _evenSplit(durationMs, n) {
    const out = [];
    for (let i = 0; i <= n; i++) out.push((i / n) * durationMs);
    return out;
  }

  _sectionAt(nowMs) {
    let idx = this.sections.length - 1;
    for (let i = 0; i < this.sections.length; i++) {
      if (this.sections[i].startMs <= nowMs) idx = i; else break;
    }
    return idx;
  }

  _blend(nowMs) {
    const idx = this._sectionAt(nowMs);
    const sec = this.sections[idx];
    if (idx === 0) return { from: sec.profile, to: sec.profile, t: 1 };
    const fadeWindowMs = 4 * sec.barMs;
    const t = smoothstep(0, 1, (nowMs - sec.startMs) / fadeWindowMs);
    return { from: this.sections[idx - 1].profile, to: sec.profile, t };
  }

  _profile(name) { return BIOMES.find((b) => b.name === name); }

  edgeLight(nowMs = 0) {
    const { from, to, t } = this._blend(nowMs);
    const A = this._profile(from), B = this._profile(to);
    if (A.edgeLight && B.edgeLight) return this.lerpCache.get(A.edgeLight, B.edgeLight, t);
    if (t > 0.5) return B.edgeLight || null;
    return A.edgeLight || null;
  }

  update(nowMs, dtSec, energyCurves, calm, perfMul = 1) {
    this.tSec = nowMs / 1000;
    this._calmC = calm ? calm.C : 0;
    const { from, to, t } = this._blend(nowMs);
    this.currentBlend = { from, to, t };

    this.fields.get(from).update(dtSec, this.tSec, energyCurves, nowMs, this._calmC, perfMul);
    if (to !== from) this.fields.get(to).update(dtSec, this.tSec, energyCurves, nowMs, this._calmC, perfMul);

    if (this._scanlineActive) {
      this._scanlineY += dtSec * this.h * 2.2;
      if (this._scanlineY > this.h) this._scanlineActive = false;
    }
    this._pylonFlash = Math.max(0, this._pylonFlash - dtSec / 0.15);

    this._glitchActiveMs -= dtSec * 1000;
    this._glitchTimer -= dtSec;
    if (this._glitchTimer <= 0) { this._glitchActiveMs = 60; this._glitchTimer = 2.5 + this._starSeed() * 3.5; }

    // Horizon EQ smoothing (item 2): two-stage attack/release per band.
    if (energyCurves && this.paramBus) {
      const bands = energyCurves.sampleAll(nowMs);
      const sens = this.paramBus.live.eqSensitivity;
      for (let i = 0; i < 7; i++) {
        const target = clamp(bands[i] * sens, 0, 1);
        const cur = this._eqSmooth[i];
        const tau = target >= cur ? 0.08 : 0.60;
        const alpha = 1 - Math.exp(-dtSec / tau);
        this._eqSmooth[i] += alpha * (target - cur);
      }
    }
  }

  draw(ctx, canvas, worldX, groundField = null, nowMs = 0, calmC = 0, perfLevel = 0) {
    this._calmC = calmC;
    const { from, to, t } = this.currentBlend || { from: this.sections[0].profile, to: this.sections[0].profile, t: 1 };
    const A = this._profile(from), B = this._profile(to);

    this._drawSky(ctx, canvas, A, B, t);
    this._drawCelestial(ctx, canvas, A, B, t);

    // EQ mountain ridgelines between celestial and L2 silhouette strips.
    this._drawMountainEQ(ctx, canvas, worldX, A, B, t, perfLevel);

    const scrollX0 = worldX * LAYER_RATIOS.L2, scrollX1 = worldX * LAYER_RATIOS.L3;
    const scrollX2 = worldX * LAYER_RATIOS.L4, scrollX3 = worldX * LAYER_RATIOS.L5;
    const tint = this.lerpCache.get(A.silhouette, B.silhouette, t);

    this._drawLayer(ctx, canvas, 'L2', scrollX0, tint, t, A, B);
    this._drawLayer(ctx, canvas, 'L3', scrollX1, tint, t, A, B);

    // Ambient particle field lives roughly at mid-depth.
    this.fields.get(from).draw(ctx);
    if (to !== from && t > 0.02) { ctx.save(); ctx.globalAlpha = t; this.fields.get(to).draw(ctx); ctx.restore(); }

    this._drawLayer(ctx, canvas, 'L4', scrollX2, tint, t, A, B);
    this._drawPineForestEQ(ctx, canvas, worldX, A, B, t);
    this._drawLayer(ctx, canvas, 'L5', scrollX3, tint, t, A, B);

    this._drawGround(ctx, canvas, worldX, A, B, t, groundField, nowMs);
  }

  drawForeground(ctx, canvas, worldX, calmC = 0) {
    // L7: oversized, blurred, low-alpha foreground veil (spec §4.1.1).
    // Calm raises the veil slightly so the world feels closer/peaceful.
    ctx.save();
    ctx.globalAlpha = 0.10 + 0.08 * calmC;
    ctx.filter = 'blur(6px)';
    const scrollX = worldX * LAYER_RATIOS.L7;
    for (let i = 0; i < 3; i++) {
      const x = ((i * 480 - scrollX) % (canvas.width + 400) + canvas.width + 400) % (canvas.width + 400) - 200;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(x, canvas.height * (0.3 + 0.2 * i), 160, 90, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawSky(ctx, canvas, A, B, t) {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    for (let i = 0; i < 3; i++) g.addColorStop(i / 2, this.lerpCache.get(A.sky[i], B.sky[i], t));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (A.fx === 'starTwinkle' || B.fx === 'starTwinkle') {
      const alpha = A.fx === 'starTwinkle' ? 1 - t : t;
      if (alpha > 0.02) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ffffff';
        for (const s of this.stars) {
          const twinkleHz = 1.3 + 1.0 * this._calmC;
          const a = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.tSec * twinkleHz + s.phase));
          ctx.globalAlpha = alpha * a;
          ctx.fillRect(s.x, s.y, 1.6, 1.6);
        }
        ctx.restore();
      }
    }
    if (A.fx === 'aurora' || B.fx === 'aurora') {
      const alpha = A.fx === 'aurora' ? 1 - t : t;
      if (alpha > 0.02) this._drawAurora(ctx, canvas, alpha);
    }
  }

  _drawAurora(ctx, canvas, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let band = 0; band < 3; band++) {
      const hue = 160 + ((this.tSec * 12 + band * 40) % 140);
      ctx.strokeStyle = `hsla(${hue},80%,60%,${0.16 * alpha})`;
      ctx.lineWidth = 18;
      ctx.beginPath();
      for (let x = 0; x <= canvas.width; x += 16) {
        const y = 60 + band * 30 + Math.sin(x * 0.006 + this.tSec * 0.6 + band) * 26;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawCelestial(ctx, canvas, A, B, t) {
    const cx = canvas.width * 0.78, cy = canvas.height * 0.22;
    this._drawOneCelestial(ctx, cx, cy, A.celestial, 1 - t);
    if (B !== A) this._drawOneCelestial(ctx, cx, cy, B.celestial, t);

    if (A.fx === 'prominence' || B.fx === 'prominence') {
      const alpha = A.fx === 'prominence' ? 1 - t : t;
      if (alpha > 0.02) this._drawProminence(ctx, cx, cy, alpha);
    }
  }

  _drawOneCelestial(ctx, cx, cy, c, alpha) {
    if (alpha <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, c.radius * (c.dominant ? 3.2 : 2.2));
    halo.addColorStop(0, c.haloColor);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, c.radius * (c.dominant ? 3.2 : 2.2), 0, Math.PI * 2);
    ctx.fill();

    if (c.wireframe) {
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = alpha * 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, c.radius, 0, Math.PI * 2);
      ctx.moveTo(cx - c.radius, cy); ctx.lineTo(cx + c.radius, cy);
      ctx.moveTo(cx, cy - c.radius); ctx.lineTo(cx, cy + c.radius);
      ctx.stroke();
    } else {
      ctx.fillStyle = c.color;
      ctx.globalAlpha = alpha * (c.veiled ? 0.6 : 1);
      ctx.beginPath();
      ctx.arc(cx, cy, c.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    if (c.ring) {
      ctx.strokeStyle = c.haloColor;
      ctx.globalAlpha = alpha * 0.5;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, c.radius * 1.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (c.shattered) {
      ctx.strokeStyle = '#05010d';
      ctx.globalAlpha = alpha * 0.8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - c.radius * 0.3, cy - c.radius * 0.6);
      ctx.lineTo(cx + c.radius * 0.1, cy + c.radius * 0.4);
      ctx.moveTo(cx + c.radius * 0.4, cy - c.radius * 0.5);
      ctx.lineTo(cx - c.radius * 0.1, cy + c.radius * 0.2);
      ctx.stroke();
    }
    if (c.shafts) {
      ctx.globalAlpha = alpha * 0.10;
      ctx.fillStyle = c.color;
      for (let i = 0; i < 5; i++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((i - 2) * 0.22 + Math.sin(this.tSec * 0.2 + i) * 0.03);
        ctx.fillRect(-8, 0, 16, 600);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  _drawMountainEQ(ctx, canvas, worldX, A, B, t, perfLevel = 0) {
    // Three EQ-driven ridgelines (far/mid/near) between celestial and L2.
    // Height blends band energy with ridged ValueNoise1D; baselines follow
    // layerDepth so the mountains seat into the silhouette/ground gap.
    const bands = this._eqSmooth;
    if (!bands) return;
    const parallax = worldX * 0.06;
    const c = this.lerpCache.get(A.sky[1], B.sky[1], t);
    const { r, g: gg, b } = hexToRgb(c);
    const gap = this.groundY - (canvas.height - STRIP_HEIGHT);
    const barW = canvas.width / 7;
    const step = 4;

    const layers = [
      { key: 'L2', maxHPct: 0.28, eqWeight: 0.28, noiseIdx: 0, desat: 0.55, alphaMul: 0.55 },
      { key: 'L3', maxHPct: 0.34, eqWeight: 0.48, noiseIdx: 1, desat: 0.30, alphaMul: 0.72 },
      { key: 'L4', maxHPct: 0.42, eqWeight: 0.68, noiseIdx: 2, desat: 0, alphaMul: 0.92 },
    ];

    for (let li = 0; li < layers.length; li++) {
      if (perfLevel >= 3 && li === 0) continue; // far ridge sheds first
      if (perfLevel >= 4 && li === 1) continue; // mid ridge sheds second

      const layer = layers[li];
      const d = layerDepth(layer.key);
      const baselineY = canvas.height - STRIP_HEIGHT + d.yOffsetPct * gap + 6;
      const maxH = canvas.height * layer.maxHPct;
      const noise = this._ridgeNoise[layer.noiseIdx];
      const cr = Math.round(r + (255 - r) * layer.desat * 0.35);
      const cg = Math.round(gg + (255 - gg) * layer.desat * 0.35);
      const cb = Math.round(b + (255 - b) * layer.desat * 0.35);
      const innerA = 0.38 * (1 - layer.desat * 0.35);
      const baseA = 0.72 * (1 - layer.desat * 0.35);

      let peakY = baselineY;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = d.alpha * layer.alphaMul;
      ctx.beginPath();
      ctx.moveTo(0, baselineY);
      for (let x = 0; x <= canvas.width; x += step) {
        const sampleX = x + parallax;
        const bandPos = (((sampleX % canvas.width) + canvas.width) % canvas.width) / barW;
        const i0 = Math.floor(bandPos) % 7;
        const i1 = (i0 + 1) % 7;
        const frac = bandPos - Math.floor(bandPos);
        const eqV = bands[i0] * (1 - frac) + bands[i1] * frac;
        const n = ridged(noise, sampleX * 0.005, 2);
        const h = (eqV * layer.eqWeight + n * (1 - layer.eqWeight * 0.45)) * maxH;
        const y = baselineY - h;
        if (y < peakY) peakY = y;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(canvas.width, baselineY);
      ctx.closePath();
      const gr = ctx.createLinearGradient(0, peakY, 0, baselineY);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(0.30, `rgba(${cr},${cg},${cb},${innerA})`);
      gr.addColorStop(1, `rgba(${cr},${cg},${cb},${baseA})`);
      ctx.fillStyle = gr;
      ctx.fill();
      ctx.restore();
    }
  }

  _drawPineForestEQ(ctx, canvas, worldX, A, B, t) {
    // Seven EQ band slots as triangle pines in two depth rows (odd back, even front).
    const bands = this._eqSmooth;
    if (!bands) return;
    const barW = canvas.width / 7;
    const parallax = worldX * 0.06;
    const tint = this.lerpCache.get(A.silhouette, B.silhouette, t);
    const { r, g: gg, b } = hexToRgb(tint);
    const gap = this.groundY - (canvas.height - STRIP_HEIGHT);
    const backBase = canvas.height - STRIP_HEIGHT + layerDepth('L4').yOffsetPct * gap + 4;
    const frontBase = canvas.height - STRIP_HEIGHT + layerDepth('L5').yOffsetPct * gap;

    const rows = [
      { indices: [1, 3, 5], baselineY: backBase, scale: 0.72, alpha: 0.50 },
      { indices: [0, 2, 4, 6], baselineY: frontBase, scale: 1.0, alpha: 0.82 },
    ];

    for (const row of rows) {
      ctx.save();
      ctx.globalAlpha = row.alpha;
      for (const i of row.indices) {
        const v = clamp(bands[i], 0, 1);
        const x0 = i * barW - (parallax % barW);
        const x = ((x0 % canvas.width) + canvas.width) % canvas.width;
        const treeH = (0.32 + v * 0.58) * canvas.height * 0.22 * row.scale;
        if (treeH <= 2) continue;
        const treeW = treeH * 0.44;
        const sway = Math.sin(this.tSec * (1.1 + i * 0.15) + i * 0.9) * (2 + v * 4);
        this._drawPineTree(ctx, x + barW * 0.5, row.baselineY, treeW, treeH, r, gg, b, sway);
      }
      ctx.restore();
    }
  }

  _drawPineTree(ctx, cx, baseY, w, h, r, g, b, sway) {
    const trunkW = w * 0.18;
    const trunkH = h * 0.22;
    ctx.fillStyle = `rgba(${(r * 0.45) | 0},${(g * 0.45) | 0},${(b * 0.45) | 0},0.9)`;
    ctx.fillRect(cx - trunkW / 2, baseY - trunkH, trunkW, trunkH);

    const foliageH = h - trunkH;
    const tiers = 3;
    for (let tier = 0; tier < tiers; tier++) {
      const tierSway = sway * (1 + tier * 0.35);
      const tierBase = baseY - trunkH - foliageH * (tier / tiers);
      const tierH = (foliageH / tiers) * 1.15;
      const tierW = w * (1 - tier * 0.22);
      const topX = cx + tierSway;
      const topY = tierBase - tierH;
      ctx.fillStyle = `rgba(${r},${g},${b},${0.52 + tier * 0.14})`;
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.lineTo(cx - tierW / 2, tierBase);
      ctx.lineTo(cx + tierW / 2, tierBase);
      ctx.closePath();
      ctx.fill();
    }
  }

  _drawProminence(ctx, cx, cy, alpha) {
    const e0 = this.energyCurves ? this.energyCurves.sample(0, this.tSec * 1000) : 0.3;
    ctx.save();
    ctx.globalAlpha = alpha * 0.7;
    ctx.strokeStyle = '#ffcf6b';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + this.tSec * 0.15;
      const r1 = 80, r2 = 80 + 30 * (0.3 + e0);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1 * 0.6);
      ctx.quadraticCurveTo(
        cx + Math.cos(ang) * (r1 + r2) * 0.7, cy + Math.sin(ang) * (r1 + r2) * 0.4 - 20,
        cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2 * 0.6,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawLayer(ctx, canvas, layerKey, scrollX, tint, t, A, B) {
    // ground-horizon-depth: per-layer alpha gives atmospheric perspective
    // (distant ridges translucent so the sky shows through) and yOffsetPct × the
    // silhouette/ground gap lowers near ridges to meet the ground slab.
    const d = layerDepth(layerKey);
    const gap = this.groundY - (canvas.height - STRIP_HEIGHT);
    const yOffset = d.yOffsetPct * gap;
    const stripsA = this.strips.get(A.name), stripsB = this.strips.get(B.name);
    ctx.save();
    ctx.globalAlpha *= d.alpha; // near layers opaque, far layers haze out
    if (A.fx === 'heatShimmer' || B.fx === 'heatShimmer') {
      const alpha = A.fx === 'heatShimmer' ? 1 - t : t;
      if (alpha > 0.05 && layerKey !== 'L5') { this._drawShimmered(ctx, canvas, stripsA[layerKey], scrollX, yOffset); }
      else drawTiledStrip(ctx, stripsA[layerKey], scrollX, canvas.width, canvas.height, yOffset);
    } else {
      drawTiledStrip(ctx, stripsA[layerKey], scrollX, canvas.width, canvas.height, yOffset);
    }
    if (B !== A && t > 0.02) {
      // Crossfade biome B in on top. Multiply (not overwrite) so the per-layer
      // depth alpha still applies: effective alpha = d.alpha * t.
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * t;
      drawTiledStrip(ctx, stripsB[layerKey], scrollX, canvas.width, canvas.height, yOffset);
      ctx.globalAlpha = prev;
    }
    ctx.restore();
  }

  _drawShimmered(ctx, canvas, strip, scrollX, yOffset = 0) {
    const w = strip.width, h = strip.height;
    const baseY = canvas.height - h + yOffset; // ground-horizon-depth: thread layer yOffset
    let x0 = -(((scrollX % w) + w) % w);
    const step = 6;
    for (let sx = x0; sx < canvas.width; sx += w) {
      for (let row = 0; row < h; row += step) {
        const offset = 2 * Math.sin(row / 24 + this.tSec * 4);
        ctx.drawImage(strip, 0, row, w, step, sx + offset, baseY + row, w, step);
      }
    }
  }

  _drawGround(ctx, canvas, worldX, A, B, t, groundField, nowMs) {
    const groundColor = this.lerpCache.get(A.silhouette, B.silhouette, t);

    if (groundField) {
      // Geometric/wireframe ground (item 5) — enriched: a volume-gradient
      // fill below the surface, subterranean contour strata, gradient
      // vertical seams, and an EQ-reactive neon horizon edge. The surface
      // shape itself still comes from groundField.heightAt (unchanged — its
      // bounds are covered by ground.test.js).
      const originX = canvas.width * 0.26; // Midio's SCREEN_X_FRAC (src/sim/Midio.js) — keep in sync. Was a stale hardcoded 220; now matches Midio's actual screenX so the seam-sharpness peak (Step 5) and sliceTops anchor align with Midio + obstacles across resolutions.
      const tops = groundField.sliceTops(worldX, originX, nowMs);
      const { r, g: gg, b } = hexToRgb(groundColor);

      // (a) Volume fill: groundColor at the surface fading to near-black at
      //     the canvas bottom. Anchor the gradient at the base ground level
      //     (this.groundY) so the color bands stay stable as the terrain rolls.
      const baseY = this.groundY;
      const fillGrad = ctx.createLinearGradient(0, baseY - 40, 0, canvas.height);
      fillGrad.addColorStop(0, `rgba(${r},${gg},${b},0.62)`);
      fillGrad.addColorStop(0.45, `rgba(${(r * 0.4) | 0},${(gg * 0.4) | 0},${(b * 0.4) | 0},0.55)`);
      fillGrad.addColorStop(1, 'rgba(0,0,0,0.9)');
      ctx.fillStyle = fillGrad;
      ctx.beginPath();
      ctx.moveTo(0, canvas.height);
      for (const p of tops) ctx.lineTo(p.x, p.y);
      ctx.lineTo(canvas.width, canvas.height);
      ctx.closePath();
      ctx.fill();

      // (b) Subterranean contour strata — faint horizontal lines below the
      //     surface, giving the slab a layered-rock read. Fixed spacing so
      //     the strata don't jitter with the rolling terrain.
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      const strataSpacing = (canvas.height - baseY) / 5;
      for (let s = 1; s <= 4; s++) {
        const y = baseY + s * strataSpacing;
        if (y >= canvas.height - 4) break;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // (c) Gradient vertical seams at each slice boundary — bright at the
      //     surface, fading down into the slab. ground-horizon-depth platform
      //     variation: per-seam brightness + thickness fall off with distance to
      //     Midio, so platforms near Midio read crisper (foreground) and far
      //     ones hazier (background) — the surface becomes a depth cue.
      for (const p of tops) {
        const dx = Math.abs(p.x - originX);
        const nd = Math.min(1, dx / (canvas.width * 0.5)); // 0 at Midio, 1 at far edge
        const scale = 1 - 0.65 * nd;                        // 1 → 0.35 brightness
        ctx.lineWidth = 0.75 + 0.75 * (1 - nd);             // 1.5px near → 0.75px far
        const sg = ctx.createLinearGradient(0, p.y, 0, canvas.height);
        sg.addColorStop(0, `rgba(255,255,255,${0.32 * scale})`);
        sg.addColorStop(0.4, `rgba(255,255,255,${0.07 * scale})`);
        sg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = sg;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x, canvas.height);
        ctx.stroke();
      }

      // (d) EQ-reactive neon horizon edge — the surface line glows with
      //     overall energy and punches up during the gag "almost-falls" beat.
      const e = this.energyCurves ? this.energyCurves.globalEnergy(nowMs) : 0;
      const pulse = groundField.gagActive ? 1 : clamp(e, 0, 1);
      const edgeR = Math.min(255, r + 90), edgeG = Math.min(255, gg + 90), edgeB = Math.min(255, b + 90);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${edgeR},${edgeG},${edgeB},${0.45 + 0.4 * pulse})`;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = `rgba(${edgeR},${edgeG},${edgeB},0.9)`;
      ctx.shadowBlur = 8 + 18 * pulse;
      ctx.beginPath();
      for (let k = 0; k < tops.length; k++) {
        const p = tops[k];
        if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = groundColor;
      ctx.fillRect(0, this.groundY, canvas.width, canvas.height - this.groundY);

      // LOW-MID energy makes the ground breathe (spec §4.1.1 L6).
      const e2 = this.energyCurves ? this.energyCurves.sample(2, this.tSec * 1000) : 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= canvas.width; x += 12) {
        const undulate = 14 * e2 * Math.sin((2 * Math.PI * (x + worldX)) / 900);
        const y = this.groundY + undulate;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    const activeFx = t > 0.5 ? B.fx : A.fx;
    if (activeFx === 'neonGrid') this._drawNeonGrid(ctx, canvas, worldX);
    else if (activeFx === 'canopyDapple') this._drawCanopyDapple(ctx, canvas);
    else if (activeFx === 'glitchTear' && this._glitchActiveMs > 0) this._drawGlitchTear(ctx, canvas);
  }

  _drawNeonGrid(ctx, canvas, worldX) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,255,208,0.35)';
    ctx.lineWidth = 1;
    const spacing = 48;
    const offset = worldX % spacing;
    for (let x = -offset; x < canvas.width; x += spacing) {
      ctx.beginPath(); ctx.moveTo(x, this.groundY); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = this.groundY; y < canvas.height; y += 24) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
    if (this._scanlineActive) {
      ctx.fillStyle = 'rgba(0,255,208,0.12)';
      ctx.fillRect(0, this._scanlineY, canvas.width, 6);
    }
    if (this._pylonFlash > 0.02) {
      ctx.globalAlpha = this._pylonFlash;
      ctx.fillStyle = '#00ffd0';
      for (let i = 0; i < 3; i++) {
        const x = ((i * 420 - worldX * 0.65) % (canvas.width + 200) + canvas.width + 200) % (canvas.width + 200) - 100;
        ctx.fillRect(x, this.groundY - 140, 6, 140);
      }
    }
    ctx.restore();
  }

  _drawCanopyDapple(ctx, canvas) {
    ctx.save();
    ctx.fillStyle = 'rgba(234,255,176,0.10)';
    for (let i = 0; i < 5; i++) {
      const flick = 0.6 + 0.4 * Math.sin(this.tSec * (0.8 + i * 0.3) + i);
      ctx.globalAlpha = 0.5 * flick;
      const x = ((i * 240) % canvas.width);
      ctx.beginPath();
      ctx.ellipse(x, this.groundY + 30, 60, 18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawGlitchTear(ctx, canvas) {
    const rowY = Math.floor((mulberry32(Math.floor(this.tSec * 4))() ) * (canvas.height - 100));
    const rowH = 18;
    const shift = 6 * (mulberry32(Math.floor(this.tSec * 4) + 1)() * 2 - 1);
    const snapshot = ctx.getImageData(0, rowY, canvas.width, rowH);
    ctx.putImageData(snapshot, shift, rowY);
  }
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
