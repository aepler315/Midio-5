// Computes a single "calm level" signal from global track energy (follow-up
// item 3): C=1 is fully relaxed, C=0 is fully energetic. Every consumer
// (Midio's idle behavior, Midasus's orbit, Broshi's lope, the world's
// ambient dressing) reads this same value and applies its own calm-vs-
// energetic vocabulary -- this class only ever produces the signal.
import { smoothstep } from '../utils/math.js';
import { FLAT_WEIGHTS } from '../audio/bands.js';

const G_EMA_TAU = 0.4;
const CALM_LOW = 0.25, CALM_HIGH = 0.55;

export class CalmDirector {
  constructor() {
    this.G = 0;
    this.level = 1;
  }

  update(nowMs, dtSec, energyCurves) {
    // Song-relative (EnergyCurves.globalEnergyNorm): CALM_LOW/CALM_HIGH now
    // mean "the quiet tenth / the loud tenth OF THIS SONG", so a quiet record
    // still reaches its own energetic sections and a loud one still relaxes.
    const gInstant = energyCurves ? energyCurves.globalEnergyNorm(nowMs, FLAT_WEIGHTS) : 0;
    const alpha = 1 - Math.exp(-dtSec / G_EMA_TAU);
    this.G += alpha * (gInstant - this.G);
    this.level = 1 - smoothstep(CALM_LOW, CALM_HIGH, this.G);
  }
}
