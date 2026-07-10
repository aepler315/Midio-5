// End-to-end pure-logic check that the MIDI load path used by drag/upload
// still produces a playable timeline + custom biome (regression for the
// PR #7 UTF-16 corruption that broke module parse of ParamBus/Renderer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { midiToTimeline } from '../src/core/MidiAdapter.js';
import { synthesizeEnergyCurves } from '../src/core/EnergyCurvesSynth.js';
import { generateCustomBiomeFromMidi } from '../src/world/BiomeImporter.js';
import { buildMultiTrackPannedMidi } from './helpers/midiFixture.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('core modules corrupted by PR #7 parse cleanly (no null-byte garbage)', () => {
  for (const rel of [
    'src/core/ParamBus.js',
    'src/render/Renderer.js',
    'src/world/BiomeManager.js',
    'src/main.js',
  ]) {
    const buf = readFileSync(join(root, rel));
    assert.equal(buf.includes(0), false, `${rel} must not contain null bytes`);
    const text = buf.toString('utf8');
    // main.js is a bootstrap module (side-effect imports); others re-export.
    assert.ok(
      text.includes('export ') || text.includes('import '),
      `${rel} should be valid ES module source`,
    );
  }
});

test('MIDI load pipeline: parse → energy curves → custom biome (drag/upload path)', () => {
  const buf = buildMultiTrackPannedMidi();
  const data = midiToTimeline(buf);
  assert.ok(Array.isArray(data.timeline) && data.timeline.length > 0);
  assert.ok(data.durationMs > 0);
  assert.ok(Array.isArray(data.tracks) && data.tracks.length > 0);

  data.energyCurves = synthesizeEnergyCurves(data.timeline, data.durationMs);
  assert.ok(data.energyCurves);
  assert.equal(typeof data.energyCurves.sample, 'function');
  // Sample mid-song energy without throwing
  const e0 = data.energyCurves.sample(0, data.durationMs * 0.5);
  assert.ok(Number.isFinite(e0));

  data.customBiome = generateCustomBiomeFromMidi(data, 'upload.mid');
  assert.ok(data.customBiome.name.startsWith('CUSTOM:'));
  assert.ok(data.customBiome.derived.noteCount === data.timeline.length);
});
