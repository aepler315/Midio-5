// Midasus, the airborne fairy (spec §3.1). Obeys the score: absolute
// pitch-space coordinates, zero inertia tolerance. Sequential no-skip note
// tracking — each trigger launches the fairy toward the note with a velocity
// impulse, and a PD pursuit controller carries it there along a continuous
// arc (so it always flies, never teleports). A Lissajous orbit governs rests.
import { Role } from '../core/NoteEvent.js';
import { ObjectPool } from '../utils/ObjectPool.js';
import { clamp, lerp, mulberry32 } from '../utils/math.js';
import { drawMesh, MIDASUS_MESH, CHAR_SCALE } from '../render/MeshDrawer.js';

const SILENCE_MS = 800;
const BLEND_SEC = 0.4;
const KP = 90, KD = 12;
// Note-trigger launch: a velocity impulse toward the target (px of velocity
// per px of distance), plus momentum damping so direction changes read
// instantly. Capped so a far/high-velocity note can't sling the fairy past
// the target — the PD controller finishes the approach smoothly.
const KICK = 3.0;
const KICK_CAP = 1500; // px/s max launch speed from a single note
const DAMP = 0.45;

export class Midasus {
  constructor(timeline, midio, { groundY = 480, ceilingY = 40, seed = 777, worldScale = 1 } = {}) {
    this.midio = midio;
    this.yFloor = groundY;
    this.yCeiling = ceilingY;
    this.worldScale = worldScale;

    this.q = timeline.filter((e) => e.role === Role.MELODY).sort((a, b) => a.tMs - b.tMs);
    this.i = 0;

    let pMin = 48, pMax = 84;
    if (this.q.length) {
      const pitches = this.q.map((n) => n.pitch).sort((a, b) => a - b);
      pMin = pitches[Math.floor(0.05 * pitches.length)];
      pMax = pitches[Math.min(pitches.length - 1, Math.floor(0.95 * pitches.length))];
      if (pMax <= pMin) pMax = pMin + 12;
    }
    this.pMin = pMin;
    this.pMax = pMax;

    this.p = { x: midio.screenX + 90, y: groundY - 200 };
    this.v = { x: 0, y: 0 };
    this.lastNoteMs = -Infinity;
    this.hue = 200;
    this.rest = 0; // 0 = active/full color, 1 = resting/desaturated

    this.rand = mulberry32(seed);
    this.phi = 0;
    this.particles = new ObjectPool(() => ({}), (o, init) => Object.assign(o, init, { age: 0 }), 600);
    this._emitAccum = 0;
  }

  _target(n) {
    const norm = clamp((n.pitch - this.pMin) / (this.pMax - this.pMin), 0, 1);
    const y = lerp(this.yFloor - 120, this.yCeiling + 60, norm);
    // Hot notes push the fairy much further out ahead of Midio — a wide,
    // energetic range rather than a small tether (scaled to the screen).
    const x = this.midio.screenX + (90 + 260 * n.vel) * this.worldScale;
    return { x, y };
  }

  _orbitAnchor(nowMs, calm = null) {
    const C = calm ? calm.C : 0;
    const ax = this.midio.screenX;
    const ay = this.midio.groundY - this.midio.y - 130;
    const t = nowMs / 1000;
    // Calm = wider, slower orbit; loud = tighter, faster.
    const axAmp = (140 + 100 * C) * this.worldScale;
    const ayAmp = (80 + 55 * C) * this.worldScale;
    const freqMul = 1 - 0.35 * C;
    const x = ax + axAmp * Math.sin(1.8 * freqMul * t + this.phi);
    const y = ay + ayAmp * Math.sin(1.2 * freqMul * t);
    return { x, y };
  }

  _hueOf(pitch) { return (((pitch % 12) + 12) % 12) * 30; }

  _burst(n, hue) {
    for (let i = 0; i < n; i++) {
      const ang = this.rand() * Math.PI * 2;
      const speed = 40 + 80 * this.rand();
      this.particles.spawn({
        x: this.p.x, y: this.p.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        size: 4, hue, life: 0.3 + 0.2 * this.rand(),
      });
    }
  }

  /** External callers (MidioPerformer apex sparkle) can emit a burst at a point. */
  burstAt(x, y, n, hue = this.hue) {
    for (let i = 0; i < n; i++) {
      const ang = this.rand() * Math.PI * 2;
      const speed = 40 + 80 * this.rand();
      this.particles.spawn({
        x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        size: 3, hue, life: 0.25 + 0.15 * this.rand(),
      });
    }
  }

  _emitStreak(speed, calmC = 0) {
    const jitter = 25;
    this.particles.spawn({
      x: this.p.x, y: this.p.y,
      vx: this.v.x * 0.3 + (this.rand() * 2 - 1) * jitter,
      vy: this.v.y * 0.3 + (this.rand() * 2 - 1) * jitter,
      size: 3, hue: this.hue,
      life: ((260 + 160 * this.rand()) / 1000) * (1 + 0.6 * calmC),
    });
  }

  update(nowMs, dtSec, calm = null) {
    const C = calm ? calm.C : 0;
    while (this.i < this.q.length && this.q[this.i].tMs <= nowMs) {
      const n = this.q[this.i++];
      const t = this._target(n);
      // Launch toward the note target with a capped velocity impulse — the PD
      // controller then flies the fairy there along a continuous arc. (A prior
      // 70% position snap made far/high-velocity notes teleport instantly.)
      const dx = t.x - this.p.x, dy = t.y - this.p.y;
      const kick = Math.min(KICK_CAP, Math.hypot(dx, dy) * KICK);
      const inv = kick / (Math.hypot(dx, dy) || 1);
      this.v.x = this.v.x * DAMP + dx * inv;
      this.v.y = this.v.y * DAMP + dy * inv;
      this.hue = this._hueOf(n.pitch);
      this._burst(8 + 24 * n.vel, this.hue);
      this.lastNoteMs = nowMs;
    }

    this.phi += (0.15 - 0.05 * C) * dtSec;

    const nxt = this.q[this.i];
    const silence = nowMs - this.lastNoteMs >= SILENCE_MS || !nxt;
    const target = silence ? this._orbitAnchor(nowMs, calm) : this._target(nxt);
    const restTarget = silence ? 1 : 0;
    this.rest += clamp((restTarget - this.rest) * (dtSec / BLEND_SEC), -1, 1);
    this.rest = clamp(this.rest, 0, 1);

    this.v.x += (KP * (target.x - this.p.x) - KD * this.v.x) * dtSec;
    this.v.y += (KP * (target.y - this.p.y) - KD * this.v.y) * dtSec;
    this.p.x += this.v.x * dtSec;
    this.p.y += this.v.y * dtSec;

    const speed = Math.hypot(this.v.x, this.v.y);
    const rateMul = 0.15 + 0.85 * (1 - this.rest);
    const rate = (2 + 26 * Math.min(1, speed / 1400)) * rateMul;
    this._emitAccum += rate * dtSec * 60;
    while (this._emitAccum >= 1) { this._emitAccum -= 1; this._emitStreak(speed, C); }

    this.particles.step(dtSec, (o, dt) => {
      o.x += o.vx * dt; o.y += o.vy * dt; o.age += dt;
      return o.age < o.life;
    });
  }

  draw(ctx) {
    const sat = Math.round(90 - 40 * this.rest);
    for (const p of this.particles.active) {
      const t = p.age / p.life;
      const size = p.size * (1 - t);
      if (size <= 0) continue;
      ctx.fillStyle = `hsla(${p.hue},${sat}%,65%,${(1 - t) * 0.9})`;
      // Calm = fainter, longer-lived ambient trail.
      const alpha = (1 - t) * 0.9;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    drawMesh(ctx, MIDASUS_MESH, {
      x: this.p.x, y: this.p.y,
      scaleX: CHAR_SCALE, scaleY: CHAR_SCALE,
    }, this.hue, { fill: false, lineWidth: 1.5, glow: true });
  }
}
