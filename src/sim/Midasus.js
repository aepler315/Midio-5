// Midasus, the airborne fairy (spec §3.1). Obeys the score: absolute
// pitch-space coordinates, zero inertia tolerance. Sequential no-skip note
// tracking — each trigger latches the note target for 85% of the gap to the
// next onset, with a 35% position snap and velocity kick; a PD pursuit
// controller carries the fairy there along a continuous arc. A Lissajous
// orbit governs rests. Pitch range is a rolling 8-bar p10–p90 window.
import { Role } from '../core/NoteEvent.js';
import { ObjectPool } from '../utils/ObjectPool.js';
import { clamp, lerp, mulberry32 } from '../utils/math.js';
import { drawMesh, MIDASUS_MESH, MIDASUS_SCALE } from '../render/MeshDrawer.js';

const SILENCE_MS = 800;
const BLEND_SEC = 0.4;
const LATCH_FRAC = 0.85;
const KP_LATCH = 140, KP_ORBIT = 90, KD = 16;
const KICK = 4.5;
const KICK_CAP = 1500;
const DAMP = 0.30;
const SNAP = 0.35;

export class Midasus {
  constructor(conductor, midio, { groundY = 480, ceilingY = 40, seed = 777, worldScale = 1 } = {}) {
    this.conductor = conductor;
    this.midio = midio;
    this.yFloor = groundY;
    this.yCeiling = ceilingY;
    this.worldScale = worldScale;

    this.q = conductor.timeline.filter((e) => e.role === Role.MELODY).sort((a, b) => a.tMs - b.tMs);
    this.i = 0;

    let pMin = 48, pMax = 84;
    if (this.q.length) {
      const pitches = this.q.map((n) => n.pitch).sort((a, b) => a - b);
      pMin = pitches[Math.floor(0.10 * pitches.length)];
      pMax = pitches[Math.min(pitches.length - 1, Math.floor(0.90 * pitches.length))];
      if (pMax <= pMin) pMax = pMin + 12;
    }
    this.pMin = pMin;
    this.pMax = pMax;

    this.p = { x: midio.screenX + 90, y: groundY - 200 };
    this.v = { x: 0, y: 0 };
    this.lastNoteMs = -Infinity;
    this.hue = 200;
    this.rest = 0;
    this._latched = null;
    this._prevNoteTMs = -Infinity;
    this._barPeriodMs = 2000;
    this._simMs = 0;

    this.rand = mulberry32(seed);
    this.phi = 0;
    this.particles = new ObjectPool(() => ({}), (o, init) => Object.assign(o, init, { age: 0 }), 600);
    this._emitAccum = 0;

    conductor.onBar((bar) => this._refreshPitchWindow(bar));
  }

  _refreshPitchWindow(bar) {
    const bars = this.conductor.barGrid;
    const idx = bars.findIndex((b) => b.ms === bar.ms);
    if (idx > 0) this._barPeriodMs = bar.ms - bars[idx - 1].ms;
    else if (bars.length > 1) this._barPeriodMs = bars[1].ms - bars[0].ms;

    const windowStart = bar.ms - 8 * this._barPeriodMs;
    const windowEnd = bar.ms + this._barPeriodMs;
    const pitches = this.q
      .filter((n) => n.tMs >= windowStart && n.tMs < windowEnd)
      .map((n) => n.pitch)
      .sort((a, b) => a - b);
    if (!pitches.length) return;

    this.pMin = pitches[Math.floor(0.10 * pitches.length)];
    this.pMax = pitches[Math.min(pitches.length - 1, Math.floor(0.90 * pitches.length))];
    if (this.pMax <= this.pMin) this.pMax = this.pMin + 12;
  }

  _target(n) {
    const registerNorm = clamp((n.pitch - this.pMin) / (this.pMax - this.pMin), 0, 1);
    const y = lerp(this.yFloor - 120, this.yCeiling + 60, registerNorm);
    const x = this.midio.screenX + (70 + 140 * n.vel + 40 * registerNorm) * this.worldScale;
    return { x, y };
  }

  targetFor(note) {
    return this._target(note);
  }

  _orbitAnchor(nowMs, calm = null) {
    const C = calm ? calm.C : 0;
    const ax = this.midio.screenX;
    const ay = this.midio.groundY - this.midio.y - 130;
    const t = nowMs / 1000;
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

  _pursuitTarget(nowMs) {
    const nxt = this.q[this.i];
    const silence = nowMs - this.lastNoteMs >= SILENCE_MS || !nxt;
    const latchedActive = this._latched && nowMs < this._latched.untilMs;

    if (latchedActive) {
      // Drift from the latched onset toward the next note across the 85% hold window.
      const blend = clamp((nowMs - this._latched.onsetMs) / (this._latched.untilMs - this._latched.onsetMs), 0, 1);
      if (this._latched.nxtNote) {
        const ahead = this._target(this._latched.nxtNote);
        return {
          x: lerp(this._latched.x, ahead.x, blend),
          y: lerp(this._latched.y, ahead.y, blend),
        };
      }
      return { x: this._latched.x, y: this._latched.y };
    }
    if (silence) return this._orbitAnchor(nowMs);
    return this._target(nxt);
  }

  _pursuitStep(nowMs, dtSec, calm = null) {
    const C = calm ? calm.C : 0;
    const nxt = this.q[this.i];
    const silence = nowMs - this.lastNoteMs >= SILENCE_MS || !nxt;
    const latchedActive = this._latched && nowMs < this._latched.untilMs;
    const target = this._pursuitTarget(nowMs);
    const kp = (latchedActive || !silence) ? KP_LATCH : KP_ORBIT;
    const restTarget = silence ? 1 : 0;
    this.rest += clamp((restTarget - this.rest) * (dtSec / BLEND_SEC), -1, 1);
    this.rest = clamp(this.rest, 0, 1);

    this.v.x += (kp * (target.x - this.p.x) - KD * this.v.x) * dtSec;
    this.v.y += (kp * (target.y - this.p.y) - KD * this.v.y) * dtSec;
    this.p.x += this.v.x * dtSec;
    this.p.y += this.v.y * dtSec;

    this.phi += (0.15 - 0.05 * C) * dtSec;
    const speed = Math.hypot(this.v.x, this.v.y);
    const rateMul = 0.15 + 0.85 * (1 - this.rest);
    const rate = (2 + 26 * Math.min(1, speed / 1400)) * rateMul;
    this._emitAccum += rate * dtSec * 60;
    while (this._emitAccum >= 1) { this._emitAccum -= 1; this._emitStreak(speed, C); }
  }

  _consumeNote(n, nxtNote) {
    const t = this._target(n);
    const gapToNext = nxtNote ? (nxtNote.tMs - n.tMs) : SILENCE_MS;
    const hue = this._hueOf(n.pitch);
    this._latched = {
      x: t.x, y: t.y, hue,
      onsetMs: n.tMs,
      nxtNote: nxtNote || null,
      untilMs: n.tMs + LATCH_FRAC * gapToNext,
    };

    const dx0 = t.x - this.p.x, dy0 = t.y - this.p.y;
    const dist0 = Math.hypot(dx0, dy0) || 1;
    const kick = Math.min(KICK_CAP, dist0 * KICK);
    const inv = kick / dist0;
    this.v.x = this.v.x * DAMP + dx0 * inv;
    this.v.y = this.v.y * DAMP + dy0 * inv;
    this.p.x += SNAP * dx0;
    this.p.y += SNAP * dy0;
    if (n.tMs - this._prevNoteTMs > SILENCE_MS) {
      const rx = t.x - this.p.x, ry = t.y - this.p.y;
      this.p.x += SNAP * rx;
      this.p.y += SNAP * ry;
      this.v.x = rx / 0.04;
      this.v.y = ry / 0.04;
    }
    this.hue = hue;
    this._burst(8 + 24 * n.vel, this.hue);
    this.lastNoteMs = n.tMs;
    this._prevNoteTMs = n.tMs;
  }

  update(nowMs, dtSec, calm = null) {
    const startMs = this._simMs || (nowMs - dtSec * 1000);
    let cursor = startMs;

    while (this.i < this.q.length && this.q[this.i].tMs <= nowMs) {
      const n = this.q[this.i];
      const onsetMs = n.tMs;
      if (onsetMs > cursor) {
        this._pursuitStep(onsetMs, (onsetMs - cursor) / 1000, calm);
        cursor = onsetMs;
      }
      this._consumeNote(n, this.q[this.i + 1]);
      this.i++;
    }

    if (nowMs > cursor) this._pursuitStep(nowMs, (nowMs - cursor) / 1000, calm);
    this._simMs = nowMs;

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
      const alpha = (1 - t) * 0.9;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    drawMesh(ctx, MIDASUS_MESH, {
      x: this.p.x, y: this.p.y,
      scaleX: MIDASUS_SCALE, scaleY: MIDASUS_SCALE,
    }, this.hue, { fill: false, lineWidth: 1.5, glow: true });
  }
}