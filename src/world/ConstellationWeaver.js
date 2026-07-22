// Ambient connect-the-dots: unlike Midasus's rare, ExcursionDirector-gated
// SkyVoyage (at most 2 voyages a song), this weaves constellations out of
// ordinary melody notes for the whole song -- ordinary dots quietly
// connecting into shapes, holding, fading, sometimes crystallizing into
// permanent dim stars. Mirrors MeteorShowerFX's shape: seeded rand, plain
// state, no canvas ownership between calls. Pure position/timing helpers
// (nextDotPos, edgeRevealFrac) are exported so BiomeManager's draw-time
// choices stay testable without touching canvas.
import { mulberry32, clamp01 } from '../utils/math.js';
import { capFlashAlpha } from '../ui/Accessibility.js';

const REGION = { xMin: 0.06, xMax: 0.94, yMin: 0.05, yMax: 0.32 };
const FIGURE_DOTS_MIN = 5;
const FIGURE_DOTS_MAX = 8;
const EDGE_GROW_MS = 250;
const STALL_EDGE_MS = 1500;
const HOLD_MS = 5000;
const FADE_MS = 3000;
const MAX_ACTIVE_FIGURES = 3;
const MAX_DOTS = 40;
const MAX_STAR_FIGURES = 6;
const CRYSTALLIZE_CHANCE = 0.45;
const PULSE_TAU_SEC = 0.25;

/** Seeded next dot position, 40-110px from `prev` in a drifting direction,
 *  reflected back into the upper-sky region if it would step outside.
 *  `prev` null places the first dot anywhere in the region. Pure. */
export function nextDotPos(prev, rand, w, h) {
  const xMin = REGION.xMin * w, xMax = REGION.xMax * w;
  const yMin = REGION.yMin * h, yMax = REGION.yMax * h;
  if (!prev) return { x: xMin + rand() * (xMax - xMin), y: yMin + rand() * (yMax - yMin) };
  const angle = rand() * Math.PI * 2;
  const dist = 40 + rand() * 70;
  let x = prev.x + Math.cos(angle) * dist;
  let y = prev.y + Math.sin(angle) * dist;
  if (x < xMin) x = xMin + (xMin - x);
  if (x > xMax) x = xMax - (x - xMax);
  if (y < yMin) y = yMin + (yMin - y);
  if (y > yMax) y = yMax - (y - yMax);
  x = Math.max(xMin, Math.min(xMax, x));
  y = Math.max(yMin, Math.min(yMax, y));
  return { x, y };
}

/** How much of a figure's edges are revealed, 0..1, monotone in nowMs: full
 *  edges already revealed plus the currently-growing edge's own progress
 *  (EDGE_GROW_MS line-grow), normalized by the total edge count. Pure. */
export function edgeRevealFrac(figure, nowMs) {
  const totalEdges = Math.max(1, figure.targetCount - 1);
  const partial = clamp01((nowMs - figure.edgeStartMs) / EDGE_GROW_MS);
  return clamp01((figure.edgeRevealedCount + partial) / totalEdges);
}

export class ConstellationWeaver {
  constructor(seed, w, h) {
    this.rand = mulberry32((seed ^ 0x5eed) >>> 0 || 1);
    this.w = w;
    this.h = h;
    this.building = null; // the one figure currently being seeded/connected
    this.figures = [];    // completed figures: holding, then fading
    this.stars = [];      // crystallized, persistent
    this.pulse = 0;
    this._lastNowMs = 0;
  }

  onMelody(evt) {
    const nowMs = evt.tMs;
    if (!this.building) {
      const targetCount = FIGURE_DOTS_MIN + Math.floor(this.rand() * (FIGURE_DOTS_MAX - FIGURE_DOTS_MIN + 1));
      this.building = {
        dots: [nextDotPos(null, this.rand, this.w, this.h)],
        targetCount,
        hue: (evt.pitch % 12) * 30,
        phase: 'seeding',
        edgeRevealedCount: 0,
        edgeStartMs: nowMs,
      };
      return;
    }
    const fig = this.building;
    if (fig.phase === 'seeding') {
      if (fig.dots.length < fig.targetCount) {
        fig.dots.push(nextDotPos(fig.dots[fig.dots.length - 1], this.rand, this.w, this.h));
      }
      if (fig.dots.length >= fig.targetCount) {
        fig.phase = 'connecting';
        fig.edgeRevealedCount = 0;
        fig.edgeStartMs = nowMs;
      }
      return;
    }
    if (fig.phase === 'connecting') {
      this._revealNextEdge(fig, nowMs);
      if (fig.edgeRevealedCount >= fig.targetCount - 1) this._commitBuilding(nowMs);
    }
  }

  onKick(vel) {
    this.pulse = Math.max(this.pulse, clamp01(vel));
  }

  _revealNextEdge(fig, nowMs) {
    if (fig.edgeRevealedCount >= fig.targetCount - 1) return;
    fig.edgeRevealedCount++;
    fig.edgeStartMs = nowMs;
  }

  _commitBuilding(nowMs) {
    const fig = this.building;
    fig.phase = 'holding';
    fig.holdStartMs = nowMs;
    if (this.figures.length >= MAX_ACTIVE_FIGURES) this.figures.shift();
    this.figures.push(fig);
    this.building = null;
    this._enforceDotCap();
  }

  _enforceDotCap() {
    let total = this.building ? this.building.dots.length : 0;
    for (const f of this.figures) total += f.dots.length;
    while (total > MAX_DOTS && this.figures.length > 0) {
      total -= this.figures.shift().dots.length;
    }
  }

  update(nowMs, dtSec) {
    this._lastNowMs = nowMs;
    this.pulse *= Math.exp(-dtSec / PULSE_TAU_SEC);

    if (this.building && this.building.phase === 'connecting'
        && nowMs - this.building.edgeStartMs > STALL_EDGE_MS) {
      this._revealNextEdge(this.building, nowMs);
      if (this.building.edgeRevealedCount >= this.building.targetCount - 1) this._commitBuilding(nowMs);
    }

    for (const f of this.figures) {
      if (f.phase === 'holding' && nowMs - f.holdStartMs > HOLD_MS) {
        f.phase = 'fading';
        f.fadeStartMs = nowMs;
      }
    }
    const survivors = [];
    for (const f of this.figures) {
      if (f.phase === 'fading' && nowMs - f.fadeStartMs > FADE_MS) {
        if (this.rand() < CRYSTALLIZE_CHANCE) {
          if (this.stars.length >= MAX_STAR_FIGURES) this.stars.shift();
          this.stars.push({
            dots: f.dots.map((d) => ({ x: d.x, y: d.y, phase: this.rand() * Math.PI * 2 })),
            hue: f.hue,
          });
        }
        continue; // drop
      }
      survivors.push(f);
    }
    this.figures = survivors;
  }

  draw(ctx, canvas, reducedFlash = false) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Crystallized stars: dim and persistent, atlas-style.
    for (const star of this.stars) {
      ctx.strokeStyle = `hsla(${star.hue}, 32%, 80%, ${capFlashAlpha(0.07, reducedFlash)})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      star.dots.forEach((s, i) => { if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y); });
      ctx.stroke();
      for (const s of star.dots) {
        ctx.fillStyle = `hsla(${star.hue}, 40%, 86%, ${capFlashAlpha(0.14, reducedFlash)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const fig of this.figures) {
      const holdOrFadeFrac = fig.phase === 'fading'
        ? 1 - clamp01((this._lastNowMs - fig.fadeStartMs) / FADE_MS)
        : 1;
      this._drawFigure(ctx, fig, this._lastNowMs, holdOrFadeFrac, reducedFlash);
    }
    if (this.building) this._drawFigure(ctx, this.building, this._lastNowMs, 1, reducedFlash);

    ctx.restore();
  }

  _drawFigure(ctx, fig, nowMs, lifeAlpha, reducedFlash) {
    const pulseBoost = 1 + 1.2 * this.pulse;
    const frac = edgeRevealFrac(fig, nowMs);
    const edgeCount = fig.dots.length - 1;
    if (edgeCount > 0) {
      const revealedEdges = frac * edgeCount;
      for (let i = 0; i < edgeCount; i++) {
        const edgeAlpha = clamp01(revealedEdges - i);
        if (edgeAlpha <= 0) break;
        const a = fig.dots[i], b = fig.dots[i + 1];
        const x = a.x + (b.x - a.x) * edgeAlpha, y = a.y + (b.y - a.y) * edgeAlpha;
        for (const [lw, base] of [[3, 0.08], [1, 0.30]]) {
          ctx.strokeStyle = `hsla(${fig.hue}, 60%, 82%, ${capFlashAlpha(base * lifeAlpha * pulseBoost, reducedFlash)})`;
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
      }
    }
    for (let i = 0; i < fig.dots.length; i++) {
      const d = fig.dots[i];
      ctx.fillStyle = `hsla(${fig.hue}, 70%, 88%, ${capFlashAlpha(0.5 * lifeAlpha * pulseBoost, reducedFlash)})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(${fig.hue}, 40%, 90%, ${capFlashAlpha(0.12 * lifeAlpha, reducedFlash)})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
