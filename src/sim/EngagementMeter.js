// The Perfect Illusion: real player taps no longer drive judgment or jumps
// (see Simulation.step's ghost-input cursor) -- they only drive whether the
// note-highway presentation is showing at all. `level` is 1 while the
// player has tapped recently, easing to 0 once they stop, so the whole
// rhythm layer reads as optional: tap and it lights up, stop and it fades
// away while Midio quietly keeps performing the song underneath.
import { clamp01 } from '../utils/math.js';

const ENGAGED_WINDOW_MS = 3000; // how long a single tap keeps the layer "on"
const FADE_IN_TAU_SEC = 0.15;   // snappy: a tap should feel instantly responsive
const FADE_OUT_TAU_SEC = 0.8;   // gentle: idling out shouldn't feel like a hard cutoff

export class EngagementMeter {
  constructor() {
    this.level = 0;
    // Starts at 0 (not -Infinity) so the layer is visible for the first
    // ENGAGED_WINDOW_MS of a song even with no taps yet -- an untouched
    // song still opens with the invitation to play before fading.
    this.lastTapMs = 0;
  }

  onTap(tMs) {
    if (tMs > this.lastTapMs) this.lastTapMs = tMs;
  }

  update(nowMs, dtSec) {
    const target = nowMs - this.lastTapMs < ENGAGED_WINDOW_MS ? 1 : 0;
    const tau = target > this.level ? FADE_IN_TAU_SEC : FADE_OUT_TAU_SEC;
    this.level += (1 - Math.exp(-dtSec / tau)) * (target - this.level);
    this.level = clamp01(this.level);
  }
}
