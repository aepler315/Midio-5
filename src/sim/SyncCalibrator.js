// Setting the Bluetooth delay from the player's own tapping.
//
// The premise, and it is the player's: their taps are canon. If they tap
// along with what they HEAR and those taps land 150ms after the song's
// kicks, then the sound is reaching them 150ms late, and that is the number
// -- not a figure to be second-guessed against published averages or
// corrected for the well-documented human tendency to anticipate a
// metronome. Whatever they tap is what they hear.
//
// ## The closed loop, and why raw offsets cannot be averaged
//
// A tap is timestamped on the clock the ear is on -- `visualNow`, which
// already has the current trim subtracted from it. So the offset measured
// after applying a trim of T is the RESIDUAL against T, not the absolute
// error. Once the trim moves after every tap (which is the point: the value
// updates live), successive offsets are each measured against a different
// trim and averaging them directly would mix incompatible quantities and
// converge on the wrong number.
//
// So each tap is stored as what it implies the trim SHOULD be --
// `trimInForce + offset` -- and the estimate is the robust middle of those.
// Every entry is then in the same units, whatever the trim was doing while
// they were collected.
//
// Pure: no clock, no DOM, no audio. Every timestamp is handed in.
import { clamp } from '../utils/math.js';
import { MAX_LATENCY_MS } from '../core/ChoreoClock.js';
import { median } from './LatencyCalibrator.js';

/** A gap this long starts a fresh measurement. Matches BeatAnchor's own
 *  session gap: someone who stopped tapping and came back a while later is
 *  making a new judgement, not continuing an old one. */
export const TAP_SESSION_GAP_MS = 4000;

/** The same rail the stored preference and the manual input use. */
export const MAX_TRIM_MS = 500;

/**
 * The largest POSITIVE trim that will actually do anything.
 *
 * A positive trim delays the visuals by adding to the lag handed to
 * `visualNow`, which clamps the total to MAX_LATENCY_MS. Past that ceiling
 * the number keeps rising and the picture stops moving -- and for a loop
 * that measures its own residual and pushes again, that is a runaway: the
 * error never closes, so the trim climbs until it hits its own rail.
 * Observed in a browser at 376ms against a 350ms clamp.
 *
 * The negative side has no such ceiling here: it delays the audio through a
 * DelayNode built with a full second of range, so the ±500ms rail is the
 * only limit that applies.
 */
export function positiveTrimCeilingMs(outputLatencyMs = 0) {
  const reported = Number.isFinite(outputLatencyMs) ? Math.max(0, outputLatencyMs) : 0;
  return clamp(MAX_LATENCY_MS - reported, 0, MAX_TRIM_MS);
}

/** How far from a kick a tap may land and still count as aimed at it, as a
 *  fraction of the beat. Half a beat either side is the whole beat's worth
 *  of territory and no more -- past that the tap is closer to its neighbour
 *  and attributing it here would fold a whole beat into the estimate. */
const MATCH_WINDOW_BEATS = 0.5;
const MATCH_WINDOW_MIN_MS = 80;
const MATCH_WINDOW_MAX_MS = 400;

/**
 * Onsets closer together than this are one event, not two.
 *
 * Onset lists are not a grid. A real one, measured off a 120bpm fixture,
 * ran 1010, 81, 917, 81 -- the kicks arrive in flammed pairs. Matching a
 * tap against the raw list picks whichever half happens to be nearer,
 * which does not average out: it pulls every tap in the pair's
 * neighbourhood toward zero. Measured doing exactly that, reading 16ms
 * where 78ms was true.
 *
 * The fix is to collapse the cluster rather than to reject taps near it.
 * A player tapping the beat taps where the cluster STARTS -- the flam is
 * an ornament on that beat, not a second beat -- so the first onset is the
 * one to keep, and rejecting the tap would have thrown away good data for
 * a problem the onset list could fix about itself.
 */
export const FLAM_GAP_MS = 120;

/**
 * ...and it scales with tempo, because a fixed gap cannot tell an ornament
 * from a fast pattern.
 *
 * The onset detector will report hits 60ms apart, and a double-kick figure
 * at 100ms spacing is a real one, not a flam. Collapsing those would
 * measure a player who tapped the second kick as 100ms late and persist a
 * delay they never had. But double-kick figures live in fast music, so a
 * threshold expressed as a fraction of the beat separates the two: the
 * ornament observed in the wild was 81ms against a ~713ms beat (11%),
 * while a 100ms double-kick at 200bpm is a third of its beat.
 */
const FLAM_GAP_BEAT_FRACTION = 0.2;

/** Taps kept. Long enough to be robust, short enough that a player who
 *  drifts mid-pass is followed rather than averaged against their own past. */
const HISTORY_MAX = 16;

/** Fraction of the sample kept after discarding the wildest taps. A stray
 *  tap during a real pass is normal; letting one drag the delay is not. */
const KEEP_FRACTION = 0.75;
const MIN_KEPT = 3;

/**
 * The signed distance from `tapMs` to the nearest onset, or null when the
 * tap is not near one.
 *
 * Positive means the tap was LATE. Null is a real answer and the common one
 * for a tap during a rest or a fill: a tap with nothing to be measured
 * against is not a measurement, and feeding it in as a zero would drag the
 * estimate toward "no correction needed".
 *
 * `onsets` must be ascending; the search is binary because a four-minute
 * song has thousands of kicks and this runs on every tap.
 */
export function nearestOnsetOffsetMs(onsets, tapMs, windowMs) {
  if (!onsets?.length || !Number.isFinite(tapMs)) return null;
  let lo = 0;
  let hi = onsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (onsets[mid] < tapMs) lo = mid + 1; else hi = mid;
  }
  // `lo` is the first onset at or after the tap; its predecessor is the last
  // one before. The nearer of the two wins. Callers measuring against a
  // real chart should pass a list through `collapseFlams` first -- this
  // takes the list it is given at face value.
  let best = null;
  for (const i of [lo - 1, lo]) {
    if (i < 0 || i >= onsets.length) continue;
    const delta = tapMs - onsets[i];
    if (best === null || Math.abs(delta) < Math.abs(best)) best = delta;
  }
  if (best === null || Math.abs(best) > windowMs) return null;
  return best;
}

/**
 * One entry per cluster of onsets, keeping the first of each.
 *
 * The first is the beat; anything within `minGapMs` after it is the same
 * event's tail. Ascending in, ascending out.
 */
export function flamGapMs(beatPeriodMs) {
  const beat = Number.isFinite(beatPeriodMs) && beatPeriodMs > 0 ? beatPeriodMs : 500;
  return Math.min(FLAM_GAP_MS, beat * FLAM_GAP_BEAT_FRACTION);
}

export function collapseFlams(onsets, minGapMs = FLAM_GAP_MS) {
  if (!onsets?.length) return [];
  const out = [onsets[0]];
  for (let i = 1; i < onsets.length; i++) {
    if (onsets[i] - out[out.length - 1] >= minGapMs) out.push(onsets[i]);
  }
  return out;
}

/** How wide a window a tap may land in, for this tempo. */
export function matchWindowMs(beatPeriodMs) {
  const beat = Number.isFinite(beatPeriodMs) && beatPeriodMs > 0 ? beatPeriodMs : 500;
  return clamp(beat * MATCH_WINDOW_BEATS, MATCH_WINDOW_MIN_MS, MATCH_WINDOW_MAX_MS);
}

/** The robust middle of a sample: the median of everything except the
 *  wildest quarter, measured by distance from the median. */
export function trimmedMedian(values) {
  if (!values?.length) return 0;
  if (values.length <= MIN_KEPT) return median(values);
  const mid = median(values);
  const byDistance = [...values].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  const keep = Math.max(MIN_KEPT, Math.ceil(byDistance.length * KEEP_FRACTION));
  return median(byDistance.slice(0, keep));
}

/** Median absolute deviation: how much the taps disagree with each other.
 *  Reported so the UI can say whether an estimate is settled or still
 *  wandering, without anyone having to guess from the number alone. */
export function spreadMs(values) {
  if (!values?.length) return 0;
  const mid = median(values);
  return median(values.map((v) => Math.abs(v - mid)));
}

export class SyncCalibrator {
  constructor(trimMs = 0) {
    this.trimMs = clamp(Math.round(trimMs) || 0, -MAX_TRIM_MS, MAX_TRIM_MS);
    /** What each tap implied the trim should be, in one consistent unit. */
    this._implied = [];
    this._lastTapMs = -Infinity;
    /** The collapsed onset list, cached against the array it came from --
     *  this runs on every tap and the chart does not change under it. */
    this._onsetsRef = null;
    this._collapsedGap = null;
    this._collapsed = [];
  }

  get taps() { return this._implied.length; }

  /** Start over from a known trim -- what the Sync button does on entry. */
  reset(trimMs = this.trimMs) {
    this.trimMs = clamp(Math.round(trimMs) || 0, -MAX_TRIM_MS, MAX_TRIM_MS);
    this._implied = [];
    this._lastTapMs = -Infinity;
  }

  /**
   * Take one tap and return the new trim, or null when the tap told us
   * nothing.
   *
   * @param {number} tapMs   the tap, on the clock the ear is on -- already
   *                         carrying the trim currently in force
   * @param {number[]} onsets ascending chart onsets (the kicks)
   * @param {number} beatPeriodMs current beat length, for the match window
   */
  tap(tapMs, onsets, beatPeriodMs, { maxPositiveTrimMs = MAX_TRIM_MS } = {}) {
    if (!Number.isFinite(tapMs)) return null;
    const gap = flamGapMs(beatPeriodMs);
    if (onsets !== this._onsetsRef || gap !== this._collapsedGap) {
      this._onsetsRef = onsets;
      this._collapsedGap = gap;
      this._collapsed = collapseFlams(onsets, gap);
    }
    const offsetMs = nearestOnsetOffsetMs(this._collapsed, tapMs, matchWindowMs(beatPeriodMs));
    if (offsetMs === null) return null;

    if (tapMs - this._lastTapMs > TAP_SESSION_GAP_MS) this._implied = [];
    this._lastTapMs = tapMs;

    // What this tap says the trim should be. Stored rather than the raw
    // offset so entries collected under different trims stay comparable.
    this._implied.push(this.trimMs + offsetMs);
    if (this._implied.length > HISTORY_MAX) this._implied.shift();

    const previous = this.trimMs;
    const ceiling = clamp(maxPositiveTrimMs, 0, MAX_TRIM_MS);
    const wanted = Math.round(trimmedMedian(this._implied));
    this.trimMs = clamp(wanted, -MAX_TRIM_MS, ceiling);
    return {
      trimMs: this.trimMs,
      offsetMs,
      taps: this._implied.length,
      spreadMs: Math.round(spreadMs(this._implied)),
      changed: this.trimMs !== previous,
      // The taps are asking for more delay than the visual clock can apply.
      // Said out loud rather than swallowed: a player tapping harder at a
      // number that has stopped moving deserves to know why.
      railed: wanted > ceiling,
    };
  }
}

/**
 * The one-line readout for a live pass.
 *
 * Says which way the correction goes in the words the control uses --
 * visuals delayed, or audio delayed -- because "+150" and "-150" are not
 * self-explanatory to someone holding a phone in a car.
 */
export function syncStatusText(result) {
  if (!result) return null;
  const { trimMs, taps, spreadMs: spread } = result;
  const magnitude = Math.abs(trimMs);
  const direction = trimMs > 0 ? 'visuals delayed' : trimMs < 0 ? 'audio delayed' : 'no delay';
  const settled = taps >= 4 && spread <= 25;
  const head = trimMs === 0 ? 'Bluetooth delay: none' : `Bluetooth delay: ${magnitude}ms (${direction})`;
  if (result.railed) return `${head} · as far as the visuals can be delayed`;
  if (taps < 3) return `${head} · keep tapping`;
  return settled ? `${head} · settled` : `${head} · ±${spread}ms, keep tapping`;
}
