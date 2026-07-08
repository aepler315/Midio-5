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
    this.polyRings = new ObjectPool(() => ({}), (o, i) => Object.assign(o, i, { age: 0 }), 8);
    this.splats = new ObjectPool(() => ({}), (o, i) => Object.assign(o, i, { age: 0 }), 20);
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

    // Hard landings additionally throw a rotating star polygon -- crisp
    // geometry cutting through the soft dust ring.
    if (I > 0.5) {
      this.polyRings.spawn({
        wx: worldX, y: groundY,
        n: 5 + Math.floor(rand() * 3), // pentagram / hexagram / heptagram
        Rd: 90 + 160 * I,
        spin: (rand() < 0.5 ? -1 : 1) * (1.5 + 2 * rand()),
        rot0: rand() * Math.PI * 2,
        star: 0.55, tau: 0.12, life: 0.5, I,
      });
    }

    if (camera) camera.shake(9 * I);
  }

  /** Mario Paint-style paint splat, stamped only on rhythm-clean landings:
   * a handful of chunky square blobs in one bright paint-pot color. */
  splat(worldX, groundY) {
    const rand = this.rand;
    const colors = ['#ff4d4d', '#ffd400', '#39c8ff', '#63e04d', '#ff7ad9', '#b06bff'];
    const blobs = [];
    const n = 6 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      blobs.push({
        dx: (rand() * 2 - 1) * 28,
        dy: -rand() * 9,
        s: 3 + Math.floor(rand() * 5),
      });
    }
    this.splats.spawn({ wx: worldX, y: groundY, color: colors[Math.floor(rand() * colors.length)], blobs, life: 2.8 });
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
    this.polyRings.step(dtSec, (o, dt) => { o.age += dt; return o.age < o.life; });
    this.splats.step(dtSec, (o, dt) => { o.age += dt; return o.age < o.life; });
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

    for (const sp of this.splats.active) {
      const t = sp.age / sp.life;
      const x = toScreen(sp.wx);
      ctx.fillStyle = sp.color;
      ctx.globalAlpha = 0.8 * (1 - t);
      for (const b of sp.blobs) {
        ctx.fillRect(Math.round(x + b.dx - b.s / 2), Math.round(sp.y + b.dy - b.s / 2), b.s, b.s);
      }
    }
    ctx.globalAlpha = 1;

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

    // Star-polygon shockwaves: 2n vertices alternating outer/inner radius,
    // spinning as they expand, spikes rippling with a 3-lobe wobble --
    // same ground-plane perspective squash as the dust ring above.
    for (const p of this.polyRings.active) {
      const t = p.age / p.life;
      const envelope = p.Rd * (1 - Math.exp(-p.age / p.tau));
      const alpha = Math.pow(1 - t, 2) * 0.55 * p.I;
      const x = toScreen(p.wx);
      const rot = p.rot0 + p.spin * p.age;
      ctx.strokeStyle = `rgba(255,235,170,${alpha})`;
      ctx.lineWidth = Math.max(0.5, 2.2 * (1 - t));
      ctx.beginPath();
      const verts = p.n * 2;
      for (let i = 0; i <= verts; i++) {
        const ang = rot + (i / verts) * Math.PI * 2;
        const spike = i % 2 === 0 ? 1 : p.star;
        const wobble = 1 + 0.08 * Math.sin(3 * ang + 12 * p.age);
        const rad = envelope * spike * wobble;
        const px = x + Math.cos(ang) * rad;
        const py = p.y + Math.sin(ang) * rad * 0.35;
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
