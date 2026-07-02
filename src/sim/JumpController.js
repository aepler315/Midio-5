// The three-phase apex jump curve (spec §2.1) — launch (quadratic ease-out),
// apex hang (sin^2 wobble, C1-continuous into/out of the hang), fall
// (quadratic ease-in, accelerating/heavy). Kick-quantized takeoffs with
// mid-air retargeting so a new kick always lands Midio back on the grid.
import { clamp } from '../utils/math.js';
import * as JumpPlanner from './JumpPlanner.js';

export const A = 0.35;   // LAUNCH fraction
export const B = 0.30;   // APEX HANG fraction
export const GAMMA = 0.35; // FALL fraction
export const W = 0.08;   // apex headroom fraction

export function jumpY(u, H) {
  const Ha = (1 - W) * H;
  if (u < A) {
    const p = u / A;
    return Ha * (1 - (1 - p) * (1 - p));
  }
  if (u < A + B) {
    const q = (u - A) / B;
    const s = Math.sin(Math.PI * q);
    return Ha + W * H * s * s;
  }
  const r = clamp((u - A - B) / GAMMA, 0, 1);
  return Ha * (1 - r * r);
}

export const H_BASE = 150; // px
export const D_MIN = 380, D_MAX = 1200; // ms
export const RETARGET_FALL_MS = 120;
const HIGH_BPM_HALFTIME = 170;

export class JumpController {
  constructor(paramBus, { hBase = H_BASE } = {}) {
    this.P = paramBus;
    this.hBase = hBase;

    this.state = 'GROUND'; // 'GROUND' | 'AIR'
    this.jumpStartMs = 0;
    this.D = 500;
    this.H = 100;
    this.y = 0; // px above ground, >=0

    this.lastKickMs = null;
    this.beatPeriodMs = 500;
    this.kickCount = 0;

    this.compress = null;      // {startMs, fromY, dur} — mid-air retarget in progress
    this._pendingLaunch = null;

    /** Velocity of the most recent launch — read by MidioPerformer for apex tricks. */
    this.lastVel = 0;

    /** Set for exactly one sim step on landing; consumed by ComboSystem/ImpactFX. */
    this.pendingLanding = null;
    /** Set for one step when a kick is skipped (half-time) — routes to landing FX instead. */
    this.pendingGhostKick = null;
  }

  get bpm() { return 60000 / this.beatPeriodMs; }

  onKick(evt, nowMs, obstacle = null) {
    this._updateBeatPeriod(nowMs);
    this.kickCount++;
    if (this.bpm > HIGH_BPM_HALFTIME && this.kickCount % 2 === 0) {
      this.pendingGhostKick = { vel: evt.vel };
      return;
    }
    this._launchOrRetarget(evt, nowMs, obstacle);
  }

  _updateBeatPeriod(nowMs) {
    if (this.lastKickMs != null) {
      const interval = nowMs - this.lastKickMs;
      if (interval > 120 && interval < 2000) {
        this.beatPeriodMs = this.beatPeriodMs * 0.7 + interval * 0.3;
      }
    }
    this.lastKickMs = nowMs;
  }

  _launchOrRetarget(evt, nowMs, obstacle = null) {
    const D = clamp(1.0 * this.beatPeriodMs, D_MIN, D_MAX);
    let H = this.hBase * (0.6 + 0.8 * evt.vel) * this.P.live.jumpHeight;

    // Accommodation (item 4): if an obstacle arrives during this arc, floor H
    // at the clearance height so the hang plateau clears it. Capped by the
    // jumpHeight guardrail; if even the cap can't clear it, the collision is
    // the rare, legible "vision loop compressed the arc" case the spec allows.
    if (obstacle && obstacle.tMs > nowMs && obstacle.tMs <= nowMs + D) {
      const effH = obstacle.effHeight ?? obstacle.height; // effHeight set by stage-5 ground delta
      const reqH = JumpPlanner.minClearanceH(effH);
      const cap = H_BASE * 1.4 * this.P.live.jumpHeight;
      H = Math.min(cap, Math.max(H, reqH));
    }

    if (this.state === 'GROUND') {
      this._launch(nowMs, H, D, evt.vel);
      return;
    }

    const u = (nowMs - this.jumpStartMs) / this.D;
    if (u >= A + B) {
      const r = (u - A - B) / GAMMA;
      if (r < 0.3 && !this.compress) {
        this.compress = { startMs: nowMs, fromY: this.y, dur: RETARGET_FALL_MS };
        this._pendingLaunch = { H, D };
      }
    }
    // Mid launch/hang: ignore — already committed, avoids impossible double-jumps.
  }

  _launch(nowMs, H, D, vel = 0) {
    this.state = 'AIR';
    this.jumpStartMs = nowMs;
    this.H = H;
    this.D = D;
    this.lastVel = vel;
    this.compress = null;
  }

  /** Clear one-shot per-step event flags. Call at the START of each sim step,
   * before Conductor dispatch, so listeners downstream can observe this
   * step's landing/ghost-kick events after update() runs. */
  clearFrameFlags() {
    this.pendingLanding = null;
    this.pendingGhostKick = null;
  }

  update(nowMs) {
    if (this.compress) {
      const t = nowMs - this.compress.startMs;
      const r = clamp(t / this.compress.dur, 0, 1);
      this.y = this.compress.fromY * (1 - r * r);
      if (r >= 1) {
        const vLand = (2 * this.compress.fromY) / this.compress.dur;
        this._land(vLand);
        this.compress = null;
        if (this._pendingLaunch) {
          const { H, D } = this._pendingLaunch;
          this._pendingLaunch = null;
          this._launch(nowMs, H, D);
        }
      }
      return;
    }

    if (this.state === 'AIR') {
      const u = (nowMs - this.jumpStartMs) / this.D;
      if (u >= 1) {
        const Ha = (1 - W) * this.H;
        const vLand = (2 * Ha) / (GAMMA * this.D);
        this._land(vLand);
      } else {
        this.y = jumpY(u, this.H);
      }
    }
  }

  _land(vLandPxMs) {
    this.state = 'GROUND';
    this.y = 0;
    this.pendingLanding = { vLandPxMs };
  }

  get airborne() { return this.state === 'AIR'; }
}
