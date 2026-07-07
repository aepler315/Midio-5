// Generic ambient particle field covering every biome's "particle signature"
// (spec §4.1.2 table): a fixed-size, ever-respawning field rather than a
// pooled emit-and-die burst, since these are continuous atmosphere, not FX.
import { mulberry32, clamp01 } from '../utils/math.js';
import { curl2 } from '../utils/fields.js';

export class ParticleField {
  constructor(config, canvasWidth, canvasHeight, seed = 1) {
    this.kind = config.kind;
    this.color = config.color;
    this.count = config.count;
    this.baseSpeed = config.speed;
    this.w = canvasWidth;
    this.h = canvasHeight;
    this.rand = mulberry32(seed);
    this.particles = [];
    for (let i = 0; i < this.count; i++) this.particles.push(this._spawn());
  }

  _spawn(px, py) {
    const rand = this.rand;
    const p = {
      x: px ?? rand() * this.w,
      y: py ?? rand() * this.h,
      phase: rand() * Math.PI * 2,
      omega: 0.6 + rand() * 1.2,
      size: 1.5 + rand() * 2.5,
      spin: (rand() * 2 - 1) * 3,
      rot: 0,
      vx: 0, vy: 0,
      state: 'alive',
      alpha: 1,
    };
    if (this.kind === 'digitalrain') {
      const col = Math.floor(rand() * 40);
      p.x = (col / 40) * this.w;
      p.y = -rand() * this.h;
      p.glyphT = 0;
    }
    if (this.kind === 'flaresparks') {
      p.t = rand();
      p.origin = { x: rand() * this.w * 0.3, y: this.h * 0.25 };
      p.ctrl = { x: p.origin.x + rand() * 200, y: p.origin.y - 80 - rand() * 80 };
      p.end = { x: p.origin.x + 150 + rand() * 250, y: p.origin.y + rand() * 100 - 50 };
    }
    return p;
  }

  update(dtSec, tSec, energyCurves, nowMs, calmLevel = 0) {
    const rand = this.rand;
    for (const p of this.particles) {
      switch (this.kind) {
        case 'fireflies':
          p.x += Math.sin(tSec * 0.4 + p.phase) * this.baseSpeed * dtSec;
          p.y += Math.cos(tSec * 0.3 + p.phase * 1.3) * this.baseSpeed * 0.6 * dtSec;
          // Calm sections: brighter, slightly faster blink -- ambient life
          // to lean on when the foreground has gone quiet.
          p.alpha = clamp01((0.5 + 0.5 * Math.sin((2 * Math.PI * tSec) / 3 * (1 + 0.3 * calmLevel) + p.phase)) * (1 + 0.4 * calmLevel));
          break;
        case 'embers': {
          p.vy = p.vy || -(40 + rand() * 50);
          p.vx += (rand() * 2 - 1) * 18 * dtSec;
          // Curl-noise updraft: a divergence-free gust field so the embers
          // swirl in eddies like real fire-lofted ash, never clumping.
          const gust = energyCurves ? 0.5 + clamp01(energyCurves.sample(1, nowMs)) : 1;
          const fl = curl2(p.x * 0.006, p.y * 0.006, tSec * 0.2);
          p.x += (p.vx + fl.x * 55 * gust) * dtSec;
          p.y += (p.vy + fl.y * 55 * gust) * dtSec;
          if (p.y < -20) Object.assign(p, this._spawn(rand() * this.w, this.h + 10));
          break;
        }
        case 'snow': {
          const drift = curl2(p.x * 0.004, p.y * 0.004, tSec * 0.12);
          p.y += (30 + p.size * 13 + drift.y * 25) * dtSec;
          p.x += (18 * Math.sin(tSec * p.omega + p.phase) + drift.x * 40) * dtSec;
          if (p.y > this.h + 10) Object.assign(p, this._spawn(rand() * this.w, -10));
          break;
        }
        case 'pollen': {
          p.x += Math.sin(tSec * 0.5 + p.phase) * 6 * dtSec;
          p.y += Math.cos(tSec * 0.4 + p.phase * 1.7) * 6 * dtSec;
          const air = energyCurves ? energyCurves.sample(6, nowMs) : 0.3;
          p.alpha = clamp01((0.3 + 0.5 * clamp01(air)) * (1 + 0.3 * calmLevel));
          break;
        }
        case 'antigrav':
          p.baseX = p.baseX ?? p.x;
          p.angle = (p.angle ?? rand() * Math.PI * 2) + 0.6 * dtSec;
          p.radius = p.radius ?? (10 + rand() * 40) * Math.max(0.15, (this.h - p.y) / this.h);
          p.y -= (20 + p.radius * 0.5) * dtSec;
          p.x = p.baseX + Math.cos(p.angle) * p.radius;
          if (p.y < -20) { Object.assign(p, this._spawn(rand() * this.w, this.h + 10)); p.baseX = p.x; p.radius = null; }
          break;
        case 'petals':
          p.vy = p.vy || (25 + rand() * 30);
          p.x += 22 * Math.sin(tSec * p.omega + p.phase) * dtSec;
          p.y += p.vy * dtSec;
          p.rot += p.spin * dtSec;
          if (p.state === 'alive' && p.y > this.h - 6) { p.state = 'piled'; p.pileT = 0; }
          if (p.state === 'piled') {
            p.pileT += dtSec;
            if (p.pileT > 1.2) Object.assign(p, this._spawn(rand() * this.w, -10));
          }
          break;
        case 'flaresparks':
          p.t += dtSec * 0.6;
          if (p.t > 1) Object.assign(p, this._spawn());
          break;
        case 'digitalrain': {
          p.glyphT += dtSec;
          const speed = this.baseSpeed * (energyCurves ? 0.5 + energyCurves.sample(5, nowMs) : 1);
          p.y += speed * dtSec;
          if (p.y > this.h + 40) p.y = -40 - rand() * 200;
          break;
        }
      }
    }
  }

  draw(ctx) {
    ctx.save();
    for (const p of this.particles) {
      switch (this.kind) {
        case 'fireflies':
        case 'pollen':
        case 'antigrav':
          ctx.globalAlpha = p.alpha ?? 1;
          ctx.fillStyle = this.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'embers': {
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2.4);
          grad.addColorStop(0, this.color);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 2.4, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'snow':
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = this.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 0.7, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'petals': {
          ctx.globalAlpha = p.state === 'piled' ? Math.max(0, 1 - p.pileT / 1.2) * 0.7 : 0.9;
          ctx.fillStyle = this.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          for (let k = 0; k < 5; k++) {
            const ang = (k / 5) * Math.PI * 2;
            const r = p.size * 1.6;
            const px = Math.cos(ang) * r, py = Math.sin(ang) * r * 0.6;
            if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'flaresparks': {
          ctx.globalAlpha = clamp01(1 - Math.abs(p.t - 0.5) * 2) * 0.9;
          ctx.strokeStyle = this.color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(p.origin.x, p.origin.y);
          const tt = clamp01(p.t);
          const qx = p.origin.x + (p.ctrl.x - p.origin.x) * tt;
          const qy = p.origin.y + (p.ctrl.y - p.origin.y) * tt;
          ctx.quadraticCurveTo(p.ctrl.x, p.ctrl.y, p.origin.x + (p.end.x - p.origin.x) * tt, p.origin.y + (p.end.y - p.origin.y) * tt);
          ctx.stroke();
          break;
        }
        case 'digitalrain': {
          const flicker = 0.5 + 0.5 * Math.sin(p.glyphT * 9 + p.phase);
          ctx.globalAlpha = 0.25 + 0.35 * flicker;
          ctx.fillStyle = this.color;
          ctx.fillRect(p.x, p.y, 2, 14);
          break;
        }
      }
    }
    ctx.restore();
  }
}
