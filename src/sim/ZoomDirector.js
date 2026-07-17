// The Lens: the player's real-time control over how close to lean into the
// world. Zoom is deliberately slow (EASE_TAU_SEC) so a wheel flick or a
// Space toggle never reads as input lag -- by the time the ease catches up,
// any latency in the input pipeline is long since invisible.
//
// World-adaptation auto-return: any lean the player takes eases back to the
// neutral overview a couple of seconds after they stop, and the world
// itself performs that return rather than just snapping the camera --
// see `adaptEnv`/`adaptDir` below, consumed by BiomeManager/GroundField.
import { clamp, smoothstep } from '../utils/math.js';

export const ZOOM_MIN = 0.85;
export const ZOOM_MAX = 2.4;
export const ZOOM_NEUTRAL = 1; // the resting position: neither leaning in nor pulling back
const EASE_TAU_SEC = 0.7;

const ADAPT_IDLE_MS = 2000;      // dwell after the last input before the world starts adapting back
const ADAPT_DURATION_MS = 6500;  // the morph itself, once it starts (idle + morph lands in the 5-10s ask)
const ADAPT_EPS = 0.02;          // close enough to neutral to skip adapting at all

/** Pure: the zoom-target delta a pinch gesture should apply this frame,
 *  from the previous and current two-finger distance (px). Fingers
 *  spreading (currDist > prevDist) zooms in; pinching together zooms out.
 *  `rate` converts px of spread into zoom units, same role as
 *  WHEEL_ZOOM_RATE in main.js. */
export function pinchZoomDelta(prevDist, currDist, rate) {
  if (!(prevDist > 0) || !(currDist > 0)) return 0;
  return (currDist - prevDist) * rate;
}

export class ZoomDirector {
  constructor() {
    this.value = ZOOM_NEUTRAL;
    this.target = ZOOM_NEUTRAL;

    this._nowMs = 0;
    this._lastInputMs = -Infinity;
    this._adapting = false;
    this._adaptArmed = false;   // idle long enough, waiting for the next bar to actually start
    this._adaptFrom = ZOOM_NEUTRAL;
    this._adaptStartMs = 0;

    /** 0 outside an adaptation, rises and falls across it (peaks mid-morph)
     *  -- "how hard the world is currently reorganizing itself". */
    this.adaptEnv = 0;
    /** +1 while returning from a lean-IN (zoomed in > neutral), -1 while
     *  returning from a lean-OUT (zoomed out < neutral), 0 when idle. */
    this.adaptDir = 0;
    this.adaptJustStarted = false;
  }

  /** Continuous input (wheel delta, held-key rate) -- adjusts the target,
   *  not the eased value, so input always feels immediate to register but
   *  slow to arrive. Cancels any in-flight/pending world-adaptation. */
  nudge(delta) {
    this.target = clamp(this.target + delta, ZOOM_MIN, ZOOM_MAX);
    this._lastInputMs = this._nowMs;
    this._cancelAdapt();
  }

  /** Space/click: snap the TARGET fully in, or back to neutral -- the
   *  resting position, not the far zoomed-out end (that's reachable only
   *  by deliberate wheel/pinch/arrow-key input, never a single tap). */
  toggle() {
    const mid = (ZOOM_NEUTRAL + ZOOM_MAX) / 2;
    this.target = this.target > mid ? ZOOM_NEUTRAL : ZOOM_MAX;
    this._lastInputMs = this._nowMs;
    this._cancelAdapt();
  }

  _cancelAdapt() {
    this._adapting = false;
    this._adaptArmed = false;
    this.adaptEnv = 0;
    this.adaptDir = 0;
  }

  /** @param nextBarMs the next bar downbeat at/after `nowMs` (from
   *   PhraseTracker's bar grid), or null for bar-less audio -- the
   *   adaptation still fires, just without waiting for a beat to start on. */
  update(nowMs, dtSec, nextBarMs = null) {
    this._nowMs = nowMs;
    this.adaptJustStarted = false;

    const idleMs = nowMs - this._lastInputMs;
    const offNeutral = Math.abs(this.target - ZOOM_NEUTRAL) > ADAPT_EPS;

    if (!this._adapting && !this._adaptArmed && offNeutral && idleMs >= ADAPT_IDLE_MS) {
      this._adaptArmed = true;
    }
    if (this._adaptArmed && !this._adapting) {
      // Wait for the next downbeat so the world's own shift starts ON the
      // beat -- a performed choice, not an automatic timeout.
      if (nextBarMs == null || nowMs >= nextBarMs) {
        this._adapting = true;
        this._adaptArmed = false;
        this._adaptFrom = this.target;
        this._adaptStartMs = nowMs;
        this.adaptDir = Math.sign(this._adaptFrom - ZOOM_NEUTRAL) || 0;
        this.adaptJustStarted = true;
      }
    }

    if (this._adapting) {
      const u = clamp((nowMs - this._adaptStartMs) / ADAPT_DURATION_MS, 0, 1);
      this.target = this._adaptFrom + (ZOOM_NEUTRAL - this._adaptFrom) * smoothstep(0, 1, u);
      this.adaptEnv = Math.sin(Math.PI * u);
      if (u >= 1) {
        this.target = ZOOM_NEUTRAL;
        this._adapting = false;
        this.adaptEnv = 0;
        this.adaptDir = 0;
      }
    }

    this.value += (1 - Math.exp(-dtSec / EASE_TAU_SEC)) * (this.target - this.value);
  }
}
