// Orchestrates the 8-layer parallax contract (spec §4.1.1), biome
// scheduling via novelty-curve segmentation (§4.1.3), and gamma-correct
// profile crossfading (§4.1.4). Each biome is pure data (BiomeProfiles.js);
// this file is the one place that knows how to render the contract.
import { BIOMES } from './BiomeProfiles.js';
import { generateSilhouette, drawTiledStrip } from './SilhouetteGenerator.js';
import { ParticleField } from './ParticleField.js';
import { clamp, clamp01, smoothstep, mulberry32, hashSeed } from '../utils/math.js';
import { LerpCache } from '../utils/color.js';
import { Role } from '../core/NoteEvent.js';

const LAYER_RATIOS = { L1: 0.05, L2: 0.10, L3: 0.18, L4: 0.30, L5: 0.65, L6: 1.00, L7: 1.20 };
const WORLD_SPEED_PX_S = 220;

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

  update(nowMs, dtSec, energyCurves) {
    this.tSec = nowMs / 1000;
    const { from, to, t } = this._blend(nowMs);
    this.currentBlend = { from, to, t };

    this.fields.get(from).update(dtSec, this.tSec, energyCurves, nowMs);
    if (to !== from) this.fields.get(to).update(dtSec, this.tSec, energyCurves, nowMs);

    if (this._scanlineActive) {
      this._scanlineY += dtSec * this.h * 2.2;
      if (this._scanlineY > this.h) this._scanlineActive = false;
    }
    this._pylonFlash = Math.max(0, this._pylonFlash - dtSec / 0.15);

    this._glitchActiveMs -= dtSec * 1000;
    this._glitchTimer -= dtSec;
    if (this._glitchTimer <= 0) { this._glitchActiveMs = 60; this._glitchTimer = 2.5 + this._starSeed() * 3.5; }
  }

  draw(ctx, canvas, worldX, groundField = null, nowMs = 0) {
    const { from, to, t } = this.currentBlend || { from: this.sections[0].profile, to: this.sections[0].profile, t: 1 };
    const A = this._profile(from), B = this._profile(to);

    this._drawSky(ctx, canvas, A, B, t);
    this._drawCelestial(ctx, canvas, A, B, t);

    const scrollX0 = worldX * LAYER_RATIOS.L2, scrollX1 = worldX * LAYER_RATIOS.L3;
    const scrollX2 = worldX * LAYER_RATIOS.L4, scrollX3 = worldX * LAYER_RATIOS.L5;
    const tint = this.lerpCache.get(A.silhouette, B.silhouette, t);

    this._drawLayer(ctx, canvas, 'L2', scrollX0, tint, t, A, B);
    this._drawLayer(ctx, canvas, 'L3', scrollX1, tint, t, A, B);

    // Ambient particle field lives roughly at mid-depth.
    this.fields.get(from).draw(ctx);
    if (to !== from && t > 0.02) { ctx.save(); ctx.globalAlpha = t; this.fields.get(to).draw(ctx); ctx.restore(); }

    this._drawLayer(ctx, canvas, 'L4', scrollX2, tint, t, A, B);
    this._drawLayer(ctx, canvas, 'L5', scrollX3, tint, t, A, B);

    this._drawGround(ctx, canvas, worldX, A, B, t, groundField, nowMs);
  }

  drawForeground(ctx, canvas, worldX) {
    // L7: oversized, blurred, low-alpha foreground veil (spec §4.1.1).
    ctx.save();
    ctx.globalAlpha = 0.10;
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
          const a = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.tSec * 1.3 + s.phase));
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
    const stripsA = this.strips.get(A.name), stripsB = this.strips.get(B.name);
    ctx.save();
    if (A.fx === 'heatShimmer' || B.fx === 'heatShimmer') {
      const alpha = A.fx === 'heatShimmer' ? 1 - t : t;
      if (alpha > 0.05 && layerKey !== 'L5') { this._drawShimmered(ctx, canvas, stripsA[layerKey], scrollX); }
      else drawTiledStrip(ctx, stripsA[layerKey], scrollX, canvas.width, canvas.height);
    } else {
      drawTiledStrip(ctx, stripsA[layerKey], scrollX, canvas.width, canvas.height);
    }
    if (B !== A && t > 0.02) {
      ctx.globalAlpha = t;
      drawTiledStrip(ctx, stripsB[layerKey], scrollX, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  _drawShimmered(ctx, canvas, strip, scrollX) {
    const w = strip.width, h = strip.height;
    const baseY = canvas.height - h;
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
      // Geometric/wireframe ground (item 5): flat slice platforms with only
      // narrow linear seams, rendered as stroked edges over a transparent fill.
      const originX = 220; // Midio's screenX — worldX maps here
      const tops = groundField.sliceTops(worldX, originX, nowMs);

      // Optional dark silhouette fill below the platform tops.
      ctx.fillStyle = groundColor;
      ctx.beginPath();
      ctx.moveTo(0, canvas.height);
      for (const p of tops) {
        ctx.lineTo(p.x, p.y);
      }
      ctx.lineTo(canvas.width, canvas.height);
      ctx.closePath();
      ctx.globalAlpha = 0.6;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Wireframe slice lines: vertical seams + horizontal tops.
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const p of tops) {
        // horizontal top edge
        const prev = tops[tops.indexOf(p) - 1] || { x: p.x - groundField.spacing, y: p.y };
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(p.x, p.y);
        // vertical seam down to canvas bottom
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x, canvas.height);
      }
      ctx.stroke();
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
