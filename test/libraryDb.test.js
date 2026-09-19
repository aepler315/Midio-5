// The library store's job is to make a folder choice survive a reload, and
// to make re-scanning that folder free. The second is the one with teeth:
// a rescan replaces every track under a root, so everything the player
// earned -- plays, auto-tags, cached durations -- has to be carried across
// deliberately or it is silently destroyed every time the folder is opened.
//
// Tested against an in-memory IndexedDB. The module takes its `scope` as an
// argument for exactly this reason, the same way AnalysisCache does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  libraryDbSupported, directoryHandlesSupported, rootIdFor, addRoot, listRoots, removeRoot,
  replaceTracks, listTracks, updateTrack, updateTracks, carryForward,
} from '../src/library/LibraryDB.js';
import { fakeIdb } from './helpers/fakeLibraryIdb.js';

function track(over = {}) {
  const rootId = over.rootId || 'r';
  const path = over.path || 'a.mp3';
  return {
    rootId, path, folder: '', name: 'a.mp3',
    ext: 'mp3', size: 100, lastModified: 5, addedMs: 1, title: null, artist: null, album: null,
    year: null, tagSource: 'filename', durationSec: null, playCount: 0, lastPlayedMs: 0,
    ...over,
    key: `${rootId}\u0000${path}`,
  };
}

test('no storage means no library, and no throwing either', async () => {
  const none = {};
  assert.equal(libraryDbSupported(none), false);
  assert.equal(libraryDbSupported(null), false);
  assert.equal(await addRoot({ name: 'Music' }, none), null);
  assert.deepEqual(await listRoots(none), []);
  assert.deepEqual(await listTracks(null, none), []);
  assert.equal(await replaceTracks('r', [track()], none), 0);
  assert.equal(await updateTrack('k', { playCount: 1 }, none), false);
  assert.equal(await removeRoot('r', none), false);
});

test('a failing open is the same as no storage', async () => {
  const scope = fakeIdb({ failOpen: true });
  assert.equal(await addRoot({ name: 'Music' }, scope), null);
  assert.deepEqual(await listTracks(null, scope), []);
});

test('only a browser that can hand back a persistable folder claims to', () => {
  assert.equal(directoryHandlesSupported({ showDirectoryPicker: () => {} }), true);
  // Firefox and Safari have webkitdirectory but no handle to store, and
  // the library must say so rather than promise a folder it cannot reopen.
  assert.equal(directoryHandlesSupported({}), false);
  assert.equal(directoryHandlesSupported(null), false);
});

test('the same folder chosen twice is one library, not two', async () => {
  const scope = fakeIdb();
  assert.equal(rootIdFor('Music'), rootIdFor('music'));
  await addRoot({ name: 'Music', handle: { h: 1 } }, scope);
  await addRoot({ name: 'Music', handle: { h: 2 } }, scope);
  const roots = await listRoots(scope);
  assert.equal(roots.length, 1);
  // The newer handle wins: it is the one the player just granted.
  assert.deepEqual(roots[0].handle, { h: 2 });
  assert.equal(roots[0].persistable, true);
});

test('a handle the browser refuses to store still leaves a remembered library', async () => {
  // A listing that needs the folder re-picked beats having no library at
  // all -- and the refusal arrives in two different shapes. A quota error
  // comes back later as an error event; an unclonable handle is thrown
  // straight out of put(). Both have to reach the same fallback.
  for (const refusal of [true, 'throw']) {
    const scope = fakeIdb({ rejectPut: (row, name) => (name === 'roots' && row.handle ? refusal : false) });
    const root = await addRoot({ name: 'Music', handle: { weird: true } }, scope);
    assert.ok(root, `refusal: ${refusal}`);
    assert.equal(root.handle, null);
    assert.equal(root.persistable, false);
    assert.equal((await listRoots(scope)).length, 1);
  }
});

test('a rescan drops files that are gone from disk', async () => {
  const scope = fakeIdb();
  await replaceTracks('r', [track({ path: 'a.mp3' }), track({ path: 'b.mp3' })], scope);
  assert.equal((await listTracks('r', scope)).length, 2);
  await replaceTracks('r', [track({ path: 'a.mp3' })], scope);
  assert.deepEqual((await listTracks('r', scope)).map((t) => t.path), ['a.mp3']);
});

test('a rescan keeps what the player earned and what the network paid for', async () => {
  const scope = fakeIdb();
  await replaceTracks('r', [track({ path: 'a.mp3' })], scope);
  await updateTrack('r\u0000a.mp3', {
    playCount: 7, lastPlayedMs: 500, durationSec: 210,
    title: 'Real Title', artist: 'Real Artist', tagSource: 'auto',
  }, scope);

  // The scanner knows nothing about any of that -- it re-reads the file and
  // offers a filename guess, as it did the first time.
  await replaceTracks('r', [track({ path: 'a.mp3', title: null, tagSource: 'filename' })], scope);
  const [row] = await listTracks('r', scope);
  assert.equal(row.playCount, 7);
  assert.equal(row.lastPlayedMs, 500);
  assert.equal(row.durationSec, 210);
  assert.equal(row.title, 'Real Title');
  assert.equal(row.tagSource, 'auto');
  assert.equal(row.addedMs, 1);
});

test('a file that changed on disk is re-tagged, not remembered', () => {
  const prior = { size: 100, lastModified: 5, tagSource: 'auto', title: 'Old Auto', artist: 'Old', album: 'Old', playCount: 3, addedMs: 9, durationSec: 100 };
  // Whatever edited the file also edited its tags, so the fresh read wins.
  const edited = carryForward(prior, { size: 120, lastModified: 9, tagSource: 'filename', title: 'New', artist: null, album: null, durationSec: null });
  assert.equal(edited.title, 'New');
  assert.equal(edited.tagSource, 'filename');
  // The play history is the player's, not the file's, and survives either way.
  assert.equal(edited.playCount, 3);
  assert.equal(edited.addedMs, 9);
  assert.equal(edited.durationSec, 100);

  // A real embedded tag always beats a remembered auto-tag.
  const retagged = carryForward(prior, { size: 100, lastModified: 5, tagSource: 'tags', title: 'Proper', artist: 'Proper', album: 'Proper' });
  assert.equal(retagged.title, 'Proper');
  assert.equal(retagged.tagSource, 'tags');
});

test('forgetting a folder forgets its tracks and only its tracks', async () => {
  const scope = fakeIdb();
  await addRoot({ name: 'A', handle: {} }, scope);
  await addRoot({ name: 'B', handle: {} }, scope);
  await replaceTracks(rootIdFor('A'), [track({ rootId: rootIdFor('A'), path: 'a.mp3' })], scope);
  await replaceTracks(rootIdFor('B'), [track({ rootId: rootIdFor('B'), path: 'b.mp3' })], scope);

  assert.equal(await removeRoot(rootIdFor('A'), scope), true);
  assert.deepEqual((await listRoots(scope)).map((r) => r.name), ['B']);
  assert.deepEqual((await listTracks(null, scope)).map((t) => t.path), ['b.mp3']);
});

test('a batch of patches merges into the rows it names and skips the rest', async () => {
  const scope = fakeIdb();
  await replaceTracks('r', [track({ path: 'a.mp3' }), track({ path: 'b.mp3' })], scope);
  const n = await updateTracks([
    { key: 'r\u0000a.mp3', artist: 'Tagged', tagSource: 'auto' },
    { key: 'r\u0000missing.mp3', artist: 'Nobody' },
  ], scope);
  assert.equal(n, 1);
  const rows = await listTracks('r', scope);
  assert.equal(rows.find((t) => t.path === 'a.mp3').artist, 'Tagged');
  // A patch must merge, not replace: nothing else about the row moved.
  assert.equal(rows.find((t) => t.path === 'a.mp3').path, 'a.mp3');
  assert.equal(rows.find((t) => t.path === 'b.mp3').artist, null);
  assert.equal(await updateTracks([], scope), 0);
  assert.equal(await updateTrack('r\u0000missing.mp3', { artist: 'x' }, scope), false);
});
