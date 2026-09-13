import { clamp01 } from '../utils/math.js';

/**
 * Turn detected rhythm events into a small, serializable description for
 * consumers that need musical activity rather than terrain-derived proxies.
 * `pulseRegularity` only makes a claim when the tempo detector has earned
 * confidence; free-time material keeps its event density but has no invented
 * metrical pulse.
 */
export function summarizeRhythmOnsets(onsets, durationMs, {
  beatPeriodMs = 0,
  confidence = 0,
} = {}) {
  const events = Array.isArray(onsets)
    ? onsets.filter((event) => Number.isFinite(event?.tMs))
    : [];
  const seconds = Math.max(1e-3, (durationMs || 0) / 1000);
  const eventRateHz = events.length / seconds;
  const kicks = events.filter((event) => event.kick);
  const kickShare = events.length ? kicks.length / events.length : 0;
  const tempoConfidence = Number.isFinite(confidence) ? clamp01(confidence) : 0;
  const usableBeat = Number.isFinite(beatPeriodMs) && beatPeriodMs > 0;

  let pulseRegularity = 0;
  if (usableBeat && tempoConfidence > 0 && kicks.length >= 4) {
    let x = 0, y = 0;
    for (const event of kicks) {
      const phase = ((event.tMs % beatPeriodMs) + beatPeriodMs) % beatPeriodMs / beatPeriodMs;
      const angle = phase * Math.PI * 2;
      x += Math.cos(angle);
      y += Math.sin(angle);
    }
    pulseRegularity = clamp01((Math.hypot(x, y) / kicks.length) * tempoConfidence);
  }

  return {
    eventRateHz,
    eventDensity: clamp01(eventRateHz / 4),
    kickShare,
    pulseRegularity,
    confidence: usableBeat ? tempoConfidence : 0,
  };
}
