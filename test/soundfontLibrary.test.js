import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SoundfontLibrary, SynthRouter } from '../src/audio/SoundfontLibrary.js';
import { buildMinimalSf2 } from './helpers/sf2Fixture.js';
import { buildStoredZip } from './helpers/zipFixture.js';

// --- Mock synths for SynthRouter tests ---

function makeMockSynth() {
  return {
    enabled: true,
    sf2: null,
    calls: 0,
    noteOn(evt) { this.calls++; },
    connectConductor() { return () => {}; },
    loadSf2(data) { this.sf2 = data; },
  };
}

// --- SoundfontLibrary ---

test('SoundfontLibrary starts empty', () => {
  const lib = new SoundfontLibrary();
  assert.equal(lib.count, 0);
  assert.equal(lib.active, null);
});

test('addBuffer parses and adds a font, auto-activating it', async () => {
  const lib = new SoundfontLibrary();
  await lib.addBuffer('test.sf2', buildMinimalSf2());
  assert.equal(lib.count, 1);
  assert.ok(lib.active);
  assert.equal(lib.active.name, 'TestFont'); // from INAM
});

test('addBuffer fires onChange when first font is added', async () => {
  const lib = new SoundfontLibrary();
  let called = false;
  lib.onChange = (active) => { called = true; assert.ok(active); };
  await lib.addBuffer('test.sf2', buildMinimalSf2());
  assert.ok(called);
});

test('cycle moves forward through fonts', async () => {
  const lib = new SoundfontLibrary();
  await lib.addBuffer('a.sf2', buildMinimalSf2('AlphaFont'));
  await lib.addBuffer('b.sf2', buildMinimalSf2('BetaFont'));
  assert.equal(lib.active.name, 'AlphaFont'); // first added is active
  lib.cycle(1);
  assert.equal(lib.active.name, 'BetaFont');
  lib.cycle(1);
  assert.equal(lib.active.name, 'AlphaFont'); // wraps around
});

test('cycle moves backward', async () => {
  const lib = new SoundfontLibrary();
  await lib.addBuffer('a.sf2', buildMinimalSf2('AlphaFont'));
  await lib.addBuffer('b.sf2', buildMinimalSf2('BetaFont'));
  lib.cycle(-1);
  assert.equal(lib.active.name, 'BetaFont'); // wraps backward to last
  lib.cycle(-1);
  assert.equal(lib.active.name, 'AlphaFont');
});

test('cycle notifies onChange', async () => {
  const lib = new SoundfontLibrary();
  await lib.addBuffer('a.sf2', buildMinimalSf2('AlphaFont'));
  await lib.addBuffer('b.sf2', buildMinimalSf2('BetaFont'));
  let lastActive = null;
  lib.onChange = (active) => { lastActive = active; };
  lib.cycle(1);
  assert.equal(lastActive.name, 'BetaFont');
});

test('addFiles extracts SF2 from a stored ZIP', async () => {
  const lib = new SoundfontLibrary();
  const sf2Data = new Uint8Array(buildMinimalSf2());
  const zip = buildStoredZip([{ name: 'inner.sf2', data: sf2Data }]);
  // Simulate a File object
  const file = { name: 'pack.zip', arrayBuffer: () => Promise.resolve(zip) };
  await lib.addFiles([file]);
  assert.equal(lib.count, 1);
  assert.equal(lib.active.name, 'TestFont'); // INAM from SF2 overrides filename
});

test('useDirectory scans a mock directory handle', async () => {
  const lib = new SoundfontLibrary();
  const sf2Data = new Uint8Array(buildMinimalSf2());

  // Mock FileSystemDirectoryHandle
  const dirHandle = {
    async *_values() {
      yield {
        kind: 'file',
        name: 'font.sf2',
        getFile: () => ({ arrayBuffer: () => Promise.resolve(sf2Data.buffer) }),
      };
    },
    values() { return this._values(); },
  };

  await lib.useDirectory(dirHandle);
  assert.equal(lib.count, 1);
  assert.equal(lib.active.name, 'TestFont');
});

test('rescanDirectory clears dir-sourced fonts and re-scans', async () => {
  const lib = new SoundfontLibrary();
  const sf2Data = new Uint8Array(buildMinimalSf2());
  const dirHandle = {
    async *_values() {
      yield {
        kind: 'file',
        name: 'font.sf2',
        getFile: () => ({ arrayBuffer: () => Promise.resolve(sf2Data.buffer) }),
      };
    },
    values() { return this._values(); },
  };

  await lib.useDirectory(dirHandle);
  assert.equal(lib.count, 1);
  await lib.rescanDirectory();
  assert.equal(lib.count, 1); // still 1, not 2 (dedup'd)
});

test('autoLoadFromServer loads every font listed in the manifest', async () => {
  const lib = new SoundfontLibrary();
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === '/soundfonts/') {
      return { ok: true, json: async () => ['a.sf2', 'b.sf2'] };
    }
    if (url.endsWith('a.sf2')) {
      return { ok: true, arrayBuffer: async () => buildMinimalSf2('AlphaFont') };
    }
    if (url.endsWith('b.sf2')) {
      return { ok: true, arrayBuffer: async () => buildMinimalSf2('BetaFont') };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const loaded = await lib.autoLoadFromServer('/soundfonts/');
    assert.equal(loaded, 2);
    assert.equal(lib.count, 2);
    assert.equal(lib.active.name, 'AlphaFont'); // first added auto-activates
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('autoLoadFromServer extracts SF2 fonts from a .zip listed in the manifest', async () => {
  const lib = new SoundfontLibrary();
  const sf2Data = new Uint8Array(buildMinimalSf2('ZippedFont'));
  const zip = buildStoredZip([{ name: 'inner.sf2', data: sf2Data }]);
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === '/soundfonts/') return { ok: true, json: async () => ['pack.zip'] };
    if (url.endsWith('pack.zip')) return { ok: true, arrayBuffer: async () => zip };
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const loaded = await lib.autoLoadFromServer('/soundfonts/');
    assert.equal(loaded, 1);
    assert.equal(lib.active.name, 'ZippedFont');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('autoLoadFromServer resolves to 0 (never throws) when the manifest 404s', async () => {
  const lib = new SoundfontLibrary();
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });
  try {
    const loaded = await lib.autoLoadFromServer('/soundfonts/');
    assert.equal(loaded, 0);
    assert.equal(lib.count, 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('autoLoadFromServer resolves to 0 (never throws) on a network error', async () => {
  const lib = new SoundfontLibrary();
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const loaded = await lib.autoLoadFromServer('/soundfonts/');
    assert.equal(loaded, 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('autoLoadFromServer resolves to 0 when the manifest is not a JSON array', async () => {
  const lib = new SoundfontLibrary();
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ oops: 'not an array' }) });
  try {
    const loaded = await lib.autoLoadFromServer('/soundfonts/');
    assert.equal(loaded, 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('autoLoadFromServer skips an unreadable file but keeps loading the rest', async () => {
  const lib = new SoundfontLibrary();
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === '/soundfonts/') return { ok: true, json: async () => ['broken.sf2', 'good.sf2'] };
    if (url.endsWith('broken.sf2')) return { ok: false };
    if (url.endsWith('good.sf2')) return { ok: true, arrayBuffer: async () => buildMinimalSf2('GoodFont') };
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const loaded = await lib.autoLoadFromServer('/soundfonts/');
    assert.equal(loaded, 1);
    assert.equal(lib.count, 1);
    assert.equal(lib.active.name, 'GoodFont');
  } finally {
    globalThis.fetch = origFetch;
  }
});

// --- SynthRouter ---

test('SynthRouter routes to fallback when no SF2 is loaded', () => {
  const fallback = makeMockSynth();
  const router = new SynthRouter(fallback);
  router.noteOn({ pitch: 60, vel: 0.8, role: 'MELODY', durMs: 200 });
  assert.equal(fallback.calls, 1);
});

test('SynthRouter routes to SF2 when a font is loaded', () => {
  const fallback = makeMockSynth();
  const sf2Engine = makeMockSynth();
  sf2Engine.sf2 = { presets: new Map() }; // simulate loaded font
  const router = new SynthRouter(fallback);
  router.setSf2Engine(sf2Engine);
  router.noteOn({ pitch: 60, vel: 0.8, role: 'MELODY', durMs: 200 });
  assert.equal(fallback.calls, 0);
  assert.equal(sf2Engine.calls, 1);
});

test('SynthRouter routes back to fallback after SF2 unload', () => {
  const fallback = makeMockSynth();
  const sf2Engine = makeMockSynth();
  const router = new SynthRouter(fallback);
  router.setSf2Engine(sf2Engine);
  // Load then unload
  sf2Engine.sf2 = { presets: new Map() };
  router.noteOn({ pitch: 60, vel: 0.8, role: 'MELODY', durMs: 200 });
  assert.equal(sf2Engine.calls, 1);
  sf2Engine.sf2 = null; // unload
  router.noteOn({ pitch: 60, vel: 0.8, role: 'MELODY', durMs: 200 });
  assert.equal(fallback.calls, 1);
});

test('SynthRouter current getter returns the active engine', () => {
  const fallback = makeMockSynth();
  const sf2Engine = makeMockSynth();
  const router = new SynthRouter(fallback);
  assert.equal(router.current, fallback);
  sf2Engine.sf2 = {};
  router.setSf2Engine(sf2Engine);
  assert.equal(router.current, sf2Engine);
});