// "That's this song, and we're forty-one seconds into it."
//
// This is the piece that makes a stored analysis usable against music the
// page is not allowed to touch. The listener puts something on; the
// microphone hears a few seconds of it; this searches what the device
// already knows for a recording those seconds belong to, and reports WHERE
// in it they sit. From there the whole composed show -- the arc, the
// climax, sections on time -- runs off the stored analysis while the
// listener's own app plays the audio.
//
// Everything expensive already exists: SongFingerprint.bestAlignment slides
// one bit sequence along another and returns the offset with the lowest bit
// error rate. What this adds is the bookkeeping around it, and the honesty:
//
//   A MATCH IS A CLAIM, AND IT CAN BE WRONG. Syncing a show to the wrong
//   master is worse than showing no show, because it looks broken rather
//   than absent. So a match must beat the threshold AND beat its runner-up
//   by a clear margin; a probe that fits two songs nearly equally well fits
//   neither well enough to act on.
//
//   THE POSITION IS OF THE PROBE'S END, NOT ITS START. The samples were
//   captured up to now, so "now" is where the probe finishes. Reporting the
//   start would put the show a whole probe-length behind -- several seconds
//   of lag that would read as the engine being sluggish rather than as an
//   off-by-one.
//
// Pure: bundles in, verdict out. No Web Audio, no storage, no clock.
//
// One optimization is deliberately ABSENT, because it was tried and it
// silently returned wrong answers. Scanning candidates at a coarse stride and
// then refining around the winner is the obvious way to make this cheaper,
// and it does not work here: the correlation peak is ONE FRAME WIDE. Offsets
// even two frames off the true alignment are uncorrelated (bit error ~0.44
// against ~0.16 at the peak), so a strided scan has no gradient pointing
// toward the answer -- it simply steps over it and reports the noise floor.
// Measured directly: a stride of 4 landed 14 to 30 frames away from a peak it
// never saw. The sweep is therefore always full resolution. At scale the
// right answer is an inverted index on sub-fingerprints, which is what a
// server would do; for a local cache of a hundred songs, a linear sweep is
// both correct and fast enough.
import {
  bestAlignment, bitErrorRate, MATCH_BER, fingerprintMono, FP_HOP, FP_WINDOW, FP_RATE,
} from './SongFingerprint.js';
import { bundleFrames } from './AnalysisBundle.js';

/** How much better the winner must be than the runner-up, in bit error rate.
 *  Below this the two candidates are not distinguishable and neither is
 *  acted on. */
export const MATCH_MARGIN = 0.04;
/** Shorter than this and a probe is too little evidence: a couple of seconds
 *  of almost any music aligns somewhere in almost any song. */
export const MIN_PROBE_SEC = 4;

/**
 * Which of these bundles is playing, and where are we in it?
 *
 * @param {Float32Array} probeSamples recent audio, oldest first
 * @param {number} sampleRate the rate `probeSamples` is at
 * @param {Array<{key:string, bundle:object}>} candidates
 * @returns {{key:string, positionMs:number, ber:number, margin:number,
 *   bundle:object}|null} null when nothing is confidently playing
 */
export function matchProbe(probeSamples, sampleRate, candidates, { latencyMs = 0 } = {}) {
  if (!probeSamples || probeSamples.length < MIN_PROBE_SEC * sampleRate) return null;
  if (!candidates || candidates.length === 0) return null;
  const probe = fingerprintMono(probeSamples, sampleRate);
  if (probe.frames.length < 8) return null;
  return matchFrames(probe.frames, probe.frameHz, candidates, { latencyMs });
}

/**
 * The same search, starting from an already-computed probe fingerprint.
 *
 * Split out so a caller re-checking drift can fingerprint once and search
 * only the one song it already believes is playing.
 */
export function matchFrames(probeFrames, frameHz, candidates, { latencyMs = 0 } = {}) {
  let best = null, runnerUp = 1;
  for (const cand of candidates) {
    const ref = bundleFrames(cand.bundle);
    if (ref.length < probeFrames.length) continue;
    const hit = bestAlignment(ref, probeFrames, { step: 1 });
    if (hit.ber >= 1) continue;
    if (!best || hit.ber < best.ber) {
      if (best) runnerUp = Math.min(runnerUp, best.ber);
      best = { key: cand.key, bundle: cand.bundle, ...hit };
    } else {
      runnerUp = Math.min(runnerUp, hit.ber);
    }
  }
  if (!best) return null;

  const margin = runnerUp - best.ber;
  // Both tests, not either: a low error says "this fits", and the margin says
  // "and nothing else fits as well". A song that appears twice in the cache
  // under two rips would pass the first and fail the second, which is the
  // correct outcome -- there is no way to tell which one is playing.
  if (best.ber > MATCH_BER) return null;
  if (candidates.length > 1 && margin < MATCH_MARGIN) return null;
  return {
    key: best.key,
    bundle: best.bundle,
    ber: best.ber,
    margin: candidates.length > 1 ? margin : 1,
    positionMs: positionMsAt(best.offsetFrames, probeFrames.length, frameHz, latencyMs),
  };
}

/** Bit error rate at one specific alignment, for a caller that already knows
 *  roughly where it is (drift re-checks) and only needs to confirm. */
export function bitErrorAt(ref, probe, off) {
  if (off < 0 || off + probe.length > ref.length) return 1;
  return bitErrorRate(ref, probe, off, 0, probe.length);
}

/**
 * How far past a frame's nominal time the audio it describes actually
 * reaches.
 *
 * Two offsets, both from the fingerprint's own construction, and both easy to
 * lose because each is small:
 *
 *   ONE HOP, because a frame's bits compare it against its PREDECESSOR, so
 *   `frames[i]` describes the audio frame at i+1, not at i.
 *
 *   ONE WINDOW, because a frame's samples run from its start for the whole
 *   window length -- the last captured sample is a window past where the last
 *   frame begins.
 *
 * Together 144ms at the current settings. Left out, the reported position is
 * that much early every single time -- a fixed bias, invisible in a test that
 * only asks "did it find the right song".
 */
export const FRAME_TAIL_MS = ((FP_HOP + FP_WINDOW) / FP_RATE) * 1000;

/**
 * Where "now" is, given where the probe starts.
 *
 * The probe was captured up TO the present, so the present is its last
 * frame -- using its first would run the show a whole probe behind the music.
 *
 * @param {number} [latencyMs] how old the newest captured sample already was
 *   when it was read: the capture batch plus the device's own input latency.
 *   The music kept playing during that, so the present is that much further
 *   in than the audio shows.
 */
export function positionMsAt(offsetFrames, probeLength, frameHz, latencyMs = 0) {
  const endFrame = offsetFrames + Math.max(0, probeLength - 1);
  return (endFrame / Math.max(1e-9, frameHz)) * 1000 + FRAME_TAIL_MS + latencyMs;
}

/**
 * Keeps a show's clock on top of a song nobody is driving.
 *
 * Two clocks run side by side and neither is authoritative on its own: the
 * page's own clock advances smoothly but knows nothing about the music, and
 * the periodic re-match knows exactly where the music is but arrives rarely
 * and occasionally lies. This reconciles them.
 *
 * A correction is applied as a RATE change rather than a jump wherever it
 * can be. A show that teleports its playhead re-fires section changes and
 * snaps the camera; one that runs one percent fast for a few seconds is
 * invisible. Only a correction too large to walk off -- a seek, a skipped
 * track -- is taken as a jump.
 */
export class SyncTracker {
  constructor({ maxEaseMs = 400, easeRate = 0.04, rateBlend = 0.5 } = {}) {
    /** Beyond this, a correction is a seek and is applied at once. */
    this.maxEaseMs = maxEaseMs;
    /** Fraction of clock time the correction may consume. 0.04 = the show
     *  runs 4% fast or slow while catching up, which is under the threshold
     *  at which tempo change is noticeable. */
    this.easeRate = easeRate;
    /** How fast the rate estimate moves toward each new observation. */
    this.rateBlend = rateBlend;
    /** Outstanding correction still being walked off, in ms. */
    this.pending = 0;
    /**
     * How fast the music runs relative to this page's clock.
     *
     * Correcting only the OFFSET is not enough, and the difference shows up
     * immediately in practice: two independent clocks -- a phone's audio
     * hardware and whatever device is playing the song -- do not tick at
     * quite the same speed, so an offset correction is undone by the time the
     * next measurement arrives and the show sits permanently behind by
     * however much accumulates between checks (measured at ~290ms per 15s
     * interval in the harness). Estimating the rate makes the correction
     * converge instead of chase.
     */
    this.rate = 1;
    /** Total correction handed out so far. Subtracted before estimating the
     *  rate: the clock the caller reports has ALREADY had these applied, so
     *  measuring against it shows the drift as fully compensated and the
     *  estimator concludes there is none -- while the offset ease keeps
     *  re-correcting the same error forever. The rate has to be read from
     *  the uncorrected clock. */
    this.applied = 0;
    this.lastMeasuredMs = null;
    this.lastClockMs = null;
    this.corrections = 0;
    this.jumps = 0;
  }

  /**
   * Report a fresh measurement.
   *
   * @param {number} measuredMs where the music actually is
   * @param {number} clockMs where the show thinks it is
   * @returns {{jump:boolean, errorMs:number}} jump=true means the caller
   *   should set its clock outright rather than let it be eased
   */
  measure(measuredMs, clockMs) {
    const errorMs = measuredMs - clockMs;
    const rawClockMs = clockMs - this.applied;
    this._updateRate(measuredMs, rawClockMs);
    this.lastMeasuredMs = measuredMs;
    this.lastClockMs = rawClockMs;
    if (Math.abs(errorMs) > this.maxEaseMs) {
      this.pending = 0;
      this.jumps++;
      // The clock is about to move discontinuously, so the interval spanning
      // that move says nothing about how fast the two clocks run. Start the
      // rate estimate fresh from the other side of it.
      this.lastMeasuredMs = null;
      this.lastClockMs = null;
      return { jump: true, errorMs };
    }
    this.pending = errorMs;
    this.corrections++;
    return { jump: false, errorMs };
  }

  /** Blend in how much song time passed per unit of UNCORRECTED clock time. */
  _updateRate(measuredMs, clockMs) {
    if (this.lastMeasuredMs == null || this.lastClockMs == null) return;
    const dSong = measuredMs - this.lastMeasuredMs;
    const dClock = clockMs - this.lastClockMs;
    // Too short an interval and the ratio is dominated by measurement noise
    // rather than by any real difference in rate.
    if (dClock < 2000 || dSong <= 0) return;
    const observed = dSong / dClock;
    // A ratio outside this band is not a clock running fast, it is a bad
    // match or a seek that slipped under the jump threshold. Adopting it
    // would make the show sprint.
    if (observed < 0.9 || observed > 1.1) return;
    this.rate += (observed - this.rate) * this.rateBlend;
  }

  /**
   * How far to nudge the clock this frame.
   *
   * @param {number} dtMs frame time
   * @returns {number} milliseconds to add to the show's clock, beyond dt
   */
  step(dtMs) {
    // The rate term runs continuously, with or without an outstanding
    // offset: it is not correcting a past error, it is keeping one from
    // accumulating in the first place.
    let move = (this.rate - 1) * dtMs;
    if (this.pending !== 0) {
      const room = dtMs * this.easeRate;
      const ease = Math.sign(this.pending) * Math.min(Math.abs(this.pending), room);
      this.pending -= ease;
      // Snap the last sliver rather than easing toward it forever.
      if (Math.abs(this.pending) < 0.01) this.pending = 0;
      move += ease;
    }
    this.applied += move;
    return move;
  }
}
