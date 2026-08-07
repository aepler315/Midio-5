// The conductor track (ConductorTrack.js): a percussion track the player
// authors in Guitar Pro that is read as a cue sheet and never sounded.
// These cover the schema itself (pitch -> cue, velocity -> parameter), the
// schedule fold into the section plan, and the MIDI-adapter guarantee that
// the track never reaches the musical pipeline at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isConductorTrackName, velocityBucket, cueValue, cuesFromNotes, splitCues,
  transitionForBucket, applyConductorSchedule, CueKind, CUE_BY_PITCH, BIOME_BANKS,
} from '../src/core/ConductorTrack.js';
import { midiToTimeline } from '../src/core/MidiAdapter.js';
import { BIOMES } from '../src/world/BiomeProfiles.js';
import { KINDS as WEATHER_KINDS } from '../src/sim/WeatherDirector.js';
import { vlq, buildTrackChunk, strBytes } from './helpers/midiFixture.js';

// --- Track identification -------------------------------------------------

test('a track is the conductor guide when its name says so', () => {
  for (const name of ['Conductor', 'conductor', '  CONDUCTOR', 'Cue', 'cues', 'Conductor Track']) {
    assert.ok(isConductorTrackName(name), `${name} should be recognized`);
  }
});

test('ordinary track names are never mistaken for the conductor guide', () => {
  for (const name of ['Drums', 'Lead Guitar', 'Bass', 'Percussion', '', null, undefined, 'Conductors Choice']) {
    assert.ok(!isConductorTrackName(name), `${JSON.stringify(name)} must not be treated as a cue sheet`);
  }
  // A word merely STARTING with "cue" isn't a cue track -- \b guards it.
  assert.ok(!isConductorTrackName('Cuebana Horns'));
});

// --- Velocity as the parameter axis ---------------------------------------

test("velocityBucket recovers Guitar Pro's eight dynamic marks exactly", () => {
  // ppp pp p mp mf f ff fff, as Guitar Pro writes them.
  const gpVelocities = [15, 31, 47, 63, 79, 95, 111, 127];
  gpVelocities.forEach((v, i) => {
    assert.equal(velocityBucket(v), i + 1, `velocity ${v} should be dynamic ${i + 1}`);
  });
});

test('velocityBucket clamps rather than throwing on junk or out-of-range input', () => {
  assert.equal(velocityBucket(0), 1);
  assert.equal(velocityBucket(-40), 1);
  assert.equal(velocityBucket(999), 8);
  assert.equal(velocityBucket(NaN), 1);
  assert.equal(velocityBucket(undefined), 1);
});

// --- The schema itself ----------------------------------------------------

test('every mapped pitch resolves to a real cue kind', () => {
  const kinds = new Set(Object.values(CueKind));
  for (const [pitch, kind] of Object.entries(CUE_BY_PITCH)) {
    assert.ok(kinds.has(kind), `pitch ${pitch} maps to unknown kind ${kind}`);
  }
});

test('every biome bank slot names a profile that actually exists', () => {
  const known = new Set(BIOMES.map((b) => b.name));
  for (const [pitch, bank] of Object.entries(BIOME_BANKS)) {
    for (const name of bank) {
      assert.ok(known.has(name), `bank ${pitch} names unknown biome ${name}`);
    }
  }
});

test('the biome banks address every profile the game ships, with no duplicates', () => {
  const banked = Object.values(BIOME_BANKS).flat();
  assert.equal(new Set(banked).size, banked.length, 'a profile is addressed from two slots');
  const known = new Set(BIOMES.map((b) => b.name));
  for (const name of known) {
    assert.ok(banked.includes(name), `${name} is unreachable from any bank/dynamic pair`);
  }
});

test('section transition style rises with the written dynamic', () => {
  assert.equal(transitionForBucket(1), 'fade');
  assert.equal(transitionForBucket(3), 'fade');
  assert.equal(transitionForBucket(4), 'cut');
  assert.equal(transitionForBucket(6), 'cut');
  assert.equal(transitionForBucket(7), 'shutter');
  assert.equal(transitionForBucket(8), 'shutter');
});

test('every weather bucket names a kind WeatherDirector actually accepts', () => {
  for (let b = 1; b <= 8; b++) {
    assert.ok(WEATHER_KINDS.includes(cueValue(CueKind.WEATHER, 69, b)), `bucket ${b} names an unknown kind`);
  }
});

test('continuous cues read the dynamic as a 0..1 strength', () => {
  assert.equal(cueValue(CueKind.SHAKE, 41, 8), 1);
  assert.equal(cueValue(CueKind.SHAKE, 41, 4), 0.5);
  assert.ok(cueValue(CueKind.FEVER, 54, 1) > 0, 'the softest mark must still do something');
});

// --- Parsing notes into cues ----------------------------------------------

const note = (pitch, startMs, vel = 95, durMs = 100) => ({ pitch, startMs, vel, durMs });

test('cuesFromNotes maps pitch to cue and velocity to parameter', () => {
  const cues = cuesFromNotes([
    note(49, 1000, 127),  // Crash 1, fff -> section boundary, shutter
    note(75, 1000, 31),   // Claves, pp -> biome bank A slot 2
    note(46, 2000, 95),   // Open hat, f -> meteors at 0.75
  ]);
  assert.equal(cues.length, 3);
  assert.deepEqual(
    cues.map((c) => [c.kind, c.value]),
    [[CueKind.SECTION, 'shutter'], [CueKind.BIOME, 'EMBER'], [CueKind.METEORS, 0.75]],
  );
});

test('an unmapped drum is ignored rather than treated as an error', () => {
  // 38 (snare) is deliberately NOT in the schema -- a player sketching ideas
  // on the cue track shouldn't have the load fail.
  const cues = cuesFromNotes([note(38, 500), note(49, 1000)]);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].kind, CueKind.SECTION);
});

test('a biome cue addressing an empty bank slot is dropped, not snapped to a wrong biome', () => {
  // Bank C (77) holds one profile; anything above ppp addresses nothing.
  assert.equal(cuesFromNotes([note(77, 0, 15)]).length, 1, 'ppp addresses GEODE');
  assert.equal(cuesFromNotes([note(77, 0, 127)]).length, 0, 'fff addresses nothing in bank C');
});

test('cues come back in time order even when the notes did not', () => {
  const cues = cuesFromNotes([note(49, 5000), note(49, 1000), note(49, 3000)]);
  assert.deepEqual(cues.map((c) => c.tMs), [1000, 3000, 5000]);
});

test('splitCues separates the build-time half from the live half', () => {
  const { schedule, live } = splitCues(cuesFromNotes([
    note(49, 0), note(75, 0, 15), note(52, 1000), note(54, 2000),
  ]));
  assert.deepEqual(schedule.map((c) => c.kind), [CueKind.SECTION, CueKind.BIOME]);
    assert.deepEqual(live.map((c) => c.kind), [CueKind.APOTHEOSIS, CueKind.FEVER]);
});

// --- Folding the schedule onto the section plan ---------------------------

const barGrid = Array.from({ length: 21 }, (_, i) => ({ ms: i * 1000 }));
const basePlan = [
  { startMs: 0, endMs: 10000, transition: 'fade', profile: 'TWILIGHT', label: 'A' },
  { startMs: 10000, endMs: 20000, transition: 'fade', profile: 'JADE', label: 'B' },
];

test('absent cues is a true no-op -- the same array reference comes back', () => {
  assert.strictEqual(applyConductorSchedule(basePlan, [], barGrid, 20000), basePlan);
  assert.strictEqual(applyConductorSchedule(basePlan, null, barGrid, 20000), basePlan);
});

test('a section cue cuts a boundary at its own beat and sets the transition style', () => {
  const cues = cuesFromNotes([note(49, 5000, 127)]); // fff -> shutter
  const out = applyConductorSchedule(basePlan, cues, barGrid, 20000);
  const boundary = out.find((s) => s.startMs === 5000);
  assert.ok(boundary, 'expected a section starting at the cued beat');
  assert.equal(boundary.transition, 'shutter');
  assert.ok(boundary.cued);
});

test('a cued boundary snaps to the bar grid', () => {
  const cues = cuesFromNotes([note(49, 5120)]); // 120ms off the bar line
  const out = applyConductorSchedule(basePlan, cues, barGrid, 20000);
  assert.ok(out.some((s) => s.startMs === 5000), 'boundary should snap to the nearest bar');
});

test('the plan never mutates -- the detected schedule is left intact', () => {
  const snapshot = JSON.parse(JSON.stringify(basePlan));
  applyConductorSchedule(basePlan, cuesFromNotes([note(49, 5000), note(75, 0, 47)]), barGrid, 20000);
  assert.deepEqual(basePlan, snapshot);
});

test('a new cued section inherits the detected read of that moment', () => {
  const out = applyConductorSchedule(basePlan, cuesFromNotes([note(49, 15000)]), barGrid, 20000);
  const sec = out.find((s) => s.startMs === 15000);
  // 15000 sat inside the detected 'B'/JADE section, so the cued split keeps
  // everything the analysis already knew there rather than resetting it.
  assert.equal(sec.label, 'B');
  assert.equal(sec.profile, 'JADE');
});

test('a biome cue overrides the profile of the section containing it', () => {
  const out = applyConductorSchedule(basePlan, cuesFromNotes([note(76, 12000, 15)]), barGrid, 20000);
  const sec = out.find((s) => s.startMs <= 12000 && s.endMs > 12000);
  assert.equal(sec.profile, 'MIRROR'); // bank B slot 1
  assert.ok(sec.cuedBiome);
});

test('boundaries too close together collapse instead of making unreadable slivers', () => {
  // Three crashes inside 200ms -- an authoring slip, not three sections.
  const cues = cuesFromNotes([note(49, 5000), note(49, 5050), note(49, 5100)]);
  const out = applyConductorSchedule(basePlan, cues, barGrid, 20000);
  for (const s of out) {
    assert.ok(s.endMs - s.startMs >= 500, `section ${s.startMs}-${s.endMs} is a sliver`);
  }
});

test('an opening section cue never shutters into frame from nothing', () => {
  const out = applyConductorSchedule(basePlan, cuesFromNotes([note(49, 0, 127)]), barGrid, 20000);
  assert.notEqual(out[0].transition, 'shutter');
});

test('sections stay contiguous and cover the whole song after a fold', () => {
  const out = applyConductorSchedule(
    basePlan, cuesFromNotes([note(49, 4000), note(49, 12000)]), barGrid, 20000,
  );
  assert.equal(out[0].startMs, 0);
  assert.equal(out[out.length - 1].endMs, 20000);
  for (let i = 1; i < out.length; i++) assert.equal(out[i].startMs, out[i - 1].endMs);
});

// --- The MIDI adapter's exclusion guarantee -------------------------------

/** A two-track SMF: one ordinary melody track, one named conductor track
 *  carrying percussion cues on channel 10 (index 9), as Guitar Pro exports. */
function buildScoredMidi() {
  const ppqn = 96;
  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6,
    0, 1, // format 1
    0, 2, // 2 tracks
    (ppqn >> 8) & 0xff, ppqn & 0xff,
  ];

  const lead = [];
  lead.push([...vlq(0), 0xff, 0x03, 4, ...strBytes('Lead')]);
  lead.push([...vlq(0), 0xff, 0x51, 3, 0x07, 0xa1, 0x20]); // 120 BPM
  lead.push([...vlq(0), 0xff, 0x58, 4, 4, 2, 24, 8]);
  for (let i = 0; i < 8; i++) {
    lead.push([...vlq(i === 0 ? 0 : 48), 0x90, 60 + i, 100]);
    lead.push([...vlq(48), 0x80, 60 + i, 0]);
  }
  lead.push([...vlq(0), 0xff, 0x2f, 0]);

  const cue = [];
  cue.push([...vlq(0), 0xff, 0x03, 9, ...strBytes('Conductor')]);
  // Crash 1 at tick 192 (t=1000ms) at fff -> section boundary, shutter
  cue.push([...vlq(192), 0x99, 49, 127]);
  cue.push([...vlq(24), 0x89, 49, 0]);
  // Chinese cymbal at tick 384 (t=2000ms) -> apotheosis
  cue.push([...vlq(168), 0x99, 52, 95]);
  cue.push([...vlq(24), 0x89, 52, 0]);
  cue.push([...vlq(0), 0xff, 0x2f, 0]);

  return new Uint8Array([
    ...header, ...buildTrackChunk(lead), ...buildTrackChunk(cue),
  ]).buffer;
}

test('the conductor track never reaches the timeline, the track list, or the chart', () => {
  const { timeline, tracks, conductor } = midiToTimeline(buildScoredMidi());
  assert.ok(conductor, 'expected a cue sheet');
  // Only the musical track survives into anything downstream.
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].name, 'Lead');
  assert.ok(!timeline.some((e) => e.channel === 9), 'no cue note may enter the timeline');
  assert.ok(!timeline.some((e) => e.pitch === 49 || e.pitch === 52), 'cue pitches must not be playable notes');
});

test('conductor cues survive parsing with their authored timing and dynamics', () => {
  const { conductor } = midiToTimeline(buildScoredMidi());
  assert.deepEqual(conductor.names, ['Conductor']);
  assert.equal(conductor.cues.length, 2);

  const [section, apotheosis] = conductor.cues;
  assert.equal(section.kind, CueKind.SECTION);
  assert.equal(Math.round(section.tMs), 1000);
  assert.equal(section.value, 'shutter'); // fff was written, fff is read

  assert.equal(apotheosis.kind, CueKind.APOTHEOSIS);
  assert.equal(Math.round(apotheosis.tMs), 2000);
});

test('cues arrive pre-split into the schedule and live halves', () => {
  const { conductor } = midiToTimeline(buildScoredMidi());
  assert.deepEqual(conductor.scheduleCues.map((c) => c.kind), [CueKind.SECTION]);
  assert.deepEqual(conductor.liveCues.map((c) => c.kind), [CueKind.APOTHEOSIS]);
});

test('a MIDI with no conductor track reports none, and is otherwise untouched', () => {
  const { conductor, tracks } = midiToTimeline(buildScoredMidi());
  assert.ok(conductor); // sanity: the fixture above does have one

  // Same fixture with the cue track renamed to an ordinary drum track: it
  // becomes a normal musical track again and no cue sheet is produced.
  const ppqn = 96;
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, (ppqn >> 8) & 0xff, ppqn & 0xff];
  const drums = [];
  drums.push([...vlq(0), 0xff, 0x03, 5, ...strBytes('Drums')]);
  drums.push([...vlq(0), 0xff, 0x51, 3, 0x07, 0xa1, 0x20]);
  drums.push([...vlq(192), 0x99, 49, 127]);
  drums.push([...vlq(24), 0x89, 49, 0]);
  drums.push([...vlq(0), 0xff, 0x2f, 0]);
  const plain = midiToTimeline(new Uint8Array([...header, ...buildTrackChunk(drums)]).buffer);

  assert.equal(plain.conductor, null);
  assert.ok(plain.timeline.length > 0, 'the drum notes stay playable music');
  assert.notEqual(tracks.length, 0);
});
