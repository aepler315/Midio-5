// Camera state: screen shake, a damped impact roll (spec §2.2.1), and a
// zoom that pulls back when a performer strays off-frame. The Renderer
// reads shake/roll/zoom from here and applies a fixed framing otherwise.

// Shake was dialed up for a "ferocity" pass (gain 2×, long ring, hard roll).
// That reads as seasick on long songs -- pull it back so impacts still
// register without thrashing the frame. Reduced-motion halves it further.
const SHAKE_GAIN = 0.85;
const SHAKE_DECAY_TAU = 0.07; // seconds -- short ring, doesn't hang
const ROLL_COUPLING = 0.0007; // rotational kick per (gained) px of shake

// Off-frame pull-back: characters roam on their own drift/formation logic
// and can genuinely wander toward an edge. This is for the UNINTENDED
// case only -- a character deliberately sent off (Midasus's sky voyage,
// Broshi's burrow) is excluded by the caller before this ever sees their
// position, because chasing an authored exit with the camera fights the
// exit's own effect.
export const ZOOM_MARGIN_FRAC = 0.08; // how close to either edge is "still fine"
export const ZOOM_MIN = 0.75; // hardest pull-back -- keeps the world legible, never a wide shot
const ZOOM_TAU = 0.6; // seconds -- slow, deliberate ease, never a snap

/**
 * How zoomed out the camera should want to be (1 = normal framing, ZOOM_MIN
 * = maximally pulled back) given a set of on-frame character screen X
 * positions. Pure -- no state, no canvas -- CameraDirector eases `zoom`
 * toward whatever this returns each frame.
 * @param {number[]} screenXs already filtered by the caller to exclude any
 *   character on an authored excursion
 * @param {number} stageW
 */
export function zoomTargetForOffFrame(screenXs, stageW) {
  if (!screenXs || screenXs.length === 0 || !(stageW > 0)) return 1;
  const margin = stageW * ZOOM_MARGIN_FRAC;
  let worst = 0; // grows the further anyone strays past either margin
  for (const x of screenXs) {
    const overLeft = margin - x;
    const overRight = x - (stageW - margin);
    const overshoot = Math.max(0, overLeft, overRight);
    if (overshoot > worst) worst = overshoot;
  }
  // The ramp runs across the margin band itself: a character right at the
  // margin (x = margin) has zero overshoot (still "fine"), and by the time
  // they'd reach the true stage edge (x = 0) overshoot has already reached
  // a full margin-width, which is enough to ask for the hardest pull-back
  // the clamp allows -- the point being to pull back BEFORE anyone actually
  // exits the frame, not react after the fact. Going further negative (or
  // past stageW - margin, or stageW + margin on the right) just saturates.
  const t = Math.max(0, Math.min(1, worst / margin));
  return 1 - (1 - ZOOM_MIN) * t;
}

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

    this.zoom = 1; // 1 = normal framing; the Renderer widens the logical stage view by 1/zoom
    this._zoomTarget = 1;
  }

  /** Called once per frame before update(); sets what zoom() should ease
   *  toward. See zoomTargetForOffFrame's doc for what to pass in. */
  setZoomTarget(screenXs, stageW) {
    this._zoomTarget = zoomTargetForOffFrame(screenXs, stageW);
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

    // Calm sections (follow-up item 3): a slow drift layered on top of
    // impact shake (additive, so a landing during a calm stretch still
    // reads correctly) -- keeps the frame from ever feeling frozen.
    this._driftT = (this._driftT || 0) + dtSec;
    const driftAmp = 3 * calmLevel;
    const driftX = driftAmp * Math.sin(2 * Math.PI * 0.1 * this._driftT);
    const driftY = driftAmp * Math.sin(2 * Math.PI * 0.1 * this._driftT * 0.7 + 1.3);

    this.shakeX = shakeX * motionMul + driftX;
    this.shakeY = shakeY * motionMul + driftY;

    // Zoom: critically-damped-ish exponential ease toward _zoomTarget, same
    // discipline as the shake/roll ring-downs above -- it must never snap
    // or oscillate, since a sudden framing change reads as a cut, not a
    // camera move. Reduced-motion shrinks the travel rather than disabling
    // it outright (the target still communicates "someone strayed off
    // frame", just less dramatically).
    const zoomTravelMul = reducedMotion ? 0.4 : 1;
    const zoomTarget = 1 + (this._zoomTarget - 1) * zoomTravelMul;
    const zoomAlpha = 1 - Math.exp(-dtSec / ZOOM_TAU);
    this.zoom += zoomAlpha * (zoomTarget - this.zoom);
  }
}
