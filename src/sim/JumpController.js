// The three-phase apex jump curve (spec §2.1) — launch (quadratic ease-out),
// apex hang (sin^2 wobble, C1-continuous into/out of the hang), fall
// (quadratic ease-in, accelerating/heavy). Kick-quantized takeoffs with
// mid-air retargeting so a new kick always lands Midio back on the grid.
import { clamp } from '../utils/math.js';

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
const RETARGET_FALL_MS = 120;
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
    this.lastLaunchVel = 0.7; // velocity of the kick that started the current/most recent jump

    this.lastKickMs = null;
    this.beatPeriodMs = 500;
    this.kickCount = 0;

    this.compress = null;      // {startMs, fromY, dur} — mid-air retarget in progress
    this._pendingLaunch = null;

    /** Set for exactly one sim step on landing; consumed by ComboSystem/ImpactFX. */
    this.pendingLanding = null;
    /** Set for one step when a kick is skipped (half-time) — routes to landing FX instead. */
    this.pendingGhostKick = null;
  }

  get bpm() { return 60000 / this.beatPeriodMs; }

  /**
   * @param evt the RHYTHM/kick NoteEvent (evt.tMs is the exact musical
   *   onset; the dispatcher may not reach it until up to one sim step
   *   later)
   */
  onKick(evt) {
    // Everything below is anchored to evt.tMs, the exact onset time — NOT
    // the caller's discretized "now". Kick-quantized jumps land almost
    // exactly when the next kick arrives, so the gap between a kick's true
    // time and the ~8ms-later instant the fixed-step sim actually gets to
    // process it is not noise to ignore: feeding that jitter into the
    // beat-period EMA compounds a slowly-growing phase error into D every
    // cycle, and resolving state against the wrong instant can leave a
    // kick seeing stale AIR state and silently dropping its launch.
    const tMs = evt.tMs;
    this.update(tMs); // resolve any landing/compress transition due by tMs first
    this._updateBeatPeriod(tMs);
    this.kickCount++;
    if (this.bpm > HIGH_BPM_HALFTIME && this.kickCount % 2 === 0) {
      this.pendingGhostKick = { vel: evt.vel };
      return;
    }
    this._launchOrRetarget(evt, tMs);
  }

  /** Player-driven mode: kicks no longer launch jumps, but the inter-kick
   * EMA must keep flowing — it drives jump duration, the combo grace/break
   * windows, and the ensemble/strut timing. This is onKick minus the launch. */
  noteKickTiming(tMs) {
    this._updateBeatPeriod(tMs);
  }

  /** Forget the last kick so the next one sets no interval. Called after a
   * span of kicks was deliberately withheld from the EMA (a double-bass
   * roll): without this, the first kick after the span would feed the whole
   * gap in as one giant "beat". */
  resetKickBaseline() {
    this.lastKickMs = null;
  }

  /**
   * A player press. Same anchoring discipline as onKick (judge/launch at the
   * press's own DOM-captured audio-clock time, not the sim step that drains
   * it), same launch/retarget rules — but no EMA write (the beat period
   * stays chart-driven) and no halftime ghosting (a human already taps at
   * whatever rate a human can).
   * @param evt {{tMs:number, vel:number}} vel inherited from the matched
   *   kick when the press hit a chart note, or a neutral default when not.
   */
  onPlayerTap(evt) {
    const tMs = evt.tMs;
    this.update(tMs); // resolve any landing/compress transition due by tMs first
    this._launchOrRetarget(evt, tMs);
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

  _launchOrRetarget(evt, nowMs) {
    const H = this.hBase * (0.6 + 0.8 * evt.vel) * this.P.live.jumpHeight;
    const D = clamp(1.0 * this.beatPeriodMs, D_MIN, D_MAX);

    if (this.state === 'GROUND') {
      this.lastLaunchVel = evt.vel;
      this._launch(nowMs, H, D);
      return;
    }

    const u = (nowMs - this.jumpStartMs) / this.D;
    if (u >= A + B) {
      const r = (u - A - B) / GAMMA;
      if (r < 0.3 && !this.compress) {
        this.compress = { startMs: nowMs, fromY: this.y, dur: RETARGET_FALL_MS };
        this._pendingLaunch = { H, D, vel: evt.vel };
      }
    }
    // Mid launch/hang: ignore — already committed, avoids impossible double-jumps.
  }

  _launch(nowMs, H, D) {
    this.state = 'AIR';
    this.jumpStartMs = nowMs;
    this.H = H;
    this.D = D;
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
          const { H, D, vel } = this._pendingLaunch;
          this._pendingLaunch = null;
          this.lastLaunchVel = vel;
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
