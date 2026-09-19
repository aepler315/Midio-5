// The library, as one object the rest of the app can talk to.
//
// LibraryDB knows how to store, LibraryScanner knows how to read a folder,
// AutoTag knows how to ask MusicBrainz, TrackIndex knows how to order the
// result -- this is the part that sequences them and owns the one piece of
// state none of them can: which folder is open right now, and how to get
// from a stored path back to a playable File.
//
// Nothing here touches the DOM. The panel subscribes and repaints.
import {
  addRoot, listRoots, listTracks, removeRoot, replaceTracks, updateTrack, updateTracks,
  libraryDbSupported, directoryHandlesSupported,
} from './LibraryDB.js';
import { scanDirectory, scanFileList, resolveFile, ensureReadPermission } from './LibraryScanner.js';
import { createTagQueue } from './AutoTag.js';
import { untaggedTracks } from './TrackIndex.js';

export class MusicLibrary {
  constructor({ scope = globalThis, fetchFn = (typeof fetch !== 'undefined' ? fetch : null) } = {}) {
    this.scope = scope;
    this.fetchFn = fetchFn;
    this.root = null;      // the stored root record
    this.handle = null;    // its live directory handle, when there is one
    this.tracks = [];
    /** Files from a `webkitdirectory` pick, which are playable now but
     *  cannot be stored. Empty on the handle path, where files are found
     *  again by walking the directory instead. */
    this.sessionFiles = new Map();
    this.listeners = new Set();
    this._abort = null;
  }

  get supported() { return libraryDbSupported(this.scope); }

  /** Can the chosen folder be reopened after a reload without asking again? */
  get persistable() { return directoryHandlesSupported(this.scope); }

  /** Is the open root one we can actually read files from right now? A
   *  remembered-but-unreadable library still lists; it just cannot play. */
  get playable() { return !!this.handle || this.sessionFiles.size > 0; }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) {
      try { fn(this); } catch (err) { console.warn('[library] listener failed', err); }
    }
  }

  /** Load whatever was remembered. Never prompts: there is no user gesture
   *  on page load, so a lapsed permission is reported, not re-requested. */
  async init() {
    if (!this.supported) return this;
    const roots = await listRoots(this.scope);
    this.root = roots[0] || null;
    if (this.root) {
      this.tracks = await listTracks(this.root.id, this.scope);
      if (this.root.handle && await ensureReadPermission(this.root.handle)) {
        this.handle = this.root.handle;
      }
    }
    this._emit();
    return this;
  }

  /** Re-ask for the folder permission. Must be called from a click. */
  async grantAccess() {
    if (!this.root?.handle) return false;
    if (!await ensureReadPermission(this.root.handle, { interactive: true })) return false;
    this.handle = this.root.handle;
    this._emit();
    return true;
  }

  /**
   * Choose a folder and scan it.
   *
   * Two paths in, because two classes of browser exist: one that hands back
   * a handle we can keep, and one that hands back a list of Files we cannot.
   * Both produce the same track records, so everything downstream is
   * identical -- the difference shows up once, at the next reload.
   */
  async pickFolder({ onProgress = null } = {}) {
    if (this.persistable) {
      let handle;
      try {
        handle = await this.scope.showDirectoryPicker({ id: 'midio-music', mode: 'read' });
      } catch {
        return null; // cancelled
      }
      const root = await addRoot({ name: handle.name, handle }, this.scope);
      if (!root) return null;
      this.root = root;
      this.handle = handle;
      this.sessionFiles.clear();
      return this.rescan({ onProgress });
    }
    return null;
  }

  /** The `<input type="file" webkitdirectory>` path: the caller owns the
   *  element and hands the files here. */
  async adoptFileList(files, { name = 'Music', onProgress = null } = {}) {
    const list = [...(files || [])];
    if (!list.length) return null;
    // webkitRelativePath leads with the folder the player actually chose,
    // which is a better label than the input element could give us.
    const first = list[0]?.webkitRelativePath || '';
    const folderName = first.includes('/') ? first.slice(0, first.indexOf('/')) : name;
    const root = await addRoot({ name: folderName, handle: null, persistable: false }, this.scope);
    this.root = root || { id: `root:${folderName.toLowerCase()}`, name: folderName, handle: null, persistable: false };
    this.handle = null;

    const signal = this._beginWork();
    const { tracks, handles } = await scanFileList(this.root.id, list, { onProgress, signal });
    this.sessionFiles = handles;
    await replaceTracks(this.root.id, tracks, this.scope);
    this.tracks = await listTracks(this.root.id, this.scope);
    this._endWork();
    this._emit();
    return this.tracks;
  }

  /** Re-read the open folder. What the player earned is carried across by
   *  LibraryDB, so this is cheap to do often and safe to do at all. */
  async rescan({ onProgress = null } = {}) {
    if (!this.root || !this.handle) return this.tracks;
    const signal = this._beginWork();
    const scanned = await scanDirectory(this.root.id, this.handle, { onProgress, signal });
    if (!signal.aborted) {
      await replaceTracks(this.root.id, scanned, this.scope);
      this.tracks = await listTracks(this.root.id, this.scope);
    }
    this._endWork();
    this._emit();
    return this.tracks;
  }

  async forget() {
    if (this.root) await removeRoot(this.root.id, this.scope);
    this.root = null;
    this.handle = null;
    this.tracks = [];
    this.sessionFiles.clear();
    this._emit();
  }

  /** Back from a stored track to a playable File, or null if it has moved. */
  async openFile(track) {
    if (!track) return null;
    const fromSession = this.sessionFiles.get(track.path);
    if (fromSession) return fromSession;
    if (!this.handle) return null;
    return resolveFile(this.handle, track.path);
  }

  /**
   * Record that a track was played, and its real duration now that
   * something has decoded it.
   *
   * Duration is the one field a scan cannot know, and it is what makes
   * "sort by length" and the auto-tag's length check work at all -- so it
   * is written back the first time a song is heard and kept from then on.
   */
  async notePlayed(track, durationSec = null) {
    if (!track?.key) return;
    const patch = {
      playCount: (track.playCount || 0) + 1,
      lastPlayedMs: Date.now(),
    };
    if (Number.isFinite(durationSec) && durationSec > 0) patch.durationSec = durationSec;
    Object.assign(track, patch);
    await updateTrack(track.key, patch, this.scope);
    this._emit();
  }

  /**
   * Fill in the tracks that only have a filename.
   *
   * Runs at MusicBrainz's one-per-second and writes results as they land,
   * so a folder of two hundred fills in over four minutes while the player
   * browses rather than blocking on a batch. Returns how many were tagged.
   */
  async autoTag({ onProgress = null, signal = null } = {}) {
    const pending = untaggedTracks(this.tracks);
    if (!pending.length) return 0;
    const patches = [];
    const queue = createTagQueue({ fetchFn: this.fetchFn });
    const tagged = await queue.run(pending, {
      signal,
      onProgress,
      onResult: (track, patch) => {
        if (!patch) return;
        const fields = {
          title: patch.title || track.title,
          artist: patch.artist || track.artist,
          album: patch.album || track.album,
          year: patch.year ?? track.year ?? null,
          tagSource: 'auto',
        };
        Object.assign(track, fields);
        patches.push({ key: track.key, ...fields });
        // Repaint per result: watching the list fill in is the only thing
        // that makes a four-minute job feel like progress instead of a hang.
        this._emit();
      },
    });
    if (patches.length) await updateTracks(patches, this.scope);
    return tagged;
  }

  /** One scan or tag run at a time; starting another abandons the first. */
  _beginWork() {
    this._abort?.abort?.();
    this._abort = typeof AbortController !== 'undefined' ? new AbortController() : { signal: { aborted: false }, abort() { this.signal.aborted = true; } };
    return this._abort.signal;
  }

  _endWork() {
    this._abort = null;
  }

  /** Stop any scan in flight -- closing the panel over a ten-thousand-track
   *  drive should actually stop reading it. */
  cancel() {
    this._abort?.abort?.();
    this._abort = null;
  }
}
