// Look-ahead telegraphing / proximity posture (spec §2.2.3). Squash-and-stretch
// driven by anticipation phase a(t), snap-to-stretch on launch with a damped
// spring relax, and a ground-line glint that sweeps toward upcoming obstacles.
import { Role } from '../core/NoteEvent.js';
import { clamp } from '../utils/math.js';

const T_LOOK = 600; // ms

export class TelegraphScanner {
  constructor() {
    this.a = 0;
    this._wasAirborne = false;
    this._stretchStartMs = -Infinity;
    this._scaleYVel = 0;
    this._lastMs = 0;
    this.glintActive = false;
    this.glintScreenX = 0;
    this._chartIdx = 0; // monotonic cursor into noteChart.notes (playback is seek-free)
  }

  update(nowMs, conductor, midio, jump, impactFX, worldX, groundY, obstacles, noteChart = null) {
    const dtSec = Math.max(0, (nowMs - this._lastMs) / 1000);
    this._lastMs = nowMs;

    // With a chart, the crouch telegraphs the next *judgeable* onset — a tap
    // or a hold start — which is exactly the "press now" cue the player
    // needs; a hold's interior ticks no longer crouch him (the slide owns
    // the pose there). Without one, legacy behavior: the next raw kick.
    let nextOnsetMs = null;
    if (noteChart) {
      const notes = noteChart.notes;
      while (this._chartIdx < notes.length && notes[this._chartIdx].tMs < nowMs) this._chartIdx++;
      const n = notes[this._chartIdx];
      if (n && n.tMs - nowMs <= T_LOOK) nextOnsetMs = n.tMs;
    } else {
      const window = conductor.peekWindow(nowMs, T_LOOK);
      for (const evt of window) {
        if (evt.role === Role.RHYTHM && evt.kick) { nextOnsetMs = evt.tMs; break; }
      }
    }
    const a = nextOnsetMs !== null ? clamp(1 - (nextOnsetMs - nowMs) / T_LOOK, 0, 1) : 0;
    this.a = a;

    const justLaunched = !this._wasAirborne && jump.airborne;
    if (justLaunched) this._stretchStartMs = nowMs;
    this._wasAirborne = jump.airborne;

    if (jump.airborne && nowMs - this._stretchStartMs < 70) {
      midio.scaleY = 1.30;
      midio.scaleX = 0.80;
      this._scaleYVel = 0;
    } else if (!jump.airborne && a > 0) {
      const scaleY = 1 - 0.22 * a * a * a;
      midio.scaleY = scaleY;
      midio.scaleX = 1 / scaleY;
      this._scaleYVel = 0;
    } else {
      // 5 Hz damped spring relax toward neutral (scaleY=1, scaleX=1/scaleY).
      const omega = 2 * Math.PI * 5, zeta = 0.55;
      const accel = omega * omega * (1 - midio.scaleY) - 2 * zeta * omega * this._scaleYVel;
      this._scaleYVel += accel * dtSec;
      midio.scaleY += this._scaleYVel * dtSec;
      midio.scaleX = 1 / midio.scaleY;
    }

    midio.leanDeg = 6 * a;

    if (a > 0.8 && !jump.airborne) impactFX.sputter(worldX, groundY, dtSec);

    // Ground-line glint sweeping toward the nearest upcoming obstacle, timed
    // to arrive exactly when the obstacle does (spec §2.2.3).
    this.glintActive = false;
    if (obstacles) {
      const obs = obstacles.nearestAhead(worldX);
      if (obs && obs.tMs - nowMs <= T_LOOK && obs.tMs - nowMs >= 0) {
        const aObs = clamp(1 - (obs.tMs - nowMs) / T_LOOK, 0, 1);
        const obsScreenX = obs.wx - worldX + midio.screenX;
        this.glintScreenX = midio.screenX + (obsScreenX - midio.screenX) * aObs;
        this.glintActive = true;
      }
    }
  }

  draw(ctx, groundY) {
    if (!this.glintActive) return;
    ctx.save();
    const g = ctx.createRadialGradient(this.glintScreenX, groundY, 0, this.glintScreenX, groundY, 18);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(this.glintScreenX, groundY, 18, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
