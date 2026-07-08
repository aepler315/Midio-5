// The clip-factor system: detects the musical moments a spectator would
// clip and makes the whole frame answer them. Two EMAs of global energy --
// a fast one (attack) and a slow one (context) -- and when the fast one
// tears away from the slow one after a quieter stretch, that's a DROP:
// fire a full-screen shockwave from Midio, surge every phenomena system,
// and echo the frame. Between drops, a thin border frame breathes with
// the track and slams on every kick, so even a zoomed-out or distant view
// reads instantly as "this screen is running on the music."
import { clamp01 } from '../utils/math.js';
import { FLAT_WEIGHTS } from '../audio/bands.js';

const FAST_TAU = 0.15, SLOW_TAU = 2.5;
const DROP_DELTA = 0.26;      // fast must exceed slow by this much...
const DROP_QUIET_CEIL = 0.5;  // ...while the slow context is still this quiet
const DROP_COOLDOWN_MS = 6000;
const SURGE_DECAY_SEC = 2.2;
const SLAM_DECAY_SEC = 0.22;
const RING_MS = 900;

export class HypeDirector {
  constructor() {
    this.fast = 0;
    this.slow = 0;
    this.surge = 0;        // 0..1, decaying after a drop
    this.slam = 0;         // kick-driven border pulse
    this.dropAtMs = -Infinity;
    this._cooldownUntilMs = 0;
    this.dropCount = 0;
  }

  onKick(vel = 0.8) {
    this.slam = Math.max(this.slam, 0.35 + 0.65 * vel);
  }

  update(nowMs, dtSec, energyCurves) {
    const e = energyCurves ? clamp01(energyCurves.globalEnergy(nowMs, FLAT_WEIGHTS)) : 0.3;
    this.fast += (1 - Math.exp(-dtSec / FAST_TAU)) * (e - this.fast);
    this.slow += (1 - Math.exp(-dtSec / SLOW_TAU)) * (e - this.slow);

    if (
      nowMs >= this._cooldownUntilMs &&
      this.slow < DROP_QUIET_CEIL &&
      this.fast - this.slow > DROP_DELTA
    ) {
      this.dropAtMs = nowMs;
      this._cooldownUntilMs = nowMs + DROP_COOLDOWN_MS;
      this.surge = 1;
      this.dropCount++;
    }

    this.surge = Math.max(0, this.surge - dtSec / SURGE_DECAY_SEC);
    this.slam = Math.max(0, this.slam - dtSec / SLAM_DECAY_SEC);
  }

  /** Shockwave ring progress in [0,1), or null once the ring has passed. */
  ringU(nowMs) {
    const age = nowMs - this.dropAtMs;
    return age >= 0 && age < RING_MS ? age / RING_MS : null;
  }
}
