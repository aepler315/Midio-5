// Broshi, the ground raptor (spec §3.2). Obeys the groove: a relative-
// velocity spring against Midio (no absolute position target), a
// frequency->anatomy mapping driven by live band energy and note onsets,
// and a Rabid overlay gated on global track energy.
import { Role } from '../core/NoteEvent.js';
import { clamp, smoothstep, mulberry32, lerp } from '../utils/math.js';
import { hexLerp, hexToRgb, rgbToHsl } from '../utils/color.js';
import { RABID_WEIGHTS } from '../audio/bands.js';
import { ObjectPool } from '../utils/ObjectPool.js';
import { BROSHI_BODY, BROSHI_HEAD, BROSHI_JAW, BROSHI_EYE, BROSHI_TAIL } from '../render/meshes.js';
import { computeRestLengths, drawMeshPart, displaceMeshRadial } from '../render/MeshDrawer.js';
import { ModalRing } from '../render/oscillators.js';

const K = 26, C = 3.4; // spring stiffness (s^-2), damping (s^-1)
const D_TRAIL = -140, D_SURGE = 120, D_PANIC = -220;
const PANIC_LOOKAHEAD_MS = 300;
const RABID_ENTER_G = 0.75, RABID_EXIT_G = 0.60, RABID_ENTER_HOLD_MS = 1500;
const RABID_FADE_SEC = 0.8;
const G_EMA_TAU = 0.4;
const TONGUE_COOLDOWN_MS = 350;

// Calm/idle behaviors (follow-up item 3): a relaxed lope (softer hops, a
// wide lazy tail sway) plus an occasional yawn during sustained quiet
// stretches, so low-intensity sections still feel alive.
const TAIL_BASE_HZ = 1.3, TAIL_CALM_HZ = 0.32;
const TAIL_BASE_DEG = 9, TAIL_CALM_DEG = 18;
const DRAW_SCALE = 1.45; // ferocity pass: render-only, physics untouched
const WEAVE_PX = 6;      // predatory side-to-side drift while trailing
const BEAT_FLASH_DECAY_SEC = 0.14;
const CALM_LEVEL_THRESHOLD = 0.5;
const CALM_BAR_THRESHOLD = 4;
const YAWN_CHANCE_PER_BAR = 0.35;
const YAWN_COOLDOWN_BARS = 8;
const YAWN_DUR_MS = 1400;

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutElastic = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
};

export class Broshi {
  constructor(conductor, paramBus, { seed = 555 } = {}) {
    this.conductor = conductor;
    this.rand = mulberry32(seed);

    this.state = 'TRAIL'; // TRAIL | SURGE | PANIC
    this.surgeUntilMs = -Infinity;
    this._barEnergyAccum = 0;
    this._barEnergySamples = 0;
    this._barEnergyHistory = [];
    this._barsSinceSurge = 0;
    this._lastBarPeriodMs = 500;

    this.xRel = D_TRAIL;
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

    this.spittle = new ObjectPool(() => ({}), (o, i) => Object.assign(o, i, { age: 0 }), 60);
    this.drool = new ObjectPool(() => ({}), (o, i) => Object.assign(o, i, { age: 0 }), 60);
    this._droolAccum = 0;

    this._bodyRest = computeRestLengths(BROSHI_BODY);
    this._headRest = computeRestLengths(BROSHI_HEAD);
    this._jawRest = computeRestLengths(BROSHI_JAW);
    this._eyeRest = computeRestLengths(BROSHI_EYE);
    this._tailRest = computeRestLengths(BROSHI_TAIL);

    this._calmLevel = 0;
    this._calmBarsStreak = 0;
    this._barsSinceYawn = Infinity;
    this._yawnStartMs = -Infinity;
    this.tailAngle = 0;
    this._tailPhase = this.rand() * Math.PI * 2;

    // Body vibration: struck by kicks and hops, and fed a continuous low
    // shiver while rabid so his whole silhouette trembles at high energy.
    this.modal = new ModalRing({ modes: 4, baseHz: 7, decaySec: 0.5, seed: seed + 1 });
    this.beatFlash = 0;
    this._nowMs = 0;

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
    this._barEnergyAccum = 0;
    this._barEnergySamples = 0;

    if (this._calmLevel > CALM_LEVEL_THRESHOLD) this._calmBarsStreak++;
    else this._calmBarsStreak = 0;
    this._barsSinceYawn++;
    if (this._calmBarsStreak >= CALM_BAR_THRESHOLD && this._barsSinceYawn >= YAWN_COOLDOWN_BARS
      && !this.rabid && this.rand() < YAWN_CHANCE_PER_BAR) {
      this._yawnStartMs = bar.ms;
      this._barsSinceYawn = 0;
    }
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
    this.beatFlash = 1;
  }

  _onMiniHopTrigger(evt) {
    this._hopPending = { vel: evt.vel };
  }

  _onHeadBob(evt) {
    this._neckPending = { vel: evt.vel };
  }

  update(nowMs, dtSec, midio, energyCurves, obstacles, worldX, groundY, calmLevel = 0) {
    this._calmLevel = calmLevel;
    const gInstant = energyCurves ? energyCurves.globalEnergy(nowMs, RABID_WEIGHTS) : 0;
    this._barEnergyAccum += gInstant;
    this._barEnergySamples++;

    if (this._jawKickPending) { this._jawKickPending = false; this._jawUntilMs = nowMs + 80; this.jawOpen = 1; this.modal.excite(2.6); }
    if (this._hopPending) { const { vel } = this._hopPending; this._hopPending = null; this._startHop(nowMs, vel); this.modal.excite(0.6 + 1.2 * vel); }
    if (this._neckPending) { const { vel } = this._neckPending; this._neckPending = null; this._neckStartMs = nowMs; this._neckAmp = 10 + 16 * vel; }

    // --- locomotion FSM ---
    const obs = obstacles ? obstacles.nearestAhead(worldX) : null;
    const dangerNear = !!obs && obs.tMs - nowMs <= PANIC_LOOKAHEAD_MS && obs.tMs - nowMs >= -100;
    if (dangerNear) this.state = 'PANIC';
    else if (this.state === 'PANIC') this.state = 'TRAIL';
    else if (this.state === 'SURGE' && nowMs >= this.surgeUntilMs) this.state = 'TRAIL';

    const dStar = this.state === 'SURGE' ? D_SURGE : this.state === 'PANIC' ? D_PANIC : D_TRAIL;
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

    // --- jaw (yawn takes priority over the idle decay, kicks/rabid override both) ---
    const sinceYawn = nowMs - this._yawnStartMs;
    if (sinceYawn >= 0 && sinceYawn < YAWN_DUR_MS) {
      this.jawOpen = Math.sin((sinceYawn / YAWN_DUR_MS) * Math.PI) * 0.85;
    } else if (nowMs >= this._jawUntilMs) {
      this.jawOpen = Math.max(0, this.jawOpen - dtSec / 0.05);
    }
    const jawSnapHz = 2 * (1 + 3 * this.rho);
    if (this.rabid) this.jawOpen = 0.5 + 0.5 * Math.sin(2 * Math.PI * jawSnapHz * (nowMs / 1000));

    // --- tail sway: wider and lazier the calmer things get, never still ---
    const tailHz = lerp(TAIL_BASE_HZ, TAIL_CALM_HZ, calmLevel);
    const tailDeg = lerp(TAIL_BASE_DEG, TAIL_CALM_DEG, calmLevel);
    this.tailAngle = tailDeg * Math.sin(2 * Math.PI * tailHz * (nowMs / 1000) + this._tailPhase);

    // --- body vibration: continuous feed while rabid, ring-down otherwise ---
    if (this.rho > 0.05) this.modal.excite(4 * this.rho * dtSec);
    this.modal.update(dtSec);

    // --- mini-hop ---
    if (nowMs < this._hopUntilMs) {
      const D = 160 * (1 / (1 + 0.6 * this.rho));
      const u = clamp(1 - (this._hopUntilMs - nowMs) / D, 0, 1);
      this.hopY = this._hopH * 4 * u * (1 - u); // simple parabola, peak at u=0.5
    } else {
      this.hopY = 0;
    }

    // --- head-bob (neck angle) ---
    const dt = nowMs - this._neckStartMs;
    this.neckAngle = dt >= 0 && dt < 600
      ? this._neckAmp * Math.exp(-dt / 180) * Math.sin((2 * Math.PI * dt) / 220)
      : 0;

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

    this.beatFlash = Math.max(0, this.beatFlash - dtSec / BEAT_FLASH_DECAY_SEC);
    this._nowMs = nowMs;
    this.groundY = groundY;
    this.screenX = midio.screenX + this.xRel;
  }

  _startHop(nowMs, vel) {
    // Relaxed lope: calm sections soften the hop instead of cutting it entirely.
    this._hopH = (16 + 26 * vel) * (1 - 0.5 * this._calmLevel);
    this._hopUntilMs = nowMs + 160;
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
    const skinHex = hexLerp('#63c74d', '#e43b44', this.rho);
    const skinRgb = hexToRgb(skinHex);
    const baseHue = rgbToHsl(skinRgb.r, skinRgb.g, skinRgb.b).h;
    // Predatory weave: he stalks side to side instead of gliding on rails.
    // Render-only -- the spring physics and panic hops are untouched.
    const weave = WEAVE_PX * (1 - 0.5 * this._calmLevel) * Math.sin(this._nowMs * 0.006);
    const x = this.screenX + weave;
    const y = this.groundY - this.hopY;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(DRAW_SCALE, DRAW_SCALE);

    if (this.rho > 0.02) {
      ctx.save();
      ctx.globalAlpha = 0.38 * this.rho;
      ctx.strokeStyle = '#e8f2ff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i <= 14; i++) {
        const ang = (i / 14) * Math.PI * 2;
        const r = (i % 2 === 0 ? 30 : 21) + (this.rand() * 2 - 1) * 4; // serrated, not round
        const px = Math.cos(ang) * r, py = -16 + Math.sin(ang) * r * 0.7;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // tongue (behind head, extends forward/down)
    if (this.tongue.len > 0.5) {
      ctx.strokeStyle = 'rgba(200,228,255,0.85)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(6, -16);
      const midX = 6 + this.tongue.len * 0.55, midY = -16 + this.tongue.len * 0.10;
      const endX = 6 + this.tongue.len * Math.cos(22 * Math.PI / 180);
      const endY = -16 + this.tongue.len * Math.sin(22 * Math.PI / 180);
      ctx.lineTo(midX, midY); // an angular lash, not a soft curve
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(200,230,255,0.8)';
    for (const p of this.spittle.active) {
      ctx.fillRect(6 + p.x - 1, -16 + p.y - 1, 2.4, 2.4); // sparks, not droplets
    }
    ctx.restore(); // done with the ctx.translate-relative aura/tongue/spittle drawing

    // Body/head/jaw/eye as a low-poly wireframe (follow-up item 1): manually
    // transformed (not via ctx.rotate) so edge angle/length -- and therefore
    // hue/glow -- actually reacts to the neck-bob and jaw snap.
    const neckRad = (this.neckAngle * Math.PI) / 180;
    const group = { tx: x, ty: y, rot: neckRad, scaleX: DRAW_SCALE, scaleY: DRAW_SCALE };
    const bodyHub = BROSHI_BODY.vertices[0];
    const bodyMesh = displaceMeshRadial(BROSHI_BODY, bodyHub.x, bodyHub.y, this.modal);
    const glyphOpts = { satBase: 30, lightBase: 56, hueSpread: 20 };
    drawMeshPart(ctx, bodyMesh, this._bodyRest, group, baseHue, glyphOpts);
    drawMeshPart(ctx, BROSHI_HEAD, this._headRest, group, baseHue, glyphOpts);
    if (this.beatFlash > 0.03) {
      // Kick ignition: the whole glyph flashes additively with the beat.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawMeshPart(ctx, bodyMesh, this._bodyRest, group, baseHue, { alpha: 0.6 * this.beatFlash, satBase: 65, lightBase: 72, widthBase: 2.2 });
      ctx.restore();
    }

    const jawTip = BROSHI_JAW.vertices[1];
    const jawMesh = { vertices: [BROSHI_JAW.vertices[0], { x: jawTip.x, y: jawTip.y + this.jawOpen * 10 }], edges: BROSHI_JAW.edges };
    drawMeshPart(ctx, jawMesh, this._jawRest, group, baseHue + 15, { satBase: 22, lightBase: 62, widthBase: 1.2 });

    const tailRad = (this.tailAngle * Math.PI) / 180;
    const [tailBase, tailTip0] = BROSHI_TAIL.vertices;
    const tdx = tailTip0.x - tailBase.x, tdy = tailTip0.y - tailBase.y;
    const tailTip = {
      x: tailBase.x + tdx * Math.cos(tailRad) - tdy * Math.sin(tailRad),
      y: tailBase.y + tdx * Math.sin(tailRad) + tdy * Math.cos(tailRad),
    };
    const tailMesh = { vertices: [tailBase, tailTip], edges: BROSHI_TAIL.edges };
    drawMeshPart(ctx, tailMesh, this._tailRest, group, baseHue - 10, { satBase: 24, lightBase: 48, widthBase: 1.2 });

    const eyeLit = this.rho > 0.3;
    drawMeshPart(ctx, BROSHI_EYE, this._eyeRest, group, eyeLit ? 0 : baseHue, {
      satBase: eyeLit ? 20 : 30, lightBase: eyeLit ? 80 : 15, alpha: eyeLit ? 0.5 + 0.4 * this.rho : 0.9,
    });

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(DRAW_SCALE, DRAW_SCALE);
    for (const d of this.drool.active) {
      ctx.fillStyle = 'rgba(150,220,255,0.7)';
      ctx.beginPath();
      ctx.arc(12, -16 + d.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
