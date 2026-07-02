// Adapter: decoded AudioBuffer -> unified NoteEvent[] timeline + bar grid +
// continuous EnergyCurves (spec §1.2). Produces the exact same shapes the
// MIDI adapter does, so the two inputs are indistinguishable downstream.
import { separateStems } from './StemSeparator.js';
import { computeBandEnvelopes, normalizeBands, detectRhythmOnsets, estimateTempo, extractPseudoLane } from './OnsetDetector.js';
import { EnergyCurves } from './EnergyCurves.js';
import { Role, makeNoteEvent, sortNoteEvents } from '../core/NoteEvent.js';

export async function audioToTimeline(audioBuffer, { onProgress = null } = {}) {
  const stems = await separateStems(audioBuffer, (p) => onProgress?.({ phase: 'separate', progress: p }));
  onProgress?.({ phase: 'analyze', progress: 0 });

  const { rate, raw } = computeBandEnvelopes(stems);
  const normBands = normalizeBands(raw, rate);

  const { O, onsets: rhythmOnsets } = detectRhythmOnsets(normBands, raw, rate, 1);
  const kickFrames = rhythmOnsets.filter((o) => o.kick).map((o) => o.frame);
  const tempo = estimateTempo(O, rate, kickFrames);

  const melodyNotes = extractPseudoLane(normBands, rate, {
    bandIndices: [2, 3, 4], pitchLo: 60, pitchHi: 96, role: Role.MELODY, onsetThreshold: 1,
  });
  const bassNotes = extractPseudoLane(normBands, rate, {
    bandIndices: [0, 1], pitchLo: 28, pitchHi: 52, role: Role.BASS, onsetThreshold: 1,
  });

  const timeline = [];
  for (const o of rhythmOnsets) {
    timeline.push(makeNoteEvent({
      tMs: o.tMs, durMs: 90, pitch: o.pitch, vel: o.vel, role: Role.RHYTHM, kick: o.kick, src: 'audio', channel: 0,
    }));
  }
  for (const n of melodyNotes) {
    timeline.push(makeNoteEvent({ tMs: n.tMs, durMs: 160, pitch: n.pitch, vel: n.vel, role: Role.MELODY, src: 'audio', channel: 3 }));
  }
  for (const n of bassNotes) {
    timeline.push(makeNoteEvent({ tMs: n.tMs, durMs: 220, pitch: n.pitch, vel: n.vel, role: Role.BASS, src: 'audio', channel: 1 }));
  }
  sortNoteEvents(timeline);

  const durationMs = (raw[0].length / rate) * 1000;

  // tempo.firstBarMs is already the first downbeat at/after t=0 (spec §1.2.5).
  const barGrid = [];
  if (!tempo.freeTime) {
    let bar = 0;
    for (let t = tempo.firstBarMs; t < durationMs; t += tempo.barPeriodMs, bar++) {
      barGrid.push({ tick: bar * 4, ms: t, numerator: 4, denominator: 4 });
    }
  }

  const energyCurves = new EnergyCurves(durationMs, rate);
  for (let i = 0; i < energyCurves.n; i++) {
    const frame = Math.min(raw[0].length - 1, i);
    energyCurves.setFrame(i, normBands.map((b) => b[frame] ?? 0));
  }

  onProgress?.({ phase: 'done', progress: 1 });

  return {
    timeline, barGrid, durationMs,
    bpm: tempo.bpm, beatPeriodMs: tempo.beatPeriodMs, confidence: tempo.confidence, freeTime: tempo.freeTime,
    energyCurves,
  };
}
