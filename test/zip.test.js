import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listZipEntries, extractZipEntry } from '../src/utils/zip.js';
import { buildZip } from './helpers/zipFixture.js';

const enc = new TextEncoder();

const storedData = new Uint8Array([0, 1, 2, 250, 251, 252, 127, 128, 42]);
const textData = enc.encode('SoundFonts inside zips inside tests. '.repeat(40));

test('listZipEntries walks the central directory', () => {
  const zip = buildZip([
    { name: 'fonts/one.sf2', data: storedData, method: 0 },
    { name: 'two.sf2', data: textData, method: 8 },
  ]);
  const entries = listZipEntries(zip);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'fonts/one.sf2');
  assert.equal(entries[0].method, 0);
  assert.equal(entries[0].size, storedData.length);
  assert.equal(entries[1].name, 'two.sf2');
  assert.equal(entries[1].method, 8);
  assert.equal(entries[1].size, textData.length);
  assert.ok(entries[1].compSize < textData.length, 'deflate actually compressed');
});

test('extractZipEntry returns stored entries byte-identical', async () => {
  const zip = buildZip([{ name: 'raw.sf2', data: storedData, method: 0 }]);
  const [entry] = listZipEntries(zip);
  const out = new Uint8Array(await extractZipEntry(zip, entry));
  assert.deepEqual([...out], [...storedData]);
});

test('extractZipEntry inflates deflate entries', async () => {
  const zip = buildZip([{ name: 'packed.sf2', data: textData, method: 8 }]);
  const [entry] = listZipEntries(zip);
  const out = new Uint8Array(await extractZipEntry(zip, entry));
  assert.equal(out.length, textData.length);
  assert.deepEqual([...out.subarray(0, 40)], [...textData.subarray(0, 40)]);
  assert.deepEqual([...out.subarray(-10)], [...textData.subarray(-10)]);
});

test('listZipEntries rejects non-zip data', () => {
  assert.throws(() => listZipEntries(new Uint8Array(64).buffer), /not a zip/);
});

test('extractZipEntry rejects unsupported compression methods', async () => {
  const zip = buildZip([{ name: 'weird.sf2', data: storedData, method: 0 }]);
  const [entry] = listZipEntries(zip);
  await assert.rejects(() => extractZipEntry(zip, { ...entry, method: 12 }), /unsupported zip method/);
});
