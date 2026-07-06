// Look-ahead telegraphing / proximity posture (spec §2.2.3). Computes
// anticipation phase a(t) and a ground-line glint that sweeps toward upcoming
// obstacles. Pose squash/stretch is composed by MidioPerformer from this.a.
import { Role } from '../core/NoteEvent.js';
import { clamp } from '../utils/math.js';

const T_LOOK = 600; // ms

export class TelegraphScanner {
  constructor() {
    this.a = 0;
    this._lastMs = 0;
    this.glintActive = false;
    this.glintScreenX = 0;
  }

  update(nowMs, conductor, midio, jump, impactFX, worldX, groundY, obstacles) {
    const dtSec = Math.max(0, (nowMs - this._lastMs) / 1000);
    this._lastMs = nowMs;

    const window = conductor.peekWindow(nowMs, T_LOOK);
    let nearestKick = null;
    for (const evt of window) {
      if (evt.role === Role.RHYTHM && evt.kick) { nearestKick = evt; break; }
    }
    const a = nearestKick ? clamp(1 - (nearestKick.tMs - nowMs) / T_LOOK, 0, 1) : 0;
    this.a = a;

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