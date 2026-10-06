// The demo song's authored score: structure and lane casting. These are the
// properties the rest of the app relies on when the demo stands in for a
// dropped file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoSong, DEMO_BPM, DEMO_DURATION_MS, SECTIONS, BAR_MS } from '../src/core/DemoSong.js';
import { Lane } from '../src/core/Casting.js';
import { Role } from '../src/core/NoteEvent.js';

const song = buildDemoSong();

test('the score is a real song: 48 bars at 120, with every named section', () => {
  assert.equal(song.bpm, DEMO_BPM);
  assert.equal(song.durationMs, DEMO_DURATION_MS);
  assert.equal(song.barGrid.length, 48);
  assert.ok(SECTIONS.length >= 8);
  assert.ok(song.timeline.length > 200, `sparse score? ${song.timeline.length} events`);
  const lanes = new Set(song.timeline.map((e) => e.lane).filter(Boolean));
  assert.ok(lanes.has(Lane.BROSHI) && lanes.has(Lane.MIDASUS) && lanes.has(Lane.MIDIO),
    'the trio must each own a lane so hops / melody / double-jumps route');
});

test('casting: Midio lead notes exist only in the fill, so verse bass cannot steal air-jumps', () => {
  const lead = song.timeline.filter((e) => e.lane === Lane.MIDIO);
  assert.ok(lead.every((e) => e.tMs >= 28 * BAR_MS && e.tMs < 32 * BAR_MS),
    `lead stabs leaked out of the fill: ${lead.map((e) => e.tMs)}`);
  const verseBassOffbeat = song.timeline.filter((e) =>
    e.role === Role.BASS && e.tMs < 16 * BAR_MS && Math.round((e.tMs % BAR_MS) / (BAR_MS / 4)) % 2 === 1);
  assert.equal(verseBassOffbeat.length, 0, 'off-beat bass would double-jump the verse');
});
