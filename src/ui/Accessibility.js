// The Reel (Movement VI): a persisted reduced-flash accessibility toggle.
// Guarded against environments with no localStorage (Node's test runner,
// most notably) -- a ReferenceError there is caught exactly like a
// disabled/blocked storage API in a locked-down browser, and both fall
// back to "off" rather than throwing.
const STORAGE_KEY = 'smw:reducedFlash';
export const FLASH_CAP = 0.4;

export function getReducedFlash() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

export function setReducedFlash(v) {
  try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch { /* no persistent storage available */ }
}

/** Caps a flash alpha at FLASH_CAP when reduced-flash is active; a pure pass-through otherwise. */
export function capFlashAlpha(alpha, reducedFlash) {
  return reducedFlash ? Math.min(alpha, FLASH_CAP) : alpha;
}
