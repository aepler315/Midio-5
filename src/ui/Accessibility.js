// The Reel (Movement VI): a persisted reduced-flash accessibility toggle.
// Guarded against environments with no localStorage (Node's test runner,
// most notably) -- a ReferenceError there is caught exactly like a
// disabled/blocked storage API in a locked-down browser, and both fall
// back to "off" rather than throwing.
const STORAGE_KEY = 'smw:reducedFlash';
const NO_LYRICS_KEY = 'smw:noLyrics';
export const FLASH_CAP = 0.4;

export function getReducedFlash() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

export function setReducedFlash(v) {
  try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch { /* no persistent storage available */ }
}

// "No lyrics": a persisted opt-out from the LRCLIB lyric fetch/prompt that
// runs for dropped audio files. When on, the whole identity/lyrics step is
// skipped -- for songs that have no lyrics, or when the player just doesn't
// want the search. Same storage-guarded pattern as reduced-flash above.
export function getLyricsDisabled() {
  try { return localStorage.getItem(NO_LYRICS_KEY) === '1'; } catch { return false; }
}

export function setLyricsDisabled(v) {
  try { localStorage.setItem(NO_LYRICS_KEY, v ? '1' : '0'); } catch { /* no persistent storage available */ }
}

/** Caps a flash alpha at FLASH_CAP when reduced-flash is active; a pure pass-through otherwise. */
export function capFlashAlpha(alpha, reducedFlash) {
  return reducedFlash ? Math.min(alpha, FLASH_CAP) : alpha;
}
