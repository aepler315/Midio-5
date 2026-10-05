/**
 * Is this song's analysis complete enough for a full-song export?
 *
 * A long recording starts playing on an analysis of its opening and is
 * analysed whole in the background (OpeningAnalysis.js). A full-song video,
 * or a scored evaluation, must be made from the whole-song analysis: the
 * opening's data is stretched to the song's length so the arc and ending are
 * proportioned right, but nothing past the opening was actually heard by the
 * analyser. An advertised duration is therefore not evidence of coverage;
 * this reads the coverage metadata the analysis carries.
 *
 * The answer is one of:
 *   ready       the whole recording was analysed
 *   pending     only the opening so far, and the whole-song pass is running
 *   failed      only the opening, and the whole-song pass failed
 *   provisional only the opening, and nothing is running to replace it
 *
 * `pendingPromise` is only a hint that work is in flight. It is never stored
 * on the analysis data, which is serialised into the analysis cache.
 */

// A coverage shortfall smaller than this is rounding, not missing music.
const COVERAGE_TOLERANCE_MS = 50;

export const READINESS_MESSAGES = Object.freeze({
  missing: 'Load a song before exporting.',
  pending: 'Still analysing the whole song. The export will start when it finishes.',
  failed: 'The whole-song analysis failed, so a full-song video cannot be made yet. Only the opening was analysed.',
  provisional: 'Only the opening of this song has been analysed, so a full-song video cannot be made yet.',
});

/**
 * @param {object|null} data the timeline/analysis object the song plays from
 * @param {Promise|null} pendingPromise the whole-song pass in flight, if any
 * @returns {{state: 'ready'|'pending'|'failed'|'provisional', reason: string}}
 */
export function analysisReadiness(data, pendingPromise = null) {
  if (!data || typeof data !== 'object') {
    return { state: 'failed', reason: READINESS_MESSAGES.missing };
  }
  const opening = data.opening;
  if (!opening) return { state: 'ready', reason: '' };
  // An opening that turned out to cover the whole recording is the whole
  // recording, provisional flag or not.
  const analyzedMs = Number(opening.analyzedMs);
  const durationMs = Number(data.durationMs);
  if (Number.isFinite(analyzedMs) && Number.isFinite(durationMs) && durationMs > 0
    && analyzedMs >= durationMs - COVERAGE_TOLERANCE_MS) {
    return { state: 'ready', reason: '' };
  }
  if (opening.failed) {
    const detail = typeof opening.failure === 'string' && opening.failure ? ` (${opening.failure})` : '';
    return { state: 'failed', reason: READINESS_MESSAGES.failed + detail };
  }
  if (pendingPromise && typeof pendingPromise.then === 'function') {
    return { state: 'pending', reason: READINESS_MESSAGES.pending };
  }
  return { state: 'provisional', reason: READINESS_MESSAGES.provisional };
}

/** True only when a full-song export may arm the recorder. */
export function isExportReady(data, pendingPromise = null) {
  return analysisReadiness(data, pendingPromise).state === 'ready';
}
