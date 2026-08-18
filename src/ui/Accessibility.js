// The Reel (Movement VI): a persisted reduced-flash accessibility toggle.
// Guarded against environments with no localStorage (Node's test runner,
// most notably) -- a ReferenceError there is caught exactly like a
// disabled/blocked storage API in a locked-down browser, and both fall
// back to "off" rather than throwing.
const STORAGE_KEY = 'smw:reducedFlash';
const NO_LYRICS_KEY = 'smw:noLyrics';
const BLUETOOTH_LATENCY_KEY = 'smw:bluetoothLatency';
export const FLASH_CAP = 0.4;

/** A player who has never touched this toggle gets the OS-level signal as
 *  their default rather than a silent "off" -- prefers-reduced-motion was
 *  never consulted here before. An explicit past choice (on OR off) always
 *  wins over it; this only fills the gap before anyone has chosen. */
function prefersReducedMotion() {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function getReducedFlash() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === '1';
    return prefersReducedMotion();
  } catch { return false; }
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

// "Bluetooth latency mode": floors the heard-clock lag at
// BLUETOOTH_LATENCY_FLOOR_MS (ChoreoClock) so beat-anchored visuals stay
// on the ear when AudioContext.outputLatency under-reports BT headphones.
// Same storage-guarded pattern as reduced-flash / no-lyrics above.
export function getBluetoothLatency() {
  try { return localStorage.getItem(BLUETOOTH_LATENCY_KEY) === '1'; } catch { return false; }
}

export function setBluetoothLatency(v) {
  try { localStorage.setItem(BLUETOOTH_LATENCY_KEY, v ? '1' : '0'); } catch { /* no persistent storage available */ }
}

/** Caps a flash alpha at FLASH_CAP when reduced-flash is active; a pure pass-through otherwise. */
export function capFlashAlpha(alpha, reducedFlash) {
  return reducedFlash ? Math.min(alpha, FLASH_CAP) : alpha;
}

// The groove fingerprint (GrooveFingerprint.js): the one piece of state that
// survives across SONGS, not just across sessions. Everything else in this
// file is a preference the player set; this one the engine learned.
//
// Note the key namespace: `smw:` with a colon, matching every other key here.
const GROOVE_KEY = 'smw:groove';

/** The saved profile blob, or null. Parsing/validation is
 *  GrooveFingerprint.load's job -- it tolerates anything. */
export function getStoredGroove() {
  try { return localStorage.getItem(GROOVE_KEY); } catch { return null; }
}

export function setStoredGroove(profile) {
  try { localStorage.setItem(GROOVE_KEY, JSON.stringify(profile.toJSON())); } catch { /* no persistent storage available */ }
}

export function clearStoredGroove() {
  try { localStorage.removeItem(GROOVE_KEY); } catch { /* no persistent storage available */ }
}
