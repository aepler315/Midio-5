// Global "calm level" C(t) = 1 − smoothstep(0.25, 0.55, G) (item 3).
// G is a slow EMA over the global track energy. C near 1 means quiet/relaxed
// sections; C near 0 means loud/intense sections. Pure logic, testable.
import { smoothstep } from '../utils/math.js';

const TAU_SEC = 1.5; // slow EMA so calm doesn't flicker with transients

export class CalmDirector {
  constructor({ tau = TAU_SEC } = {}) {
    this.tau = tau;
    this.G = 0;
    this.C = 1; // start calm
  }

  update(nowMs, dtSec, energyCurves) {
    const gInstant = energyCurves ? energyCurves.globalEnergy(nowMs) : 0;
    const alpha = 1 - Math.exp(-dtSec / this.tau);
    this.G += alpha * (gInstant - this.G);
    this.C = 1 - smoothstep(0.25, 0.55, this.G);
  }
}
