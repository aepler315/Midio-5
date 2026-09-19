// The sequencing layer: choose a folder, scan it, get back from a stored
// path to a playable file, and learn things (a duration, a tag) after the
// fact. The behaviours worth pinning are the ones that span two modules --
// what survives a reload, what survives a rescan, and what a browser that
// cannot keep a folder handle is honestly told.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicLibrary } from '../src/library/MusicLibrary.js';
import { fakeIdb } from './helpers/fakeLibraryIdb.js';

function fakeFile(name, { lastModified = 1 } = {}) {
  const bytes = new Uint8Array(64);
  return {
    name,
    size: bytes.length,
    lastModified,
    slice: () => ({ arrayBuffer: async () => bytes.slice().buffer }),
  };
}

/** A directory handle over a flat `{ 'a/b.mp3': File }` map. */
function fakeDirHandle(name, files, { permission = 'granted' } = {}) {
  function nodeFor(prefix) {
    const entries = new Map();
    for (const [path, file] of Object.entries(files)) {
      if (prefix && !path.startsWith(`${prefix}/`)) continue;
      const rest = prefix ? path.slice(prefix.length + 1) : path;
      const head = rest.split('/')[0];
      if (!head) continue;
      const childPath = prefix ? `${prefix}/${head}` : head;
      if (rest.includes('/')) entries.set(head, { kind: 'directory', name: head, childPath });
      else entries.set(head, { kind: 'file', name: head, file });
    }
    return {
      kind: 'directory',
      name: prefix ? prefix.split('/').pop() : name,
      queryPermission: async () => permission,
      requestPermission: async () => 'granted',
      values() {
        return (async function* () {
          for (const entry of entries.values()) {
            if (entry.kind === 'directory') yield nodeFor(entry.childPath);
            else yield { kind: 'file', name: entry.name, getFile: async () => entry.file };
          }
        })();
      },
      async getDirectoryHandle(child) {
        const entry = entries.get(child);
        if (!entry || entry.kind !== 'directory') throw new Error('NotFoundError');
        return nodeFor(entry.childPath);
      },
      async getFileHandle(child) {
        const entry = entries.get(child);
        if (!entry || entry.kind !== 'file') throw new Error('NotFoundError');
        return { getFile: async () => entry.file };
      },
    };
  }
  return nodeFor('');
}

function scopeWith(handle, { permission = 'granted' } = {}) {
  const scope = fakeIdb();
  scope.showDirectoryPicker = async () => handle;
  void permission;
  return scope;
}

test('choosing a folder scans it and remembers it for next time', async () => {
  const handle = fakeDirHandle('Music', {
    'Radiohead/Kid A/1.flac': fakeFile('1.flac'),
    'loose.mp3': fakeFile('loose.mp3'),
    'cover.jpg': fakeFile('cover.jpg'),
  });
  const scope = scopeWith(handle);

  const first = new MusicLibrary({ scope });
  assert.equal(first.supported, true);
  assert.equal(first.persistable, true);
  await first.pickFolder();
  assert.deepEqual(first.tracks.map((t) => t.path).sort(), ['Radiohead/Kid A/1.flac', 'loose.mp3']);

  // A whole new session, as after a reload: no picker, no prompt, and the
  // library is simply there.
  const second = await new MusicLibrary({ scope }).init();
  assert.equal(second.root.name, 'Music');
  assert.equal(second.tracks.length, 2);
  assert.equal(second.playable, true);
});

test('a folder whose permission lapsed lists but does not claim to be playable', async () => {
  const handle = fakeDirHandle('Music', { 'a.mp3': fakeFile('a.mp3') }, { permission: 'prompt' });
  const scope = fakeIdb();
  scope.showDirectoryPicker = async () => handle;
  await new MusicLibrary({ scope }).pickFolder();

  const next = await new MusicLibrary({ scope }).init();
  // There is no user gesture on load, so re-requesting would be rejected by
  // the browser anyway. The library shows what it remembers and waits.
  assert.equal(next.tracks.length, 1);
  assert.equal(next.playable, false);
  assert.equal(await next.openFile(next.tracks[0]), null);

  assert.equal(await next.grantAccess(), true);
  assert.equal(next.playable, true);
  assert.ok(await next.openFile(next.tracks[0]));
});

test('a stored path finds its file again, and a moved one reports itself', async () => {
  const target = fakeFile('1.flac');
  const scope = scopeWith(fakeDirHandle('Music', { 'Radiohead/Kid A/1.flac': target }));
  const lib = new MusicLibrary({ scope });
  await lib.pickFolder();
  assert.equal(await lib.openFile(lib.tracks[0]), target);
  assert.equal(await lib.openFile({ path: 'Nowhere/x.mp3' }), null);
  assert.equal(await lib.openFile(null), null);
});

test('a rescan picks up what changed on disk without losing the play history', async () => {
  const files = { 'a.mp3': fakeFile('a.mp3'), 'b.mp3': fakeFile('b.mp3') };
  const scope = scopeWith(fakeDirHandle('Music', files));
  const lib = new MusicLibrary({ scope });
  await lib.pickFolder();

  const a = lib.tracks.find((t) => t.path === 'a.mp3');
  await lib.notePlayed(a, 212.5);
  assert.equal(a.playCount, 1);

  // b is gone, c has appeared.
  delete files['b.mp3'];
  files['c.mp3'] = fakeFile('c.mp3');
  lib.handle = fakeDirHandle('Music', files);
  await lib.rescan();

  assert.deepEqual(lib.tracks.map((t) => t.path).sort(), ['a.mp3', 'c.mp3']);
  const again = lib.tracks.find((t) => t.path === 'a.mp3');
  assert.equal(again.playCount, 1);
  // The duration is the one field a scan cannot know; losing it on every
  // rescan would quietly break sorting by length and the auto-tag's own
  // length check.
  assert.equal(again.durationSec, 212.5);
});

test('a browser with no persistable handle gets a library and an honest caveat', async () => {
  const scope = fakeIdb(); // no showDirectoryPicker
  const lib = new MusicLibrary({ scope });
  assert.equal(lib.persistable, false);
  assert.equal(await lib.pickFolder(), null);

  const withPath = (relative) => Object.assign(fakeFile(relative.split('/').pop()), { webkitRelativePath: relative });
  await lib.adoptFileList([withPath('My Music/x/1.mp3'), withPath('My Music/art.png')]);
  assert.equal(lib.root.name, 'My Music');
  assert.equal(lib.root.persistable, false);
  assert.deepEqual(lib.tracks.map((t) => t.path), ['x/1.mp3']);
  // Playable this session, because the File objects are still in hand.
  assert.ok(await lib.openFile(lib.tracks[0]));

  // Next session the listing survives; the way back to the files does not.
  const next = await new MusicLibrary({ scope }).init();
  assert.equal(next.tracks.length, 1);
  assert.equal(next.playable, false);
});

test('auto-tagging writes only what it found, and only over guesses', async () => {
  const scope = scopeWith(fakeDirHandle('Music', {
    'Aphex Twin - Xtal.mp3': fakeFile('Aphex Twin - Xtal.mp3'),
    'unknown-1.mp3': fakeFile('unknown-1.mp3'),
  }));
  const lib = new MusicLibrary({ scope });
  await lib.pickFolder();

  lib.fetchFn = async (url) => ({
    ok: true,
    json: async () => (url.includes('Xtal')
      ? { recordings: [{ score: 98, title: 'Xtal', length: null, 'artist-credit': [{ name: 'Aphex Twin' }], releases: [{ title: 'Selected Ambient Works 85-92', date: '1992-11-09' }] }] }
      : { recordings: [] }),
  });

  const emits = [];
  lib.subscribe(() => emits.push(lib.tracks.map((t) => t.tagSource).join(',')));
  const tagged = await lib.autoTag();
  assert.equal(tagged, 1);

  const xtal = lib.tracks.find((t) => t.path.includes('Xtal'));
  assert.equal(xtal.album, 'Selected Ambient Works 85-92');
  assert.equal(xtal.year, 1992);
  assert.equal(xtal.tagSource, 'auto');
  // The one that came back empty keeps the filename it had -- an unfindable
  // track is left alone, never blanked.
  const unknown = lib.tracks.find((t) => t.path.includes('unknown'));
  assert.equal(unknown.tagSource, 'filename');
  assert.ok(unknown.title);
  // Results land one at a time so the list visibly fills in.
  assert.ok(emits.length >= 1);

  // The tags outlive the session they were fetched in.
  const next = await new MusicLibrary({ scope }).init();
  assert.equal(next.tracks.find((t) => t.path.includes('Xtal')).artist, 'Aphex Twin');
});

test('a second auto-tag run has nothing left to ask about', async () => {
  const scope = scopeWith(fakeDirHandle('Music', { 'x.mp3': fakeFile('x.mp3') }));
  const lib = new MusicLibrary({ scope });
  await lib.pickFolder();
  lib.tracks[0].tagSource = 'tags';
  let asked = 0;
  lib.fetchFn = async () => { asked++; return { ok: true, json: async () => ({ recordings: [] }) }; };
  assert.equal(await lib.autoTag(), 0);
  assert.equal(asked, 0);
});

test('forgetting a folder leaves nothing behind', async () => {
  const scope = scopeWith(fakeDirHandle('Music', { 'a.mp3': fakeFile('a.mp3') }));
  const lib = new MusicLibrary({ scope });
  await lib.pickFolder();
  await lib.forget();
  assert.equal(lib.root, null);
  assert.deepEqual(lib.tracks, []);
  assert.equal((await new MusicLibrary({ scope }).init()).tracks.length, 0);
});

test('with no storage at all the library is inert rather than broken', async () => {
  const lib = await new MusicLibrary({ scope: {} }).init();
  assert.equal(lib.supported, false);
  assert.deepEqual(lib.tracks, []);
  assert.equal(await lib.pickFolder(), null);
  assert.equal(await lib.openFile({ path: 'a' }), null);
  await lib.notePlayed({ key: 'k' }, 10);
  assert.equal(await lib.autoTag(), 0);
});

/** A folder of `count` files, for watching a scan unfold. */
function bigFolder(count) {
  const files = {};
  for (let i = 0; i < count; i++) files[`t${String(i).padStart(4, '0')}.mp3`] = fakeFile(`t${i}.mp3`);
  return files;
}

test('the library fills in while the folder is being read, not after', async () => {
  // The reported bug: choosing a folder showed nothing at all for minutes,
  // then everything at once. Subscribers must see it growing.
  const scope = scopeWith(fakeDirHandle('Music', bigFolder(120)));
  const lib = new MusicLibrary({ scope });
  const seen = [];
  lib.subscribe(() => seen.push({ n: lib.tracks.length, scanning: lib.scanning }));

  let rootChosenAt = null;
  await lib.pickFolder({ onRootChosen: () => { rootChosenAt = lib.tracks.length; } });

  // The caller is told about the folder BEFORE any track has been read --
  // that is the moment the library opens, so it opens empty and fills.
  assert.equal(rootChosenAt, 0);
  const growing = seen.filter((s) => s.scanning && s.n > 0);
  assert.ok(growing.length >= 2, `expected several partial emissions, saw ${JSON.stringify(seen.map((s) => s.n))}`);
  // Strictly increasing while scanning: no emission ever goes backwards.
  for (let i = 1; i < growing.length; i++) assert.ok(growing[i].n >= growing[i - 1].n);
  // And the last word is the complete, finished library.
  assert.equal(seen.at(-1).scanning, false);
  assert.equal(seen.at(-1).n, 120);
  assert.equal(lib.scanning, false);
});

test('a scan abandoned part way leaves what it found, and a later rescan completes it', async () => {
  const files = bigFolder(200);
  const scope = scopeWith(fakeDirHandle('Music', files));
  const lib = new MusicLibrary({ scope });

  const unsubscribe = lib.subscribe(() => {
    if (lib.scanning && lib.tracks.length >= 40) lib.cancel();
  });
  await lib.pickFolder();
  unsubscribe();

  const partial = (await new MusicLibrary({ scope }).init()).tracks.length;
  assert.ok(partial >= 40 && partial < 200, `partial scan stored ${partial}`);

  // Nothing was pruned, because a partial walk does not know what is
  // missing -- only a completed one does.
  const finished = await new MusicLibrary({ scope }).init();
  await finished.grantAccess();
  await finished.rescan();
  assert.equal(finished.tracks.length, 200);
  assert.equal(finished.scanning, false);
});

test('choosing a second folder cannot be overwritten by the first scan unwinding', async () => {
  const scope = scopeWith(fakeDirHandle('Music', bigFolder(80)));
  const lib = new MusicLibrary({ scope });
  lib.root = { id: 'root:music', name: 'Music' };
  lib.handle = fakeDirHandle('Music', bigFolder(80));
  const slow = lib.rescan();
  // A second scan starts before the first has unwound.
  lib.handle = fakeDirHandle('Other', bigFolder(10));
  lib.root = { id: 'root:other', name: 'Other' };
  const fresh = await lib.rescan();
  await slow;

  assert.equal(fresh.length, 10);
  // The superseded scan must not write its 80 tracks over the new library.
  assert.equal(lib.tracks.length, 10);
});

test('a cancelled picker is silent; a broken one is not', async () => {
  const scope = fakeIdb();
  const lib = new MusicLibrary({ scope });

  scope.showDirectoryPicker = async () => {
    const err = new Error('The user aborted a request.');
    err.name = 'AbortError';
    throw err;
  };
  assert.equal(await lib.pickFolder(), null);

  // Anything else used to come back as null too, which looks exactly like
  // "the button did nothing" -- the worst way to report a failure.
  scope.showDirectoryPicker = async () => {
    const err = new Error('Must be handling a user gesture to show a file picker.');
    err.name = 'SecurityError';
    throw err;
  };
  await assert.rejects(() => lib.pickFolder(), /user gesture/);
});
