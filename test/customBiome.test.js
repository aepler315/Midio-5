// Custom biome from MIDI + ParamBus history (MIDI restore + feature).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { midiToTimeline } from '../src/core/MidiAdapter.js';
import { generateCustomBiomeFromMidi, rememberCustomBiome } from '../src/world/BiomeImporter.js';
import { ParamBus } from '../src/core/ParamBus.js';
import { BIOMES } from '../src/world/BiomeProfiles.js';
import { buildMultiTrackPannedMidi, buildType0MultiChannelMidi } from './helpers/midiFixture.js';

function minimalMidiBuf() {
  // Reuse the multi-track fixture — real notes, roles, pans.
  // Fixture already returns an ArrayBuffer (not a Uint8Array).
  return buildMultiTrackPannedMidi();
}

test('generateCustomBiomeFromMidi returns a BiomeProfiles-shaped object', () => {
  const data = midiToTimeline(minimalMidiBuf());
  const biome = generateCustomBiomeFromMidi(data, 'demo-song.mid');
  assert.ok(biome.name.startsWith('CUSTOM:'));
  assert.ok(biome.id.startsWith('custom-'));
  assert.equal(biome.sky.length, 3);
  assert.match(biome.sky[0], /^#[0-9a-f]{6}$/i);
  assert.match(biome.silhouette, /^#[0-9a-f]{6}$/i);
  assert.ok(biome.celestial && biome.celestial.color);
  assert.ok(biome.particles && biome.particles.kind && biome.particles.count > 0);
  assert.ok(typeof biome.fx === 'string' && biome.fx.length > 0);
  assert.equal(biome.sourceFile, 'demo-song.mid');
  assert.ok(biome.derived.noteCount > 0);
});

test('same MIDI content yields the same custom biome id/name (deterministic)', () => {
  const a = generateCustomBiomeFromMidi(midiToTimeline(minimalMidiBuf()), 'x.mid');
  const b = generateCustomBiomeFromMidi(midiToTimeline(minimalMidiBuf()), 'x.mid');
  assert.equal(a.id, b.id);
  assert.equal(a.name, b.name);
  assert.deepEqual(a.sky, b.sky);
});

test('Type-0 multi-channel MIDI still produces a custom biome (drag path input)', () => {
  const data = midiToTimeline(buildType0MultiChannelMidi());
  assert.ok(data.timeline.length > 0, 'timeline must be non-empty for loadMidiFile');
  const biome = generateCustomBiomeFromMidi(data, 'type0.mid');
  assert.ok(biome.derived.noteCount === data.timeline.length);
  // Name is unique vs stock biomes so BiomeManager can register it safely.
  assert.ok(!BIOMES.some((b) => b.name === biome.name));
});

test('rememberCustomBiome prepends and dedupes by id on ParamBus', () => {
  const bus = new ParamBus();
  assert.deepEqual(bus.customBiomes, []);
  assert.equal(bus.rendererMode, 'canvas');

  const data = midiToTimeline(minimalMidiBuf());
  const biome = generateCustomBiomeFromMidi(data, 'a.mid');
  rememberCustomBiome(bus, biome);
  assert.equal(bus.customBiomes.length, 1);
  rememberCustomBiome(bus, biome); // same id — no duplicate
  assert.equal(bus.customBiomes.length, 1);
  rememberCustomBiome(bus, { ...biome, id: 'custom-other', name: 'CUSTOM:OTHER' });
  assert.equal(bus.customBiomes.length, 2);
  assert.equal(bus.customBiomes[0].id, 'custom-other');
});

test('ParamBus KEYS smoothing still works after customBiomes fields (no regression)', () => {
  const bus = new ParamBus();
  bus.propose({ jumpHeight: 1.2 }, 1);
  bus.step();
  assert.ok(bus.live.jumpHeight > 1);
  bus.reset();
  assert.equal(bus.live.jumpHeight, 1);
  // customBiomes is session history — reset does not clear it (by design).
  bus.customBiomes = [{ id: 'x' }];
  bus.reset();
  assert.equal(bus.customBiomes.length, 1);
});
