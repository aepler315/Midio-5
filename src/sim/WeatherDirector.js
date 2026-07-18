// Music-reactive weather: a global sky layer decoupled from biome (unlike
// each BiomeProfile's own particle signature, this reads the song's mood and
// intensity directly, so it shows up in ANY biome). Pure logic -- BiomeManager
// owns the actual ParticleFields and the wind coupling; this only decides
// which kind is falling and how hard.
import { clamp01 } from '../utils/math.js';

export const KINDS = Object.freeze(['rain', 'snow', 'petals', 'embers']);

const KIND_REEVAL_MS = 8000;
const VALENCE_HYSTERESIS = 0.08; // must clear the boundary by this much to switch
const CROSSFADE_OUT_TAU_SEC = 0.8; // how fast the outgoing kind eases to 0 before the swap
const ATTACK_TAU_SEC = 3;
const RELEASE_TAU_SEC = 6;
const ENERGY_FLOOR = 0.25, ENERGY_SPAN = 0.5; // energySlow -> intensity target mapping
const CALM_SUPPRESS = 0.7; // how much calm dampens the intensity target
const SURGE_BOOST = 0.5;   // how much a drop's surge (0..1) adds to the target
const DORMANT_GATE = 0.08; // below this the layer is fully dormant (zero update/draw cost)
// Snow that actually falls for a while SETTLES: groundCover accumulates
// during a live snowfall and melts away under any other sky. Simulation
// turns it into slippery footing (see Traction.js) and BiomeManager draws
// the frost caps -- weather with consequences, not just a particle skin.
const COVER_ACCUM_SEC = 22;  // full cover after ~22s of full-intensity snowfall
const COVER_MELT_SEC = 16;   // and it melts a bit faster than it settles
const COVER_MIN_INTENSITY = 0.15;
const EPIC_EMBER_THRESHOLD = 0.75;
const VALENCE_RAIN_BOUNDARY = -0.2;  // sad <-> neutral
const VALENCE_PETALS_BOUNDARY = 0.3; // neutral <-> happy

/** Which kind a mood reading maps to, given the currently-active kind (for
 *  hysteresis at the valence boundaries -- epic's ember override has none,
 *  since it's a hard threshold on a different axis, not a boundary to dither
 *  across). Exported for direct testing of the mapping in isolation. */
export function kindForMood(valence, epic, currentKind) {
  if (epic >= EPIC_EMBER_THRESHOLD) return 'embers';
  // Schmitt trigger: already being in a state raises the bar to LEAVE it
  // (the exit threshold sits past the plain boundary); not being in it
  // raises the bar to ENTER it (the entry threshold sits short of the plain
  // boundary). Either way the net effect is the same "widen outward" shape.
  const rainThresh = VALENCE_RAIN_BOUNDARY + (currentKind === 'rain' ? VALENCE_HYSTERESIS : -VALENCE_HYSTERESIS);
  const petalsThresh = VALENCE_PETALS_BOUNDARY + (currentKind === 'petals' ? -VALENCE_HYSTERESIS : VALENCE_HYSTERESIS);
  if (valence < rainThresh) return 'rain';
  if (valence > petalsThresh) return 'petals';
  return 'snow';
}

export class WeatherDirector {
  constructor() {
    this.kind = 'snow'; // stable default until the first evaluation lands
    this.intensity = 0;      // 0..1, the ACTIVE kind's own level
    this.groundCover = 0;    // 0..1 settled snow -- accumulates during snowfall, melts otherwise
    this._nextEvalMs = 0;
    this._pendingKind = null; // queued kind, held while the current one fades to 0
  }

  /** Only one kind is ever live at a time -- {kind, intensity}. */
  get state() {
    return { kind: this.kind, intensity: this.intensity, groundCover: this.groundCover };
  }

  _stepCover(dtSec) {
    if (this.kind === 'snow' && this.intensity > COVER_MIN_INTENSITY && !this._pendingKind) {
      this.groundCover = clamp01(this.groundCover + (dtSec * this.intensity) / COVER_ACCUM_SEC);
    } else {
      this.groundCover = clamp01(this.groundCover - dtSec / COVER_MELT_SEC);
    }
  }

  update(nowMs, dtSec, { valence = 0, epic = 0, calm = 0, energySlow = 0, surge = 0, unravel = 0 } = {}) {
    if (nowMs >= this._nextEvalMs) {
      this._nextEvalMs = nowMs + KIND_REEVAL_MS;
      const next = kindForMood(valence, epic, this.kind);
      if (next !== this.kind && !this._pendingKind) this._pendingKind = next;
    }

    if (this._pendingKind) {
      // Ease the outgoing kind fully to 0 first -- one front passes, THEN
      // the next arrives, so only one weather field is ever live to update
      // or draw (BiomeManager never has to blend two).
      this.intensity -= (1 - Math.exp(-dtSec / CROSSFADE_OUT_TAU_SEC)) * this.intensity;
      if (this.intensity < 0.01) {
        this.intensity = 0;
        this.kind = this._pendingKind;
        this._pendingKind = null;
      }
      this._stepCover(dtSec);
      return;
    }

    const target = clamp01(
      clamp01((energySlow - ENERGY_FLOOR) / ENERGY_SPAN) * (1 - CALM_SUPPRESS * calm) + SURGE_BOOST * surge,
    ) * (1 - clamp01(unravel));
    const tau = target > this.intensity ? ATTACK_TAU_SEC : RELEASE_TAU_SEC;
    this.intensity += (1 - Math.exp(-dtSec / tau)) * (target - this.intensity);
    this.intensity = clamp01(this.intensity);
    // Gate on the TARGET, not the current value -- zeroing a transiently-low
    // value mid-attack would trap it at 0 forever (each step's increment
    // from a zeroed base is itself tiny). A low target genuinely means
    // "nothing to reach for," so snapping off there is safe and saves the
    // draw cost of an imperceptible sprinkle.
    if (target < DORMANT_GATE && this.intensity < DORMANT_GATE) this.intensity = 0;
    this._stepCover(dtSec);
  }
}
