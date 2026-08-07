// Camera state: screen shake + a damped impact roll (spec §2.2.1). Zoom has
// been removed from the game, so this no longer holds any zoom/punch state --
// the Renderer applies a fixed framing and only reads shake/roll from here.

// Shake was dialed up for a "ferocity" pass (gain 2×, long ring, hard roll).
// That reads as seasick on long songs -- pull it back so impacts still
// register without thrashing the frame. Reduced-motion halves it further.
const SHAKE_GAIN = 0.85;
const SHAKE_DECAY_TAU = 0.07; // seconds -- short ring, doesn't hang
const ROLL_COUPLING = 0.0007; // rotational kick per (gained) px of shake

// Calm-section drift (see update()): a genuinely wide, slow pan rather than
// a scaled-down version of impact shake. The original 3px/10s drift was
// imperceptible -- this is sized to actually read as the camera sweeping
// across the frame during a relaxed stretch, exported so the test can pin
// the bound without hardcoding it twice.
export const CALM_DRIFT_AMP_PX = 26;
export const CALM_DRIFT_PERIOD_SEC = 15; // one full lazy sweep

export class CameraDirector {
  constructor() {
    this.shakeX = 0;
    this.shakeY = 0;
    this._shakeAmp = 0;
    this._shakeT = 0;
    this._shakeSeed = Math.random() * 1000;

    this.roll = 0; // radians, applied around screen center by the Renderer
    this._rollAmp = 0;
    this._rollT = 0;
    this._rollSign = 1;
  }

  shake(amplitudePx) {
    const amp = amplitudePx * SHAKE_GAIN;
    this._shakeAmp = Math.max(this._shakeAmp, amp);
    this._shakeT = 0;
    // Impacts also kick a damped rotational oscillation -- a roll (now up to
    // a couple of degrees on the big hits) that alternates direction hit to hit.
    this._rollAmp = Math.max(this._rollAmp, amp * ROLL_COUPLING);
    this._rollT = 0;
    this._rollSign = -this._rollSign;
  }

  update(dtSec, calmLevel = 0, reducedMotion = false) {
    // Reduced-motion keeps the harder shake comfortable: half amplitude on
    // both the translational shake and the rotational roll.
    const motionMul = reducedMotion ? 0.5 : 1;
    let shakeX = 0, shakeY = 0;
    if (this._shakeAmp > 0.01) {
      this._shakeT += dtSec;
      const decay = Math.exp(-this._shakeT / SHAKE_DECAY_TAU);
      const amp = this._shakeAmp * decay;
      // 2-octave value-noise direction, not pure sine (spec §2.2.1) — cheap approximation via
      // summed incommensurate sines seeded per-shake so it never reads as jello.
      const t = this._shakeT * 1000;
      shakeX = amp * (Math.sin(t * 0.031 + this._shakeSeed) * 0.6 + Math.sin(t * 0.077 + this._shakeSeed * 1.7) * 0.4);
      shakeY = amp * (Math.sin(t * 0.043 + this._shakeSeed * 2.3) * 0.6 + Math.sin(t * 0.091 + this._shakeSeed * 0.5) * 0.4);
      this._shakeAmp = amp < 0.05 ? 0 : this._shakeAmp;
    }

    // Damped 6.5 Hz roll ring-down from the last impact.
    if (this._rollAmp > 1e-4) {
      this._rollT += dtSec;
      const env = Math.exp(-this._rollT / 0.22);
      this.roll = motionMul * this._rollSign * this._rollAmp * env * Math.sin(2 * Math.PI * 6.5 * this._rollT);
      if (env < 0.02) this._rollAmp = 0;
    } else {
      this.roll = 0;
    }

    // Calm sections: a wide, slow sweeping pan layered on top of impact
    // shake (additive, so a landing during a calm stretch still reads
    // correctly) -- a genuine long-range drift across the frame, not a
    // scaled-down shake, so a relaxed section reads as sweeping rather than
    // just "the same motion, smaller." Horizontal leads (fuller amplitude,
    // matching how a side-scroller camera actually pans); vertical trails
    // at a slower, smaller sub-sweep so the path traces a lazy ellipse
    // rather than a tight circle.
    this._driftT = (this._driftT || 0) + dtSec;
    const driftOmega = 2 * Math.PI / CALM_DRIFT_PERIOD_SEC;
    const driftAmp = CALM_DRIFT_AMP_PX * calmLevel;
    const driftX = driftAmp * Math.sin(driftOmega * this._driftT);
    const driftY = driftAmp * 0.55 * Math.sin(driftOmega * this._driftT * 0.7 + 1.3);

    this.shakeX = shakeX * motionMul + driftX;
    this.shakeY = shakeY * motionMul + driftY;
  }
}
