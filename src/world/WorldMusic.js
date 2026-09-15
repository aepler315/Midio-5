// Musical controls shared by the city and underwater renderers.
// Rhythm comes from the conductor subscription; never invent a beat from BPM.
// Sampling is causal and stateless, so rendering cannot advance the music.
import { clamp01 } from '../utils/math.js';

const unit = (value) => Number.isFinite(value) ? clamp01(value) : 0;

export function sampleWorldMusic({ nowMs = 0, energyCurves = null, rhythm = null, section = null, reducedFlash = false } = {}) {
  nowMs = Number.isFinite(nowMs) ? Math.max(0, nowMs) : 0;
  // Average the trailing 1.2 seconds at 20ms spacing (the audio curves'
  // normal frame size). Sparse taps can align with rapid drums and turn
  // every tap into the same peak, defeating the slow-pressure envelope.
  // Fixed samples also make 30/60fps and paused renders agree.
  let bass = 0, energy = 0;
  for (let i = 0; i < 60; i++) {
    const at = nowMs - (i + 0.5) * 20;
    if (at < 0) continue;
    bass += (unit(energyCurves?.sample?.(0, at)) + unit(energyCurves?.sample?.(1, at))) / 120;
    energy += unit(energyCurves?.globalEnergyNorm?.(at)) / 60;
  }
  const age = nowMs - (rhythm?.tMs ?? -Infinity);
  const accent = age >= 0 && age < 800
    ? unit(rhythm.vel) * Math.exp(-age / 150) * (reducedFlash ? 0.25 : 1) : 0;
  // Open over four seconds at an evidence-backed boundary. Pacing-only
  // cuts are visual scheduling, not evidence of a musical phrase.
  const elapsed = nowMs - (section?.startMs ?? 0);
  const span = Math.min(4000, (section?.endMs ?? 0) - (section?.startMs ?? 0));
  const trust = section?.provenance === 'detected' ? 1 : section?.provenance === 'inferred' ? 0.5 : 0;
  const reveal = section?.startMs > 0 && elapsed > 0 && elapsed < span
    ? Math.sin(Math.PI * elapsed / span) ** 2 * trust : 0;
  return {
    bass, energy, accent, reveal,
    group: rhythm && Number.isFinite(rhythm.tMs) ? Math.abs(Math.round(rhythm.tMs * 0.013)) % 4 : 0,
    current: reducedFlash ? 0 : Math.sin(nowMs / 8000) * (0.35 + 0.35 * bass),
    cityLight: 0.18 + 0.45 * energy,
    waterLight: 0.12 + 0.22 * bass,
  };
}
