// End-to-end pure-logic check on the timeline pipeline (regression for the
// PR #7 UTF-16 corruption that broke module parse of ParamBus/Renderer).
//
// The MIDI *upload* path is gone -- audio is the only input now -- but
// MidiAdapter and BiomeImporter are still the machinery a dropped song's
// timeline and custom biome are built by, so the pipeline below is live code
// and worth pinning. The fixture is a synthetic MIDI buffer purely because
// it is the cheapest deterministic way to make a timeline.
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

test('playing a decoded recording mutes the timeline synth (no keyboard/click layer)', () => {
  const text = readFileSync(join(root, 'src/main.js'), 'utf8');
  // Live listening mutes it for the same reason from the other direction --
  // the song is already in the room -- so the condition covers both. The
  // assertion is on the intent (a recording never gets a synth layer on top),
  // not on one exact spelling of the guard.
  assert.ok(
    /if \(playBuffer[^)]*\) muteTimelineSynth = true/.test(text),
    'startTimeline must mute the synth whenever a recording is about to play',
  );
  const confirm = text.slice(text.indexOf('function confirmWorld'), text.indexOf('function startTimeline'));
  assert.ok(
    confirm.includes('muteTimelineSynth = true'),
    'confirming a world on a recording must mute the synth before start',
  );
});

test('audio load path in main.js offers worlds instead of starting immediately', () => {
  // Anchored on the function itself rather than on whatever follows it: this
  // used to slice up to `loadDemo`, and the demo is gone -- audio is the only
  // input now, so there is nothing after it to anchor against.
  const text = readFileSync(join(root, 'src/main.js'), 'utf8');
  const start = text.indexOf('async function loadAudioFiles');
  assert.ok(start >= 0, 'loadAudioFiles should exist');
  let i = text.indexOf('{', start), depth = 0, end = -1;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.ok(end > start, 'could not find the end of loadAudioFiles');
  const body = text.slice(start, end);
  assert.ok(body.includes('offerWorldsThenStart'), 'dropped audio must reach the world select screen');
  assert.ok(
    !/startTimeline\(data\);/.test(body),
    'dropped audio must not skip world select by calling startTimeline directly',
  );
});
