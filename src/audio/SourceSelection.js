/**
 * Which recording the player chose most recently.
 *
 * Every way of choosing a song -- a file pick or drop, a library row, a URL,
 * the built-in sample -- begins a selection synchronously, inside the
 * gesture, before any permission prompt, file read, download or audio boot.
 * Beginning one aborts the previous selection's signal. Every asynchronous
 * step after that asks `isCurrent(selection)` before it publishes anything
 * (chooser, playback, error banner, progress, library metadata), so a slow
 * older choice can never land on top of a newer one.
 *
 * The selection also carries its own attribution. A library play used to be
 * remembered in a detached `playingFromLibrary` variable that survived a
 * failed load and was then credited to the next, unrelated file; now the
 * library track travels with the selection that owns it and dies with it.
 *
 * A selection is immutable. Code that receives one must pass the same object
 * on (`loadAudioFiles(files, { selection })`) rather than beginning a new
 * one: only a player's action may claim a newer selection.
 */

export const SOURCE_KINDS = Object.freeze(['file', 'library', 'url', 'sample']);

export class SourceSelection {
  constructor() {
    this._nextId = 1;
    this._current = null; // { selection, controller }
  }

  /**
   * Claims a new selection and aborts the previous one.
   * `libraryTrack` is kept only for `kind: 'library'`.
   */
  begin({ kind, name = '', libraryTrack = null } = {}) {
    if (!SOURCE_KINDS.includes(kind)) {
      throw new TypeError(`Unknown source kind: ${kind}`);
    }
    this._current?.controller.abort();
    const controller = new AbortController();
    const selection = Object.freeze({
      id: this._nextId++,
      kind,
      name: String(name ?? ''),
      libraryTrack: kind === 'library' ? libraryTrack : null,
      signal: controller.signal,
    });
    this._current = { selection, controller };
    return selection;
  }

  /** The newest selection, or null after cancel(). */
  get current() {
    return this._current?.selection ?? null;
  }

  /** True only for the newest selection, and only while it is not cancelled. */
  isCurrent(selection) {
    return !!selection && this._current?.selection === selection && !selection.signal.aborted;
  }

  /** Abandons the current selection (back to the title screen, for example). */
  cancel() {
    this._current?.controller.abort();
    this._current = null;
  }
}
