import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SoundfontLibrary, SynthRouter } from '../src/audio/SoundfontLibrary.js';
import { buildTestSf2 } from './helpers/sf2Fixture.js';
import { buildZip } from './helpers/zipFixture.js';

test('addBuffer parses a bare .sf2 and activates it', async () => {
  const lib = new SoundfontLibrary();
  const seen = [];
  lib.onChange = (f) => seen.push(f ? f.name : null);

  await lib.addBuffer(buildTestSf2(), 'MyUpload.sf2');
  assert.equal(lib.fonts.length, 1);
  assert.equal(lib.fonts[0].name, 'TestFont'); // INAM wins over the filename
  assert.equal(lib.activeIdx, 0);
  assert.deepEqual(seen, ['TestFont']);
  assert.ok(lib.active.parsed.presets.get(0), 'parsed presets reachable');
});

test('addBuffer unpacks every .sf2 inside a zip', async () => {
  const lib = new SoundfontLibrary();
  const sf2 = new Uint8Array(buildTestSf2());
  const zip = buildZip([
    { name: 'pack/alpha.sf2', data: sf2, method: 0 },
    { name: 'pack/beta.sf2', data: sf2, method: 8 },
    { name: 'readme.txt', data: new TextEncoder().encode('not a font'), method: 0 },
  ]);
  await lib.addBuffer(zip, 'fonts.zip');
  assert.equal(lib.fonts.length, 2); // readme skipped
  assert.equal(lib.activeIdx, 0);
});

test('addFiles filters to .sf2/.zip and survives corrupt entries', async () => {
  const lib = new SoundfontLibrary();
  const files = [
    new File([buildTestSf2()], 'good.sf2'),
    new File([new Uint8Array(200)], 'broken.sf2'), // parse fails, skipped with a warning
    new File([new Uint8Array(10)], 'song.mid'),    // wrong extension, ignored
  ];
  await lib.addFiles(files);
  assert.equal(lib.fonts.length, 1);
  assert.equal(lib.fonts[0].name, 'TestFont');
});

test('cycle wraps in both directions and emits', async () => {
  const lib = new SoundfontLibrary();
  await lib.addBuffer(buildTestSf2(), 'a.sf2');
  await lib.addBuffer(buildTestSf2(), 'b.sf2');
  await lib.addBuffer(buildTestSf2(), 'c.sf2');

  const seen = [];
  lib.onChange = () => seen.push(lib.activeIdx);

  lib.cycle(1);
  lib.cycle(1);
  lib.cycle(1); // wraps to 0
  lib.cycle(-1); // wraps back to last
  assert.deepEqual(seen, [1, 2, 0, 2]);

  const empty = new SoundfontLibrary();
  empty.onChange = () => { throw new Error('must not emit with no fonts'); };
  empty.cycle(1); // no-op
});

test('SynthRouter falls back to the oscillator synth and swaps live', () => {
  const fallbackNotes = [];
  const sf2Notes = [];
  const router = new SynthRouter({ noteOn: (e) => fallbackNotes.push(e) });

  const conductorStub = {
    handler: null,
    on(type, fn) { this.handler = fn; return () => {}; },
  };
  router.connectConductor(conductorStub);

  conductorStub.handler({ pitch: 60 });
  assert.equal(fallbackNotes.length, 1);

  router.sf2 = { noteOn: (e) => sf2Notes.push(e) };
  conductorStub.handler({ pitch: 64 });
  assert.equal(fallbackNotes.length, 1, 'fallback silent once a font is live');
  assert.equal(sf2Notes.length, 1);

  router.sf2 = null; // font removed -> fallback again
  conductorStub.handler({ pitch: 67 });
  assert.equal(fallbackNotes.length, 2);

  router.enabled = false;
  conductorStub.handler({ pitch: 69 });
  assert.equal(fallbackNotes.length, 2, 'disabled router mutes everything');
});
