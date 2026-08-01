// On-device FPS HUD support (mobile performance round): an EMA'd fps
// readout from the raw rAF-to-rAF deltas already fed to PerfGovernor.sample,
// plus a `?fps` URL param to show it without hunting for a toggle key.

const EMA_ALPHA = 0.15; // settles to within ~10% of a step change in ~10 frames

/** Smooths a raw frame-to-frame delta into a display-stable fps. Ignores
 *  non-positive deltas (paused/backgrounded tabs) rather than spiking. */
export function emaFps(prevFps, deltaMs, alpha = EMA_ALPHA) {
  if (!(deltaMs > 0)) return prevFps;
  const instFps = 1000 / deltaMs;
  return prevFps == null ? instFps : prevFps + (instFps - prevFps) * alpha;
}

/** `?fps` (any value, or bare) shows the HUD on load without needing the toggle key. */
export function resolveFpsHudVisible(search = '') {
  try {
    const raw = search || '';
    const q = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
    return q.has('fps');
  } catch {
    return false;
  }
}
