// Broshi, the ground raptor (spec §3.2). Obeys the groove: a relative-
// velocity spring against Midio (no absolute position target), a
// frequency->anatomy mapping driven by live band energy and note onsets,
// and a Rabid overlay gated on global track energy.
import { Role } from '../core/NoteEvent.js';
import { clamp, smoothstep, mulberry32, lerp } from '../utils/math.js';
import { hexLerp } from '../utils/color.js';
import { drawMesh, BROSHI_MESH } from '../render/MeshDrawer.js';
import { RABID_WEIGHTS } from '../audio/bands.js';
import { ObjectPool } from '../utils/ObjectPool.js';

const K = 26, C = 3.4; // spring stiffness (s^-2), damping (s^-1)
// Reference (1280px canvas) set-point offsets; scaled by worldScale per
// instance so Broshi's swing spans a consistent fraction of any screen size.
const D_TRAIL_REF = -190, D_SURGE_REF = 190, D_PANIC_REF = -260;
const PANIC_LOOKAHEAD_MS = 300;
const RABID_ENTER_G = 0.75, RABID_EXIT_G = 0.60, RABID_ENTER_HOLD_MS = 1500;
const RABID_FADE_SEC = 0.8;
const G_EMA_TAU = 0.4;
const TONGUE_COOLDOWN_MS = 350;

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutElastic = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
};

export class Broshi {
  constructor(conductor, paramBus, { seed = 555, worldScale = 1 } = {}) {
    this.conductor = conductor;
    this.rand = mulberry32(seed);
    this.worldScale = worldScale;
    this.dTrail = D_TRAIL_REF * worldScale;
    this.dSurge = D_SURGE_REF * worldScale;
    this.dPanic = D_PANIC_REF * worldScale;

    this.state = 'TRAIL'; // TRAIL | SURGE | PANIC
    this.surgeUntilMs = -Infinity;
    this._barEnergyAccum = 0;
    this._barEnergySamples = 0;
    this._barEnergyHistory = [];
    this._barsSinceSurge = 0;
    this._lastBarPeriodMs = 500;

    this.xRel = this.dTrail;
    this.xRelVel = 0;

    this.G = 0;
    this.rabid = false;
    this.rho = 0;
    this._rabidCandidateSinceMs = null;

    this.tongue = { state: 'idle', t: 0, len: 0, cooldownUntilMs: 0, targetLen: 0 };
    this.jawOpen = 0; // 0..1
    this._jawUntilMs = -Infinity;
    this.hopY = 0;
    this._hopUntilMs = -Infinity;
    this._hopStartMs = 0;
    this._hopH = 0;
    this.neckAngle = 0;
    this._neckStartMs = -Infinity;
    this._neckAmp = 0;

    this.tailAngle = 0;
    this._yawnUntilMs = -Infinity;
    this._yawnStartMs = -Infinity;
    this._yawnCooldownUntilMs = 0;
    this._calmBarStreak = 0;
    this.calmC = 0;
    this._lastCalmC = 1;

    this.spittle = new ObjectPool(() => ({}), (o, i) => Object.assign(o, i, { age: 0 }), 60);
    this.drool = new ObjectPool(() => ({}), (o, i) => Object.assign(o, i, { age: 0 }), 60);
    this._droolAccum = 0;

    conductor.onBar((bar) => this._onBar(bar));
    conductor.on(Role.RHYTHM, (evt) => {
      if (evt.kick) this._onKick();
      else if (evt.vel >= 0.3) this._onMiniHopTrigger(evt);
    });
    conductor.on(Role.MELODY, (evt) => this._onHeadBob(evt));
  }

  _onBar(bar) {
    const barEnergy = this._barEnergySamples > 0 ? this._barEnergyAccum / this._barEnergySamples : 0;
    const hist = this._barEnergyHistory;
    if (hist.length > 0) {
      const window = hist.slice(-4);
      const mean4 = window.reduce((a, b) => a + b, 0) / window.length;
      if (mean4 > 1e-6 && barEnergy > mean4 * 1.3) this._triggerSurge(bar.ms);
    }
    hist.push(barEnergy);
    if (hist.length > 8) hist.shift();
    this._barsSinceSurge++;
    if (this._barsSinceSurge >= 8) this._triggerSurge(bar.ms);

    // Yawn trigger: after >4 consecutive calm bars.
    this._lastCalmC = this.calmC ?? 1;
    if (this._lastCalmC > 0.75) this._calmBarStreak++;
    else this._calmBarStreak = 0;
    if (this._calmBarStreak >= 4 && bar.ms >= this._yawnCooldownUntilMs) {
      this._yawnUntilMs = bar.ms + 1400;
      this._yawnStartMs = bar.ms;
      this._yawnCooldownUntilMs = bar.ms + 4000;
      this._calmBarStreak = 0;
    }

    this._barEnergyAccum = 0;
    this._barEnergySamples = 0;
  }

  _triggerSurge(nowMs) {
    if (this.state === 'PANIC') return;
    this.state = 'SURGE';
    this.surgeUntilMs = nowMs + this._lastBarPeriodMs;
    this._barsSinceSurge = 0;
  }

  _onKick() {
    this.jawOpen = 1;
    this._jawUntilMs = -Infinity; // set precisely in update() using nowMs snapshot
    this._jawKickPending = true;
  }

  _onMiniHopTrigger(evt) {
    this._hopPending = { vel: evt.vel };
  }

  _onHeadBob(evt) {
    this._neckPending = { vel: evt.vel };
  }

  update(nowMs, dtSec, midio, energyCurves, obstacles, worldX, groundY, calm) {
    this.calmC = calm ? calm.C : 0;
    const tSec = nowMs / 1000;
    this.tailAngle = this.calmC * Math.sin(tSec * 2.6) * 22;

    const gInstant = energyCurves ? energyCurves.globalEnergy(nowMs, RABID_WEIGHTS) : 0;
    this._barEnergyAccum += gInstant;
    this._barEnergySamples++;

    if (this._jawKickPending) { this._jawKickPending = false; this._jawUntilMs = nowMs + 80; this.jawOpen = 1; }
    if (this._hopPending) { const { vel } = this._hopPending; this._hopPending = null; this._startHop(nowMs, vel); }
    if (this._neckPending) { const { vel } = this._neckPending; this._neckPending = null; this._neckStartMs = nowMs; this._neckAmp = 10 + 16 * vel; }

    // --- locomotion FSM ---
    const obs = obstacles ? obstacles.nearestAhead(worldX) : null;
    const dangerNear = !!obs && obs.tMs - nowMs <= PANIC_LOOKAHEAD_MS && obs.tMs - nowMs >= -100;
    if (dangerNear) this.state = 'PANIC';
    else if (this.state === 'PANIC') this.state = 'TRAIL';
    else if (this.state === 'SURGE' && nowMs >= this.surgeUntilMs) this.state = 'TRAIL';

    const dStar = this.state === 'SURGE' ? this.dSurge : this.state === 'PANIC' ? this.dPanic : this.dTrail;
    const accel = -K * (this.xRel - dStar) - C * this.xRelVel;
    this.xRelVel += accel * dtSec;
    this.xRel += this.xRelVel * dtSec;

    // --- Rabid gate ---
    const alpha = 1 - Math.exp(-dtSec / G_EMA_TAU);
    this.G += alpha * (gInstant - this.G);
    if (!this.rabid) {
      if (this.G > RABID_ENTER_G) {
        if (this._rabidCandidateSinceMs == null) this._rabidCandidateSinceMs = nowMs;
        if (nowMs - this._rabidCandidateSinceMs >= RABID_ENTER_HOLD_MS) this.rabid = true;
      } else {
        this._rabidCandidateSinceMs = null;
      }
    } else if (this.G < RABID_EXIT_G) {
      this.rabid = false;
    }
    this.rho = this.rabid
      ? smoothstep(RABID_ENTER_G, 0.95, this.G)
      : Math.max(0, this.rho - dtSec / RABID_FADE_SEC);

    // --- tongue-lash (BASS band E1) ---
    const e1 = energyCurves ? energyCurves.sample(1, nowMs) : 0;
    const s = smoothstep(0.55, 0.80, e1);
    const tongueCap = 96 * (1 + 0.5 * this.rho);
    const cooldownMs = TONGUE_COOLDOWN_MS * (1 - 0.45 * this.rho);
    if (this.tongue.state === 'idle' && nowMs >= this.tongue.cooldownUntilMs && s > 0.05) {
      this.tongue.state = 'extend';
      this.tongue.t = 0;
      this.tongue.targetLen = tongueCap * s;
    } else if (this.tongue.state === 'extend') {
      this.tongue.t += dtSec / 0.09;
      this.tongue.len = this.tongue.targetLen * easeOutCubic(clamp(this.tongue.t, 0, 1));
      if (this.tongue.t >= 1) {
        this.tongue.state = 'retract';
        this.tongue.t = 0;
        this._spawnSpittle();
      }
    } else if (this.tongue.state === 'retract') {
      this.tongue.t += dtSec / 0.22;
      const e = easeOutElastic(clamp(this.tongue.t, 0, 1));
      this.tongue.len = Math.max(0, this.tongue.targetLen * (1 - e));
      if (this.tongue.t >= 1) {
        this.tongue.state = 'idle';
        this.tongue.len = 0;
        this.tongue.cooldownUntilMs = nowMs + cooldownMs;
      }
    }

    // --- jaw (yawn overrides everything when calm) ---
    const yawning = nowMs < this._yawnUntilMs;
    if (yawning) {
      const yawningDur = this._yawnUntilMs - this._yawnStartMs;
      const u = yawningDur > 0 ? clamp((nowMs - this._yawnStartMs) / yawningDur, 0, 1) : 1;
      const shape = Math.sin(Math.PI * u);
      this.jawOpen = 0.15 + 0.85 * shape;
      this.neckAngle = 10 - 18 * shape; // head dips at peak yawn
    } else {
      if (nowMs >= this._jawUntilMs) this.jawOpen = Math.max(0, this.jawOpen - dtSec / 0.05);
      const jawSnapHz = 2 * (1 + 3 * this.rho);
      if (this.rabid) this.jawOpen = 0.5 + 0.5 * Math.sin(2 * Math.PI * jawSnapHz * (nowMs / 1000));
    }

    // --- mini-hop ---
    if (nowMs < this._hopUntilMs) {
      const D = 160 * (1 / (1 + 0.6 * this.rho));
      const u = clamp(1 - (this._hopUntilMs - nowMs) / D, 0, 1);
      this.hopY = this._hopH * 4 * u * (1 - u); // simple parabola, peak at u=0.5
    } else {
      this.hopY = 0;
    }

    // --- head-bob (neck angle), suppressed during yawn ---
    if (!yawning) {
      const dt = nowMs - this._neckStartMs;
      this.neckAngle = dt >= 0 && dt < 600
        ? this._neckAmp * Math.exp(-dt / 180) * Math.sin((2 * Math.PI * dt) / 220)
        : 0;
    }

    // --- rabid aura / drool ---
    if (this.rabid) {
      this._droolAccum += 4 * this.rho * dtSec;
      while (this._droolAccum >= 1) {
        this._droolAccum -= 1;
        this.drool.spawn({ x: 0, y: 0, vy: 40, life: 0.6 + 0.3 * this.rand() });
      }
    }

    this.spittle.step(dtSec, (o, dtt) => { o.x += o.vx * dtt; o.y += o.vy * dtt; o.vy += 400 * dtt; o.age += dtt; return o.age < o.life; });
    this.drool.step(dtSec, (o, dtt) => { o.y += o.vy * dtt; o.age += dtt; return o.age < o.life; });

    this.groundY = groundY;
    this.screenX = midio.screenX + this.xRel;
  }

  _startHop(nowMs, vel) {
    // Calm = higher, floatier hops; intense = lower, tighter twitches.
    this._hopH = (10 + 18 * vel) * (0.35 + 0.65 * this.calmC);
    this._hopUntilMs = nowMs + 160 * (0.6 + 0.7 * this.calmC);
  }

  _spawnSpittle() {
    for (let i = 0; i < 3; i++) {
      const ang = -0.38 + (this.rand() * 2 - 1) * 0.3; // ~22deg below horizontal, jittered
      const speed = 80 + 60 * this.rand();
      this.spittle.spawn({
        x: this.tongue.len, y: 0,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        life: 0.3 + 0.2 * this.rand(),
      });
    }
  }

  draw(ctx) {
    const skin = hexLerp('#63c74d', '#e43b44', this.rho);
    const x = this.screenX;
    const y = this.groundY - this.hopY;

    ctx.save();
    ctx.translate(x, y);

    if (this.rho > 0.02) {
      ctx.save();
      ctx.globalAlpha = 0.5 * this.rho;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 16; i++) {
        const ang = (i / 16) * Math.PI * 2;
        const r = 26 + (this.rand() * 2 - 1) * 3;
        const px = Math.cos(ang) * r, py = -18 + Math.sin(ang) * r * 0.7;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // tongue (behind head, extends forward/down)
    if (this.tongue.len > 0.5) {
      ctx.strokeStyle = '#ff5f7a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(6, -16);
      const midX = 6 + this.tongue.len * 0.6, midY = -16 + this.tongue.len * 0.22;
      const endX = 6 + this.tongue.len * Math.cos(22 * Math.PI / 180);
      const endY = -16 + this.tongue.len * Math.sin(22 * Math.PI / 180);
      ctx.quadraticCurveTo(midX, midY, endX, endY);
      ctx.stroke();
    }
    for (const p of this.spittle.active) {
      ctx.fillStyle = 'rgba(255,140,160,0.8)';
      ctx.beginPath();
      ctx.arc(6 + p.x, -16 + p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wireframe body/head/jaw/tail (item 1). Keep FX (tongue, spittle, drool, aura) separate.
    const meshBaseHue = lerp(120, 0, this.rho); // green → red as rabid grows
    drawMesh(ctx, BROSHI_MESH, {
      x: 0, y: 0, scaleX: 1, scaleY: 1,
      jawOpen: this.jawOpen, neckAngle: this.neckAngle, tailAngle: this.tailAngle,
    }, meshBaseHue, { fill: true, lineWidth: 1.5, glow: true });

    for (const d of this.drool.active) {
      ctx.fillStyle = 'rgba(150,220,255,0.7)';
      ctx.beginPath();
      ctx.arc(12, -16 + d.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
