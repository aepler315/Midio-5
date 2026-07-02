// Landing-impact FX fan-out (spec §2.2.1): crater flash, dust ring, dust
// motes, screen shake, ground scar. Pooled, zero allocation once warm.
// Positions are stored in world-space so short-lived bursts stay glued to
// the ground point where they were spawned as the world scrolls under them.
import { ObjectPool } from '../utils/ObjectPool.js';
import { clamp, mulberry32 } from '../utils/math.js';

export class ImpactFX {
  constructor(seed = 1) {
    this.rand = mulberry32(seed);

    this.craters = new ObjectPool(() => ({}), (o, i) => Object.assign(o, i, { age: 0 }), 16);
    this.rings = new ObjectPool(
      () => ({ jitter: new Float32Array(24) }),
      (o, i) => { Object.assign(o, i, { age: 0 }); },
      16,
    );
    this.motes = new ObjectPool(() => ({}), (o, i) => Object.assign(o, i, { age: 0 }), 400);
    this.scars = []; // small list, capped manually — decals persist seconds, not worth pooling

    this._sputterAccum = 0;
  }

  /** vLandPxMs -> normalized landing intensity I (spec §2.2.1). */
  static intensity(vLandPxMs, vRefPxMs) {
    return Math.pow(clamp(vLandPxMs / vRefPxMs, 0, 1), 0.7);
  }

  trigger(worldX, groundY, I, camera) {
    const rand = this.rand;

    this.craters.spawn({ wx: worldX, y: groundY, R: 14 + 66 * I, alpha: 0.85 * I, life: 0.12 });

    const ring = this.rings.spawn({ wx: worldX, y: groundY, Rd: 40 + 120 * I, tau: 0.09, life: 0.42 });
    for (let i = 0; i < 24; i++) ring.jitter[i] = (rand() * 2 - 1) * 4 * I;

    const n = Math.round(6 + 18 * I);
    for (let i = 0; i < n; i++) {
      const theta = (rand() * 2 - 1) * (35 * Math.PI / 180);
      const dir = rand() < 0.5 ? -1 : 1;
      const speed = 60 + 160 * I * rand();
      this.motes.spawn({
        wx: worldX, y: groundY,
        vx: Math.cos(theta) * speed * dir,
        vy: -Math.abs(Math.sin(theta) * speed) - 20,
        size: 3, life: 0.26 + 0.16 * rand(),
      });
    }

    this.scars.push({ wx: worldX, y: groundY, width: 20 + 40 * I, age: 0, maxAge: 4 });
    if (this.scars.length > 60) this.scars.shift();

    if (camera) camera.shake(9 * I);
  }

  /** One-shot dust burst (gag crack-dust, item 5) — rising motes, no crater/ring. */
  dustBurst(worldX, groundY, n) {
    const rand = this.rand;
    for (let i = 0; i < n; i++) {
      const dir = rand() < 0.5 ? -1 : 1;
      const speed = 30 + 90 * rand();
      this.motes.spawn({
        wx: worldX + (rand() * 2 - 1) * 60, y: groundY,
        vx: Math.cos(0.5) * speed * dir,
        vy: -40 - 60 * rand(),
        size: 2 + 2 * rand(), life: 0.4 + 0.3 * rand(),
      });
    }
  }

  /** Pre-kick sputter dust at Midio's feet during telegraph anticipation (spec §2.2.3). */
  sputter(worldX, groundY, dtSec) {
    this._sputterAccum += dtSec * 120; // ~2 per rendered frame at 60fps == ~1 per sim step at 120Hz
    while (this._sputterAccum >= 1) {
      this._sputterAccum -= 1;
      const rand = this.rand;
      this.motes.spawn({
        wx: worldX + (rand() * 2 - 1) * 10, y: groundY,
        vx: (rand() * 2 - 1) * 20, vy: -20 - rand() * 20,
        size: 1.5, life: 0.15 + 0.1 * rand(),
      });
    }
  }

  step(dtSec) {
    this.craters.step(dtSec, (o, dt) => { o.age += dt; return o.age < o.life; });
    this.rings.step(dtSec, (o, dt) => { o.age += dt; return o.age < o.life; });
    this.motes.step(dtSec, (o, dt) => {
      o.vy += 300 * dt;
      o.wx += o.vx * dt;
      o.y += o.vy * dt;
      o.age += dt;
      return o.age < o.life;
    });
    for (let i = this.scars.length - 1; i >= 0; i--) {
      this.scars[i].age += dtSec;
      if (this.scars[i].age > this.scars[i].maxAge) this.scars.splice(i, 1);
    }
  }

  /** worldX: current scroll distance; originX: screen-space x that worldX=0 maps to (Midio's screenX). */
  draw(ctx, worldX, originX) {
    const toScreen = (wx) => wx - worldX + originX;

    for (const s of this.scars) {
      const t = s.age / s.maxAge;
      ctx.fillStyle = `rgba(20,10,25,${0.35 * (1 - t)})`;
      const x = toScreen(s.wx);
      ctx.fillRect(x - s.width / 2, s.y, s.width, 4);
    }

    for (const c of this.craters.active) {
      const t = c.age / c.life;
      const x = toScreen(c.wx);
      const g = ctx.createRadialGradient(x, c.y, 0, x, c.y, c.R);
      const a = c.alpha * (1 - t);
      g.addColorStop(0, `rgba(255,240,200,${a})`);
      g.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, c.y, c.R, c.R * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const r of this.rings.active) {
      const t = r.age / r.life;
      const radius = r.Rd * (1 - Math.exp(-r.age / r.tau));
      const alpha = Math.pow(1 - t, 2);
      const x = toScreen(r.wx);
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * alpha})`;
      ctx.lineWidth = Math.max(0.5, 3 * (1 - t));
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const ang = (i / 24) * Math.PI * 2;
        const rad = radius + r.jitter[i % 24];
        const px = x + Math.cos(ang) * rad;
        const py = r.y + Math.sin(ang) * rad * 0.35;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(230,220,200,0.9)';
    for (const m of this.motes.active) {
      const t = m.age / m.life;
      const x = toScreen(m.wx);
      const size = m.size * (1 - t);
      if (size <= 0) continue;
      ctx.globalAlpha = 1 - t;
      ctx.beginPath();
      ctx.arc(x, m.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
