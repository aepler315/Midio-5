// The unified event timeline (spec §0.3). MIDI and raw audio are both
// adapters that emit these — nothing downstream knows or cares which
// produced the show.
//
// @typedef {Object} NoteEvent
// @property {number} tMs      absolute onset, milliseconds
// @property {number} durMs    sustain length (transients default to 90 ms)
// @property {number} pitch    MIDI 0-127 (audio transients map to GM drum pitches)
// @property {number} vel      normalized 0-1
// @property {'MELODY'|'RHYTHM'|'BASS'|'PAD'} role
// @property {boolean} kick    true -> may drive a Midio jump
// @property {'midi'|'audio'} src
// @property {number} channel  midi channel or band index

export const Role = Object.freeze({
  MELODY: 'MELODY',
  RHYTHM: 'RHYTHM',
  BASS: 'BASS',
  PAD: 'PAD',
});

// GM drum-map pitches used by both the MIDI channel-10 path and the audio
// onset classifier so the two inputs are indistinguishable downstream.
export const GM_DRUM = Object.freeze({
  KICK: 36,
  SNARE: 38,
  HAT: 42,
});

/** @returns {NoteEvent} */
export function makeNoteEvent({
  tMs, durMs = 90, pitch, vel, role, kick = false, src, channel = 0,
}) {
  return { tMs, durMs, pitch, vel: Math.max(0, Math.min(1, vel)), role, kick, src, channel };
}

export function sortNoteEvents(events) {
  events.sort((a, b) => a.tMs - b.tMs);
  return events;
}
