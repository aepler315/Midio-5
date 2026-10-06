import { test } from 'node:test';
import assert from 'node:assert/strict';

// Removing a pinned checkpoint, relaxing path validation, or wrapping an
// endpoint must fail these public contracts, independently of adapter code.
import * as checkpointsModule from '../tools/version-checkpoints.mjs';
import * as catalogModule from '../src/ui/VersionCatalog.js';
const expected = [
  ['glacial-flight', 'Glacial valley', 338, 'bbe0afcae722c59c774b5c7396b55cfa4342c616'],
  ['range-before-journey', 'Original Range', 391, '7383b3b34c4f5e1f3cf062fb6078178aaa24a0b6'],
  ['moonlit-cove', 'Moonlit cove', 396, '70c9cb8f8fa1aae40a51060b1d2f132af9ee5ca4'],
  ['traveling-valley', 'Traveling valley', 397, '316e50ea1db66c185d194f511a8a1cc62bb7a936'],
  ['detailed-valley', 'Detailed valley', 398, 'be8d0c4c0bd33e3839ba2a8b6f154a9e38e0ebef'],
  ['natural-valley', 'Mountain valley', 399, '7557f85bae8e4f7d61f5fd9d8d628d52c052565c'],
  ['circular-world', 'Circular world', 400, '4c61f72d4cb782822fcabf5d2b1c8e785cc13e16'],
  ['spherical-world', 'Curved landscape', 402, 'a901332676557d33536d2cbbd1e1a4da9de4a4ca'],
];
const fixture = () => ({
  schema: 1,
  buildSha: 'a47b5b32e63da4fbfa5e2c003dcef26ed16cd453',
  liveId: 'natural-valley',
  entries: expected.map(([id, label, sourcePr, sourceSha]) => ({
    id, label, sourcePr, sourceSha, live: id === 'natural-valley',
    entryPath: id === 'natural-valley' ? './' : `versions/${id}/`,
  })),
});
function api() {
  assert.ok(catalogModule, 'VersionCatalog contract is not implemented');
  return catalogModule;
}

test('catalog pins exactly eight immutable checkpoints in visual order', () => {
  assert.ok(checkpointsModule, 'immutable checkpoint catalog is not implemented');
  assert.deepEqual(checkpointsModule.CHECKPOINTS.map(({ id, label, sourcePr, sourceSha }) =>
    [id, label, sourcePr, sourceSha]), expected);
  assert.equal(checkpointsModule.LIVE_ID, 'natural-valley');
  assert.ok(Object.isFrozen(checkpointsModule.CHECKPOINTS));
  for (const entry of checkpointsModule.CHECKPOINTS) {
    assert.ok(Object.isFrozen(entry));
    assert.match(entry.compatibilityProfile, /^[a-z0-9-]+$/);
    for (const file of ['src/main.js', 'index.html', 'src/ui/style.css', 'src/audio/AnalysisCache.js']) {
      assert.match(entry.sourceHashes[file], /^[a-f0-9]{64}$/);
    }
  }
});

test('manifest has one live checkpoint and preserves its authored order', () => {
  const manifest = api().validateVersionManifest(fixture());
  assert.deepEqual(manifest.entries.map((e) => e.id), expected.map((e) => e[0]));
  assert.equal(manifest.entries.filter((e) => e.live).length, 1);
  assert.equal(manifest.entries.find((e) => e.live).entryPath, './');
});

test('live #399 neighbors are #398 and #400', () => {
  const { previous, next } = api().getVersionNeighbors(fixture(), 'natural-valley');
  assert.equal(previous.sourcePr, 398);
  assert.equal(next.sourcePr, 400);
});

test('endpoint neighbors do not wrap', () => {
  assert.equal(api().getVersionNeighbors(fixture(), 'glacial-flight').previous, null);
  assert.equal(api().getVersionNeighbors(fixture(), 'spherical-world').next, null);
});

test('unknown checkpoint IDs never become destinations', () => {
  assert.throws(() => api().getVersionNeighbors(fixture(), 'unknown'), /unknown/i);
  assert.throws(() => api().resolveVersionUrl(fixture(), 'unknown', 'https://midio.test/'), /unknown/i);
});

test('duplicate IDs, missing live and duplicate live entries fail closed', () => {
  const duplicate = fixture();
  duplicate.entries[1] = { ...duplicate.entries[0] };
  assert.throws(() => api().validateVersionManifest(duplicate), /duplicate/i);
  const missing = fixture(); missing.entries[5].live = false;
  assert.throws(() => api().validateVersionManifest(missing), /live/i);
  const two = fixture(); two.entries[0].live = true;
  assert.throws(() => api().validateVersionManifest(two), /live/i);
  const wrong = fixture(); wrong.liveId = 'unknown';
  assert.throws(() => api().validateVersionManifest(wrong), /live/i);
});

test('schema, SHA, ID, label, PR and flag types are validated', () => {
  for (const mutate of [
    (m) => { m.schema = 2; }, (m) => { m.buildSha = 'main'; },
    (m) => { m.entries[0].sourceSha = 'bbe0afc'; },
    (m) => { m.entries[0].id = '../escape'; },
    (m) => { m.entries[0].label = ''; },
    (m) => { m.entries[0].sourcePr = '#338'; },
    (m) => { m.entries[0].live = 'false'; },
  ]) {
    const value = fixture(); mutate(value);
    assert.throws(() => api().validateVersionManifest(value));
  }
  for (const value of [null, [], {}, { ...fixture(), entries: [] }]) {
    assert.throws(() => api().validateVersionManifest(value));
  }
});

test('traversal, origin-relative, off-origin and disguised entry paths fail closed', () => {
  for (const entryPath of [
    '../escape/', '/versions/glacial-flight/', 'https://evil.test/', '//evil.test/',
    'versions/../escape/', 'versions/%2e%2e/escape/', 'versions\\glacial-flight\\',
    'versions/glacial-flight/?target=evil', 'versions/glacial-flight/#evil',
    'versions/glacial-flight/%2fescape/', 'versions/other/',
  ]) {
    const value = fixture(); value.entries[0].entryPath = entryPath;
    assert.throws(() => api().validateVersionManifest(value), /path/i, entryPath);
  }
  const live = fixture(); live.entries[5].entryPath = 'versions/natural-valley/';
  assert.throws(() => api().validateVersionManifest(live), /path/i);
});

test('destinations resolve under both origin and project roots', () => {
  for (const prefix of ['/', '/Midio-5/']) {
    const root = new URL(`https://midio.test${prefix}`);
    assert.equal(api().resolveVersionUrl(fixture(), 'natural-valley', root).href, root.href);
    assert.equal(api().resolveVersionUrl(fixture(), 'circular-world', root).href,
      `https://midio.test${prefix}versions/circular-world/`);
  }
});

test('site root requires a clean http(s) directory on the current origin when known', () => {
  for (const root of ['https://midio.test/Midio-5', 'https://midio.test/?q=x',
    'https://midio.test/#hash', 'file:///tmp/', 'https://user:pass@midio.test/']) {
    assert.throws(() => api().resolveVersionUrl(fixture(), 'natural-valley', root), /root/i);
  }
  const saved = globalThis.location;
  globalThis.location = new URL('https://midio.test/Midio-5/');
  try {
    assert.throws(() => api().resolveVersionUrl(fixture(), 'natural-valley', 'https://evil.test/'), /origin/i);
  } finally {
    if (saved === undefined) delete globalThis.location;
    else globalThis.location = saved;
  }
});
