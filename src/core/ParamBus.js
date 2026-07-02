// Single bus for every tunable global modifier (spec §0.2 rule 4, §5.2.2).
// Vision AI, debug sliders, and combo bonuses all write *targets*; the bus
// owns smoothing, deadband, rate-limiting, and clamping. No system ever
// mutates another system's constants directly.
import { clamp } from '../utils/math.js';

const KEYS = ['jumpHeight', 'obstacleDensity', 'scrollSpeed', 'eqSensitivity', 'onsetThreshold'];

export class ParamBus {
  constructor() {
    this.def = Object.fromEntries(KEYS.map((k) => [k, 1]));
    this.live = { ...this.def };
    this.target = { ...this.def };
    this.lambda = 0.04; // per-sim-step smoothing (~0.5s to 90% at 120Hz)
    this.trust = 0.5;
    this._lastSeverity = null;
    this._preApplySnapshot = null;
  }

  /** Vision (or any actuator) proposes new targets with a confidence and a trust weight. */
  propose(adj, confidence) {
    const w = clamp(confidence, 0, 1) * this.trust;
    for (const k of KEYS) {
      if (!(k in adj)) continue;
      let t = clamp(adj[k], 0.5, 1.5);
      if (Math.abs(t - 1) < 0.03) continue; // deadband +/-3%
      t = clamp(t, this.target[k] - 0.10, this.target[k] + 0.10); // rate limit +/-10%/cycle
      this.target[k] = clamp(
        this.target[k] * (1 - w) + t * w,
        0.5 * this.def[k], 1.6 * this.def[k], // absolute guardrails
      );
    }
  }

  snapshotForRevert() {
    this._preApplySnapshot = { ...this.target };
  }

  revert() {
    if (this._preApplySnapshot) this.target = { ...this._preApplySnapshot };
  }

  /** Hill-climb trust based on whether the model's own severity score improved. */
  updateTrust(severityNow) {
    if (this._lastSeverity !== null) {
      const delta = severityNow - this._lastSeverity;
      if (delta < 0) this.trust = Math.min(1, this.trust + 0.10);
      else if (delta > 0) { this.trust = Math.max(0.2, this.trust - 0.25); this.revert(); }
    }
    this._lastSeverity = severityNow;
  }

  /** Called once per sim step: exponential actuator smoothing toward target. */
  step() {
    for (const k of KEYS) this.live[k] += this.lambda * (this.target[k] - this.live[k]);
  }

  reset() {
    this.live = { ...this.def };
    this.target = { ...this.def };
    this.trust = 0.5;
    this._lastSeverity = null;
  }
}

export const KEYS_LIST = KEYS;
