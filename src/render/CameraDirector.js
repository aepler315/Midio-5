// Camera state: punch-zoom on landings (spec §2.2.2), pulse-zoom on bar 1,
// screen shake (spec §2.2.1). Expanded in later stages; starts as identity.
export class CameraDirector {
  constructor() {
    this.zoom = 1;
    this.targetZoom = 1;
    this.shakeX = 0;
    this.shakeY = 0;
    this.driftX = 0;
    this.driftY = 0;
    this._shakeAmp = 0;
    this._shakeT = 0;
    this._shakeSeed = Math.random() * 1000;
    this._driftT = 0;
  }

  punch(scale) {
    this.targetZoom = Math.max(this.targetZoom, scale);
  }

  shake(amplitudePx) {
    this._shakeAmp = Math.max(this._shakeAmp, amplitudePx);
    this._shakeT = 0;
  }

  update(dtSec, calm) {
    this.zoom += (this.targetZoom - this.zoom) * Math.min(1, dtSec * 10);
    this.targetZoom += (1 - this.targetZoom) * Math.min(1, dtSec * 6);

    // Calm-driven slow sinusoidal drift (±3 px, ~0.1 Hz).
    this._driftT += dtSec;
    const driftAmp = 3 * (calm ? calm.C : 1);
    this.driftX = driftAmp * Math.sin(2 * Math.PI * 0.10 * this._driftT);
    this.driftY = driftAmp * Math.cos(2 * Math.PI * 0.11 * this._driftT);

    if (this._shakeAmp > 0.01) {
      this._shakeT += dtSec;
      const decay = Math.exp(-this._shakeT / 0.07);
      const amp = this._shakeAmp * decay;
      // 2-octave value-noise direction, not pure sine (spec §2.2.1) — cheap approximation via
      // summed incommensurate sines seeded per-shake so it never reads as jello.
      const t = this._shakeT * 1000;
      this.shakeX = amp * (Math.sin(t * 0.031 + this._shakeSeed) * 0.6 + Math.sin(t * 0.077 + this._shakeSeed * 1.7) * 0.4);
      this.shakeY = amp * (Math.sin(t * 0.043 + this._shakeSeed * 2.3) * 0.6 + Math.sin(t * 0.091 + this._shakeSeed * 0.5) * 0.4);
      this._shakeAmp = amp < 0.05 ? 0 : this._shakeAmp;
    } else {
      this.shakeX = 0; this.shakeY = 0;
    }
  }
}
