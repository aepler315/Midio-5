import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TempoMap } from '../src/core/TempoMap.js';
import { midiToTimeline } from '../src/core/MidiAdapter.js';
import { Role } from '../src/core/NoteEvent.js';

function vlq(value) {
  let buffer = value & 0x7f;
  const bytes = [];
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= 0x80 | (value & 0x7f);
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8; else break;
  }
  return bytes;
}

function buildTrackChunk(events) {
  const bytes = [];
  for (const e of events) bytes.push(...e);
  const header = [0x4d, 0x54, 0x72, 0x6b]; // 'MTrk'
  const len = bytes.length;
  return [...header, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...bytes];
}

function buildSimpleMidi() {
  const ppqn = 96;
  const track = [];
  // Track name meta "Lead"
  track.push([...vlq(0), 0xff, 0x03, 4, 0x4c, 0x65, 0x61, 0x64]);
  // Tempo 500000 us/qn (120 BPM)
  track.push([...vlq(0), 0xff, 0x51, 3, 0x07, 0xa1, 0x20]);
  // Time sig 4/4
  track.push([...vlq(0), 0xff, 0x58, 4, 4, 2, 24, 8]);
  // Note on ch0 pitch60 vel100 at tick 0
  track.push([...vlq(0), 0x90, 60, 100]);
  // Note off at tick 96 (one quarter note later)
  track.push([...vlq(96), 0x80, 60, 0]);
  // Second overlapping-pitch retrigger to test FIFO pairing
  track.push([...vlq(0), 0x90, 60, 90]);
  track.push([...vlq(48), 0x90, 60, 80]); // retrigger before first closes
  track.push([...vlq(24), 0x80, 60, 0]); // closes the first-opened (FIFO)
  track.push([...vlq(24), 0x80, 60, 0]); // closes the second
  // End of track
  track.push([...vlq(0), 0xff, 0x2f, 0]);

  const trackChunk = buildTrackChunk(track);
  const header = [
    0x4d, 0x54, 0x68, 0x64, // 'MThd'
    0, 0, 0, 6,
    0, 0, // format 0
    0, 1, // ntrks
    (ppqn >> 8) & 0xff, ppqn & 0xff,
  ];
  return new Uint8Array([...header, ...trackChunk]).buffer;
}

test('TempoMap converts ticks to ms at 120 BPM', () => {
  const map = new TempoMap([{ tick: 0, usPerQN: 500000 }], 96);
  assert.equal(map.toMs(96), 500); // one quarter note = 500ms at 120bpm
  assert.equal(map.toMs(192), 1000);
});

test('TempoMap handles a tempo ramp mid-song', () => {
  const map = new TempoMap([
    { tick: 0, usPerQN: 500000 },   // 120 BPM
    { tick: 192, usPerQN: 1000000 }, // drops to 60 BPM at tick 192 (t=1000ms)
  ], 96);
  assert.equal(map.toMs(192), 1000);
  assert.equal(map.toMs(192 + 96), 1000 + 1000); // one quarter note at 60bpm = 1000ms
});

test('midiToTimeline parses a minimal SMF and pairs FIFO notes', () => {
  const buf = buildSimpleMidi();
  const { timeline, durationMs, tracks } = midiToTimeline(buf);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].noteCount, 3);
  assert.equal(timeline.length, 3);
  assert.ok(durationMs > 0);
  // First note: tick0 -> ms0, dur 96 ticks = 500ms
  assert.equal(timeline[0].tMs, 0);
  assert.equal(Math.round(timeline[0].durMs), 500);
});

test('single melody track with runs/legato falls back to MELODY role', () => {
  const buf = buildSimpleMidi();
  const { timeline } = midiToTimeline(buf);
  // Named "Lead" should hit the MELODY keyword regex directly.
  assert.equal(timeline[0].role, Role.MELODY);
});
