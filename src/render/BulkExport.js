/**
 * Offline frame export: the clock and the frame size.
 *
 * An ordinary play session advances the simulation against the audio clock
 * (see FixedStepClock.js), which is authoritative because the listener is
 * hearing it. A bulk export has no listener and no audio clock -- the file's
 * own audio is muxed in afterwards -- so the caller asks for one frame at a
 * time and the simulation is marched to meet it.
 *
 * Both functions are deliberately pure: they own no state, touch no DOM, and
 * receive the stepper as a callback. That is what lets the export be tested
 * without a browser, and what lets the same song render identically at every
 * resolution.
 */

/**
 * Advance an offline simulation to `targetMs` in whole fixed steps.
 *
 * Only whole steps are taken, so `simTime` can land up to one step behind the
 * requested time. That is the point rather than a rounding bug: the exporter
 * asks for frames on the video's cadence (33.37ms at 29.97fps, say) while the
 * simulation must keep its own fixed step, or every physical quantity would
 * depend on the frame rate being exported to. Callers draw at -- and report --
 * the returned `simTime`, which is the instant actually simulated.
 *
 * A target at or behind the current time takes no steps. The clock never runs
 * backwards, and asking twice for the same frame is not an error.
 *
 * @param {object} args
 * @param {number} args.simTime Current simulation time, in milliseconds.
 * @param {number} args.targetMs Time the caller wants drawn, in milliseconds.
 * @param {number} args.stepMs Fixed step size, in milliseconds. Must be > 0.
 * @param {(dtMs: number, atMs: number) => void} args.step Advances the sim by
 *   one step. Called with the same (dt, at) shape the live loop uses.
 * @returns {{ simTime: number, steps: number }} The reached time, and how many
 *   steps it took to get there.
 */
export function stepExportClock({ simTime, targetMs, stepMs, step }) {
  if (!Number.isFinite(simTime)) throw new Error('Export clock time is not a number.');
  if (!Number.isFinite(targetMs)) throw new Error('Export frame time is not a number.');
  // A zero or negative step would never reach the target: the loop below would
  // spin forever rather than fail, which is the worst way for this to break.
  if (!Number.isFinite(stepMs) || stepMs <= 0) throw new Error('Export step must be a positive number of milliseconds.');
  if (typeof step !== 'function') throw new Error('Export clock needs a step function.');

  let nextSimTime = simTime;
  let steps = 0;
  while (nextSimTime + stepMs <= targetMs) {
    nextSimTime += stepMs;
    step(stepMs, nextSimTime);
    steps += 1;
  }
  return { simTime: nextSimTime, steps };
}

/**
 * Validate a frame size for export, or return null if it cannot be used.
 *
 * Sizes arrive from two untrusted-ish places: a caller's arguments and the
 * `exportW`/`exportH` query parameters, which are whatever was typed. So this
 * has to survive NaN, strings, fractions, negatives and a missing argument
 * entirely.
 *
 * Odd sizes are rejected rather than nudged. Every common video encoder needs
 * even dimensions for chroma subsampling, and silently exporting 1279 wide
 * when 1280 was asked for -- or, worse, silently changing the aspect ratio --
 * is the kind of surprise that is only discovered after a long render. The
 * callers turn a null into an error naming the size they were given.
 *
 * @param {{ w: number, h: number } | null | undefined} size
 * @returns {{ w: number, h: number } | null} The same size, normalized to
 *   numbers, or null if it is not an even pair of at least 2x2.
 */
export function evenExportSize(size) {
  if (!size || typeof size !== 'object') return null;
  const w = Number(size.w);
  const h = Number(size.h);
  if (!isEvenDimension(w) || !isEvenDimension(h)) return null;
  return { w, h };
}

/** A usable dimension: a whole, even number of pixels, at least 2. */
function isEvenDimension(value) {
  return Number.isInteger(value) && value >= 2 && value % 2 === 0;
}
