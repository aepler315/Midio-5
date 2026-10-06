// Shared "Midasus style" helpers. Her single biggest visual signature is a
// pale, pitch-class SPECTRAL color (hue derived from the note, 30deg per
// semitone) laid over heavy additive glow; a second signature is the note
// "slashes" -- bright additive cuts along her motion on each onset that
// extend as they fade. Both are extracted here so Midio, Broshi, and the
// baby stars can wear the exact same treatment and read as the same kind of
// luminous instrument she does.

/** Midasus's core color rule: pitch class -> hue (0..360), 30deg per semitone. */
export function spectralHue(pitch) {
  return ((((Math.round(pitch) || 0) % 12) + 12) % 12) * 30;
}

/** Shortest-path ease of a hue (deg) toward a target by fraction k in [0,1],
 *  so a character's color drifts between notes/keys instead of snapping. */
export function easeHueDeg(cur, target, k) {
  const d = ((target - cur + 540) % 360) - 180; // shortest signed delta in [-180, 180)
  return (cur + d * k + 360) % 360;
}
