import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPercussionPattern, PATTERN_SPAN_MS } from '../src/ui/LoadingShow.js';
import { Role } from '../src/core/NoteEvent.js';

const kick = (tMs, vel = 0.8) => ({ role: Role.RHYTHM, kick: true, tMs, vel });
const melody = (tMs) => ({ role: Role.MELODY, kick: false, tMs, vel: 0.6, pitch: 60 });

test('keeps on-pulse kicks as thumps and demotes crowded ones to hats', () => {
  const bpm = 120; // beat = 500ms
  const timeline = [
    kick(0), kick(120), kick(500), kick(1000), melody(750), kick(1120),
  ];
  const { hits } = buildPercussionPattern(timeline, bpm);
  const kinds = hits.map((h) => `${h.tMs}:${h.kind}`);
  assert.deepEqual(kinds, ['0:thump', '120:hat', '500:thump', '1000:thump', '1120:hat']);
  const hat = hits.find((h) => h.kind === 'hat');
  assert.ok(hat.vel < 0.8, 'hats are quieter than the kick they came from');
});

test('ignores non-rhythm events and everything past the span', () => {
  const timeline = [melody(0), kick(PATTERN_SPAN_MS + 100), kick(200)];
  const { hits } = buildPercussionPattern(timeline, 120);
  assert.deepEqual(hits.map((h) => h.tMs), [200]);
});

test('a kickless song still gets a four-on-the-floor pulse', () => {
  const { hits, loopMs } = buildPercussionPattern([melody(0), melody(400)], 120);
  assert.equal(hits.length, 16);
  assert.ok(hits.every((h) => h.kind === 'thump'));
  assert.equal(hits[1].tMs - hits[0].tMs, 500);
  assert.ok(loopMs >= hits[hits.length - 1].tMs, 'loop covers the pattern');
});

test('loop length is a whole number of bars and covers the last hit', () => {
  const { loopMs } = buildPercussionPattern([kick(0), kick(500), kick(6100)], 120);
  const barMs = 2000;
  assert.equal(loopMs % barMs, 0);
  assert.ok(loopMs >= 6100);
});
