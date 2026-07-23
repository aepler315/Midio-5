// Camera state: screen shake + a damped impact roll (spec §2.2.1). Zoom has
// been removed from the game, so this no longer holds any zoom/punch state --
// the Renderer applies a fixed framing and only reads shake/roll from here.
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
    this._shakeAmp = Math.max(this._shakeAmp, amplitudePx);
    this._shakeT = 0;
    // Impacts also kick a damped rotational oscillation -- a subtle roll
    // (fractions of a degree) that alternates direction hit to hit.
    this._rollAmp = Math.max(this._rollAmp, amplitudePx * 0.0011);
    this._rollT = 0;
    this._rollSign = -this._rollSign;
  }

  update(dtSec, calmLevel = 0) {
    let shakeX = 0, shakeY = 0;
    if (this._shakeAmp > 0.01) {
      this._shakeT += dtSec;
      const decay = Math.exp(-this._shakeT / 0.07);
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
      this.roll = this._rollSign * this._rollAmp * env * Math.sin(2 * Math.PI * 6.5 * this._rollT);
      if (env < 0.02) this._rollAmp = 0;
    } else {
      this.roll = 0;
    }

    // Calm sections (follow-up item 3): a slow drift layered on top of
    // impact shake (additive, so a landing during a calm stretch still
    // reads correctly) -- keeps the frame from ever feeling frozen.
    this._driftT = (this._driftT || 0) + dtSec;
    const driftAmp = 3 * calmLevel;
    const driftX = driftAmp * Math.sin(2 * Math.PI * 0.1 * this._driftT);
    const driftY = driftAmp * Math.sin(2 * Math.PI * 0.1 * this._driftT * 0.7 + 1.3);

    this.shakeX = shakeX + driftX;
    this.shakeY = shakeY + driftY;
  }
}
