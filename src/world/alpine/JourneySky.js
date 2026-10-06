import { smoothstep } from '../../utils/math.js';
import { SONG_NIGHT_TWILIGHT } from '../DayNight.js';

const UNKNOWN_TWILIGHT_MS = 15000;

/** Heard-time visibility for the Journey's shared sky/lake firmament.
 * Lighting's .75 Range night floor preserves landscape detail; it cannot
 * say whether the stars should yet be visible. These separate envelopes
 * open in sunset, reveal the layers across blue hour, hold all night and
 * clear them before the sun returns. No history, beat gate or random pulse
 * can make the aurora disappear in the middle of a moonlit passage.
 *
 * Reduced motion freezes spatial motion elsewhere, not semantic time.
 * `light` remains accepted as a frame input but its night floor does not
 * control these envelopes. Unknown endings reveal once into the existing
 * repeating moonlight, never manufacture a sunrise or reset the reveal.
 *
 * @returns {{stars01:number, constellations01:number, aurora01:number,
 * night01:number, twilight01:number, phase:'sunset'|'blue-hour'|'moonlight'|'sunrise'}}
 */
export function sampleJourneySky({ timeMs = 0, durationMs = 0, reducedMotion = false, light = null } = {}) {
  void reducedMotion;
  void light;
  const known = Number.isFinite(durationMs) && durationMs > 0;
  const time = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0);
  const t = known ? Math.min(durationMs, time) : time;
  const twilightMs = known
    ? Math.min(durationMs * SONG_NIGHT_TWILIGHT.frac, SONG_NIGHT_TWILIGHT.maxMs)
    : UNKNOWN_TWILIGHT_MS;
  const dusk = t / twilightMs, dawn = known ? (durationMs - t) / twilightMs : Infinity;
  const window = (riseStart, riseEnd, fadeEnd, fadeStart) =>
    smoothstep(riseStart, riseEnd, dusk) * smoothstep(fadeEnd, fadeStart, dawn);
  const night01 = window(0, 1, 0, 1);
  return {
    stars01: window(.28, 1, .4, 1.1),
    constellations01: window(.48, 1.2, .64, 1.4),
    aurora01: window(.56, 1.16, .6, 1.18),
    night01,
    twilight01: 1 - night01,
    phase: known && dusk < SONG_NIGHT_TWILIGHT.sunsetFrac ? 'sunset'
      : dusk < 1 ? 'blue-hour' : dawn < 1 ? 'sunrise' : 'moonlight',
  };
}
