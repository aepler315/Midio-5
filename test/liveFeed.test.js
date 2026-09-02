// The one thing live listening cannot get from the microphone is the future,
// and the whole engine's choreography is built on having it. These pin the
// properties that make LiveFeed a usable substitute: it emits ahead of the
// clock, it stays on the grid under syncopation, and it never emits the same
// beat twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveFeed, EMIT_HORIZON_MS, PHASE_CAPTURE } from '../src/audio/LiveFeed.js';
import { Role } from '../src/core/NoteEvent.js';

const bands = (v = 0.5) => [v, v, v, v, v, v, v];
const state = (over = {}) => ({ bpm: 120, confidence: 0.8, bands: bands(), energy01: 0.6, ...over });

test('notes are emitted ahead of the clock, never behind it', () => {
  // This is the entire reason the module exists: Conductor.subscribeAhead
  // hands a note to a listener BEFORE its time so a jump can peak on it.
  const f = new LiveFeed();
  const out = f.emit(10000, state());
  assert.ok(out.length > 0, 'something must be emitted');
  for (const n of out) assert.ok(n.tMs > 10000, `note at ${n.tMs} is not in the future`);
});

test('nothing is emitted beyond the horizon', () => {
  const f = new LiveFeed();
  const out = f.emit(0, state());
  for (const n of out) {
    assert.ok(n.tMs <= EMIT_HORIZON_MS + 600, `note at ${n.tMs} is past the horizon`);
  }
});

test('no beat is ever emitted twice', () => {
  const f = new LiveFeed();
  const seen = new Set();
  for (let t = 0; t < 20000; t += 16) {
    for (const n of f.emit(t, state())) {
      if (n.role !== Role.RHYTHM || n.pitch !== 36) continue;
      const key = Math.round(n.tMs);
      assert.ok(!seen.has(key), `kick at ${key} emitted twice`);
      seen.add(key);
    }
  }
  assert.ok(seen.size > 20, 'a 20s run should have produced plenty of kicks');
});

test('emitted times are in order, so the conductor can just append', () => {
  const f = new LiveFeed();
  let last = -Infinity;
  for (let t = 0; t < 10000; t += 16) {
    for (const n of f.emit(t, state())) {
      assert.ok(n.tMs >= last, `out of order: ${n.tMs} after ${last}`);
      last = n.tMs;
    }
  }
});

test('the grid runs at the estimated tempo', () => {
  const f = new LiveFeed();
  f.emit(0, state({ bpm: 90 }));
  const kicks = [];
  for (let t = 0; t < 12000; t += 16) {
    // Filter on the kick FLAG, not the pitch: the bass line's root is also
    // MIDI 36, and only the role/flag distinguishes them.
    for (const n of f.emit(t, state({ bpm: 90 }))) if (n.kick) kicks.push(n.tMs);
  }
  // Kicks land on beats 1 and 3 of a 4/4 bar, so consecutive kicks are two
  // beats apart at 90bpm = 1333ms.
  const gaps = kicks.slice(1).map((v, i) => v - kicks[i]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  assert.ok(Math.abs(mean - 1333) < 60, `expected ~1333ms between kicks, got ${mean}`);
});

test('an onset near a predicted beat pulls the grid toward it', () => {
  const f = new LiveFeed();
  f.emit(0, state());
  const before = f.nextBeatMs;
  const moved = f.pushOnset(before + 40, 1);
  assert.equal(moved, true);
  assert.ok(f.nextBeatMs > before, 'the grid should have moved toward the onset');
  assert.ok(f.nextBeatMs < before + 40, 'and not jumped all the way to it');
});

test('a syncopated onset does not drag the grid onto the offbeat', () => {
  // Most produced music is busiest on the hi-hat. Pulling on every onset
  // would lock the grid to whatever subdivision that happens to be.
  const f = new LiveFeed();
  f.emit(0, state());
  const before = f.nextBeatMs;
  const offbeat = before + f.beatMs * (PHASE_CAPTURE + 0.15);
  assert.equal(f.pushOnset(offbeat, 1), false);
  assert.equal(f.nextBeatMs, before, 'the grid must not have moved');
});

test('repeated onsets at a steady offset converge the grid onto them', () => {
  const f = new LiveFeed();
  f.emit(0, state());
  const target = f.nextBeatMs + 50;
  for (let i = 0; i < 40; i++) f.pushOnset(target + i * f.beatMs, 1);
  const err = Math.abs(((f.nextBeatMs - target) % f.beatMs + f.beatMs) % f.beatMs);
  assert.ok(err < 12 || Math.abs(err - f.beatMs) < 12, `grid did not converge, residual ${err}ms`);
});

test('an onset before the first emit is ignored rather than throwing', () => {
  const f = new LiveFeed();
  assert.equal(f.pushOnset(1234, 1), false);
});

test('kicks are the only jumpable events', () => {
  // `kick: true` is what may drive a Midio jump. Marking every transient
  // would make him twitch continuously rather than dance.
  const f = new LiveFeed();
  const out = [];
  for (let t = 0; t < 8000; t += 16) out.push(...f.emit(t, state()));
  const kicks = out.filter((n) => n.kick);
  assert.ok(kicks.length > 0);
  for (const k of kicks) assert.equal(k.pitch, 36, 'only the kick drum is jumpable');
  const hats = out.filter((n) => n.pitch === 42);
  assert.ok(hats.length > 0, 'hats should still be emitted');
  for (const h of hats) assert.equal(h.kick, false);
});

test('a bass-only signal emits no hats and no melody', () => {
  const f = new LiveFeed();
  const low = { bpm: 120, confidence: 0.5, bands: [0.9, 0.8, 0.05, 0.02, 0.01, 0.01, 0.0], energy01: 0.3 };
  const out = [];
  for (let t = 0; t < 8000; t += 16) out.push(...f.emit(t, low));
  assert.equal(out.filter((n) => n.pitch === 42).length, 0, 'no top end, no hats');
  assert.equal(out.filter((n) => n.role === Role.MELODY).length, 0);
  assert.ok(out.filter((n) => n.role === Role.BASS).length > 0, 'the bass line should still play');
});

test('a long stall skips the backlog instead of grinding through it', () => {
  // A backgrounded tab must not come back and try to emit ten minutes of
  // notes into the past.
  const f = new LiveFeed();
  f.emit(0, state());
  const out = f.emit(600000, state());
  assert.ok(out.length < 40, `emitted ${out.length} notes after a stall`);
  assert.ok(f.nextBeatMs >= 600000, 'the grid must have caught up to now');
  for (const n of out) assert.ok(n.tMs > 590000, 'nothing from the skipped span');
});

test('every emitted note is a well-formed NoteEvent', () => {
  const f = new LiveFeed();
  const out = [];
  for (let t = 0; t < 4000; t += 16) out.push(...f.emit(t, state()));
  for (const n of out) {
    assert.ok(Number.isFinite(n.tMs) && n.tMs >= 0);
    assert.ok(n.pitch >= 0 && n.pitch <= 127, `pitch ${n.pitch} out of range`);
    assert.ok(n.vel >= 0 && n.vel <= 1, `vel ${n.vel} out of range`);
    assert.ok(Object.values(Role).includes(n.role));
    assert.equal(n.src, 'audio');
    assert.ok(n.durMs > 0);
  }
});
