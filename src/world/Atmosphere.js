// The Wind (Movement II): every particle system used to drift in its own
// private noise. A single global weather field unifies the whole frame's
// motion instead -- one slow curl-noise gust plus a smaller positional
// detail term. Callers sample W(x,y) once per system per frame (not per
// particle) and apply the returned px/s vector to their own particles.
import { curl2 } from '../utils/fields.js';
import { clamp01 } from '../utils/math.js';

const ENERGY_TAU_SEC = 3; // gusts build and fade over seconds, not beats
const GLOBAL_SCALE = 0.00028; // very low spatial frequency: one weather system spans the whole stage
const DETAIL_SCALE = 0.0022;
const DETAIL_WEIGHT = 0.35;
const BASE_GUST_PX_S = 46;

export class Atmosphere {
  constructor(seed = 0) {
    this._ox = (seed % 997) * 3.7;
    this._oz = (seed % 991) * 1.9 + 250;
    this.energyEMA = 0;
    this.turbulence = 1; // the biome personality's dial, set by the caller each frame
    this.tSec = 0;
  }

  update(dtSec, energyInstant = 0) {
    this.tSec += dtSec;
    const alpha = 1 - Math.exp(-dtSec / ENERGY_TAU_SEC);
    this.energyEMA += alpha * (clamp01(energyInstant) - this.energyEMA);
  }

  /** W(x,y,t): the wind vector (px/s) at a world position, right now. */
  at(x, y) {
    const gustMag = BASE_GUST_PX_S * (0.4 + 1.6 * this.energyEMA) * this.turbulence;
    const g = curl2(this._ox + x * GLOBAL_SCALE, this._oz + y * GLOBAL_SCALE, this.tSec * 0.05);
    const d = curl2(this._ox + 91.1 + x * DETAIL_SCALE, this._oz + y * DETAIL_SCALE, this.tSec * 0.35);
    return {
      x: (g.x + d.x * DETAIL_WEIGHT) * gustMag,
      y: (g.y + d.y * DETAIL_WEIGHT) * gustMag,
    };
  }
}
