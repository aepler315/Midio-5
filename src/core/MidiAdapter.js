// Adapter: SMF ArrayBuffer -> unified NoteEvent[] timeline + bar grid (spec §1.1).
import { parseMidi, pairNotes, rescaleVelocities } from './MidiParser.js';
import { classifyTracks } from './TrackClassifier.js';
import { Role, makeNoteEvent, sortNoteEvents } from './NoteEvent.js';

// Standard GM kick pitches on channel 10 (0-indexed channel 9).
const GM_KICK_PITCHES = new Set([35, 36]);

export function midiToTimeline(arrayBuffer) {
  const parsed = parseMidi(arrayBuffer);
  const { tracks, tempoMap, timeSigEvents } = parsed;

  // Determine the song's last tick across all tracks (for force-closing notes).
  let lastTick = 0;
  for (const t of tracks) {
    for (const e of t.rawEvents) if (e.tick > lastTick) lastTick = e.tick;
  }

  const trackData = tracks.map((track) => {
    const paired = pairNotes(track.rawEvents, lastTick);
    rescaleVelocities(paired);
    const notes = paired.map((n) => ({
      pitch: n.pitch,
      startMs: tempoMap.toMs(n.tick),
      durMs: Math.max(1, tempoMap.toMs(n.tick + n.durTicks) - tempoMap.toMs(n.tick)),
      vel: n.velNorm,
      channel: n.channel,
    }));
    const durationSec = notes.length ? (tempoMap.toMs(lastTick) / 1000) : 0;
    return { track, notes, durationSec };
  });

  const roles = classifyTracks(trackData, parsed.gmProgramName);

  const timeline = [];
  for (const { track, notes } of trackData) {
    const role = roles.get(track.index);
    for (const n of notes) {
      const kick = role === Role.RHYTHM && (GM_KICK_PITCHES.has(n.pitch) || n.channel === 9 && n.pitch === 36);
      timeline.push(makeNoteEvent({
        tMs: n.startMs,
        durMs: n.durMs,
        pitch: n.pitch,
        vel: n.vel,
        role,
        kick,
        src: 'midi',
        channel: n.channel,
      }));
    }
  }
  sortNoteEvents(timeline);

  const barGrid = buildBarGrid(timeSigEvents, tempoMap, tempoMap.toMs(lastTick), parsed.ppqn);

  return {
    timeline,
    barGrid,
    durationMs: tempoMap.toMs(lastTick),
    bpm: tempoMap.bpmAt ? (tempoMap.bpmAt(0) || 120) : 120,
    tracks: trackData.map(({ track, notes }, i) => ({
      index: track.index, name: track.name, role: roles.get(track.index), noteCount: notes.length,
    })),
  };
}

/** Absolute-ms downbeat grid, derived from the time-signature map (spec §1.1.3). */
function buildBarGrid(timeSigEvents, tempoMap, totalMs, ppqn) {
  const grid = [];
  const sorted = [...timeSigEvents].sort((a, b) => a.tick - b.tick);
  for (let i = 0; i < sorted.length; i++) {
    const sig = sorted[i];
    const nextTick = i + 1 < sorted.length ? sorted[i + 1].tick : null;
    const ticksPerBar = ppqn ? (ppqn * 4 * sig.numerator) / sig.denominator : null;
    if (!ticksPerBar) break; // SMPTE-mode maps have no PPQN bar concept here
    let tick = sig.tick;
    const endTick = nextTick !== null ? nextTick : (tempoMap.toTick ? tempoMap.toTick(totalMs) : tick);
    while (tick <= endTick + 1e-6) {
      grid.push({ tick, ms: tempoMap.toMs(tick), numerator: sig.numerator, denominator: sig.denominator });
      tick += ticksPerBar;
    }
  }
  return grid;
}
