// The ensemble as physics: the three characters are a trio of Kuramoto
// oscillators whose coupling constant is set by the music's vibe. Each
// character carries a phase (driving their bob/stomp/pulse timing) and a
// roam anchor wandering the stage. What the audience reads as "chemistry"
// is the honest dynamics of the critical coupling boundary:
//   happy + epic  -> K well above critical: they phase-lock and gather --
//                    three bodies moving as one instrument
//   sad           -> K near zero and the formation spreads: they drift
//                    apart across the whole stage, each in their own time
//   neutral/trivial -> K just below critical: they genuinely TRY to sync,
//                    almost lock, slip, clash, and drift -- the Kuramoto
//                    slip cycle, not a script
import { mulberry32, clamp, clamp01, lerp } from '../utils/math.js';
import { curl2 } from '../utils/fields.js';

const TWO_PI = Math.PI * 2;
// Distinct natural detunes (rad/s) so slip is visible and non-uniform.
// std ~ 0.64 -> critical coupling ~ 1.3 for this trio.
const DETUNES = [0.5, -0.72, 0.9];
const R_TAU = 1.5;
const SPREAD_TAU = 2.8;   // formation changes drift, never snap
const CENTROID_SPEED = 0.041; // rad/s of the roam ellipse -- slow

export class EnsembleDirector {
  constructor(seed = 1, { stageW = 1280, stageH = 720 } = {}) {
    const rand = mulberry32((seed ^ 0x3a7e) >>> 0 || 1);
    this.w = stageW;
    this.h = stageH;
    this.theta = [rand() * TWO_PI, rand() * TWO_PI, rand() * TWO_PI];
    this.r = 0;
    this.rSmooth = 0.5;
    this.spread = 220;
    this.K = 1;
    this._phi = rand() * TWO_PI;
    this._t = 0;
    this.anchors = [{ x: stageW * 0.26, y: 0 }, { x: stageW * 0.15, y: 0 }, { x: stageW * 0.4, y: stageH * 0.35 }];
  }

  update(nowMs, dtSec, vibe, beatPeriodMs = 500) {
    this._t += dtSec;
    const omega0 = TWO_PI / Math.max(0.25, (beatPeriodMs || 500) / 1000);

    // Coupling from vibe: mood gates it, drive deepens it.
    const mood = clamp01(0.5 + 0.5 * vibe.valence);
    const drive = clamp01(vibe.epic);
    this.K = 0.15 + 2.9 * Math.pow(mood, 1.3) * (0.3 + 0.7 * drive);

    // Kuramoto, N=3, direct mean field.
    let sc = 0, ss = 0;
    for (const th of this.theta) { sc += Math.cos(th); ss += Math.sin(th); }
    const R = Math.hypot(sc, ss) / 3;
    const psi = Math.atan2(ss, sc);
    for (let i = 0; i < 3; i++) {
      this.theta[i] += (omega0 + DETUNES[i] + this.K * R * Math.sin(psi - this.theta[i])) * dtSec;
      if (this.theta[i] > TWO_PI) this.theta[i] -= TWO_PI;
      else if (this.theta[i] < 0) this.theta[i] += TWO_PI;
    }
    this.r = R;
    this.rSmooth += (1 - Math.exp(-dtSec / R_TAU)) * (R - this.rSmooth);

    // Formation: desync and sadness both push them apart.
    const sadness = clamp01(-vibe.valence);
    const spreadTarget = lerp(150, 540, clamp01(0.7 * (1 - this.rSmooth) + 0.5 * sadness));
    this.spread += (1 - Math.exp(-dtSec / SPREAD_TAU)) * (spreadTarget - this.spread);

    // The formation's centroid roams the stage on a slow ellipse + curl drift.
    const flow = curl2(this._t * 0.05, 1.7, this._t * 0.03);
    const cx = this.w * (0.34 + 0.16 * Math.sin(this._t * CENTROID_SPEED * TWO_PI + this._phi) + 0.05 * clamp(flow.x, -1, 1));
    const formAng = this._t * 0.021 * TWO_PI * 0.3;

    // Per-character anchors on a slowly rotating triangle, each with its
    // own curl wander so nobody rides rails.
    for (let i = 0; i < 3; i++) {
      const ang = formAng + (i * TWO_PI) / 3;
      const wob = curl2(this._t * 0.04 + i * 9.1, i * 3.7, this._t * 0.026);
      this.anchors[i].x = cx + Math.cos(ang) * this.spread * 0.5 + clamp(wob.x, -1, 1) * 34;
      this.anchors[i].y = clamp(wob.y, -1, 1) * 26; // consumers add their own base heights
    }
    // Stage-safety clamps per character role.
    this.anchors[0].x = clamp(this.anchors[0].x, this.w * 0.12, this.w * 0.62); // Midio: gameplay window
    this.anchors[1].x = clamp(this.anchors[1].x, this.w * 0.06, this.w * 0.85); // Broshi: full floor
    this.anchors[2].x = clamp(this.anchors[2].x, this.w * 0.15, this.w * 0.88); // Midasus: full sky
    this.anchors[2].y = this.h * 0.33 - this.spread * 0.10 + this.anchors[2].y * 2;
  }

  phase(i) { return this.theta[i]; }
}
