// The Lens: the player's only real-time control now is how close to lean
// into the world. Zoom is deliberately slow (EASE_TAU_SEC) so a wheel flick
// or a Space toggle never reads as input lag -- by the time the ease
// catches up, any latency in the input pipeline is long since invisible.
// Past a threshold the world itself gives way to an interior diorama (see
// InteriorRealm.js): whatever a mountain, temple mount, or crystal seam
// would actually contain, keyed off the currently-dominant biome.
import { clamp, clamp01, smoothstep, hashSeed } from '../utils/math.js';

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3.2;
const EASE_TAU_SEC = 0.7;
const REVEAL_LO = 0.55, REVEAL_HI = 0.92; // depth range over which the interior crossfades in
const SCENE_LATCH_ON = 0.05;  // reveal must clear this to latch a scene...
const SCENE_LATCH_OFF = 0.01; // ...and fall below this to release it (hysteresis: no flicker at the edge)
const INSIDE_THRESHOLD = 0.5; // reveal level the transit whoosh fires at
const SCENE_BUCKET_PX = 2400; // world-x granularity a scene is chosen at

export const SCENES = Object.freeze(['warren', 'temple', 'tomb', 'geode']);

// Every biome maps to whichever interior best fits its lore; biomes not
// listed (a custom MIDI-derived profile, say) fall back to 'warren' --
// Broshi's tunnels are the one interior that fits literally anywhere.
const BIOME_SCENE = {
  JADE: 'warren', SAKURA: 'warren', TWILIGHT: 'warren',
  EMBER: 'temple', SOLAR: 'temple',
  VOID: 'tomb', STORM: 'tomb',
  ARCTIC: 'geode', MIRROR: 'geode', CYBER: 'geode',
};

export function sceneForBiome(biomeName) {
  return BIOME_SCENE[biomeName] || 'warren';
}

/** Deterministic per-(song, biome, world-bucket) seed, so the same stretch
 *  of a song always contains the same interior on replay. */
export function sceneSeedFor(songSeed, biomeName, worldX) {
  const bucket = Math.floor(worldX / SCENE_BUCKET_PX);
  return hashSeed(`${songSeed}:${biomeName}:${bucket}`);
}

export class ZoomDirector {
  constructor(songSeed = 1) {
    this.songSeed = songSeed;
    this.value = ZOOM_MIN;
    this.target = ZOOM_MIN;
    this.depth = 0;
    this.reveal = 0;
    /** {kind, seed, biomeName} while latched, else null. Regenerated only
     *  on a fresh latch, so the interior never changes shape mid-zoom even
     *  as worldX/biome drift underneath a sustained deep zoom. */
    this.scene = null;
    this.inside = false;
    this.justCrossedIn = false;
    this.justCrossedOut = false;
  }

  /** Continuous input (wheel delta, held-key rate) -- adjusts the target,
   *  not the eased value, so input always feels immediate to register but
   *  slow to arrive. */
  nudge(delta) {
    this.target = clamp(this.target + delta, ZOOM_MIN, ZOOM_MAX);
  }

  /** Space/click: snap the TARGET fully in or fully out, whichever is
   *  farther from where the target currently sits. */
  toggle() {
    const mid = (ZOOM_MIN + ZOOM_MAX) / 2;
    this.target = this.target > mid ? ZOOM_MIN : ZOOM_MAX;
  }

  update(nowMs, dtSec, biomeName, worldX) {
    this.value += (1 - Math.exp(-dtSec / EASE_TAU_SEC)) * (this.target - this.value);
    this.depth = clamp01((this.value - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN));
    this.reveal = smoothstep(REVEAL_LO, REVEAL_HI, this.depth);

    const wasInside = this.inside;
    this.inside = this.reveal >= INSIDE_THRESHOLD;
    this.justCrossedIn = this.inside && !wasInside;
    this.justCrossedOut = !this.inside && wasInside;

    if (this.reveal >= SCENE_LATCH_ON && !this.scene) {
      this.scene = {
        kind: sceneForBiome(biomeName),
        seed: sceneSeedFor(this.songSeed, biomeName, worldX),
        biomeName,
      };
    } else if (this.reveal <= SCENE_LATCH_OFF && this.scene) {
      this.scene = null;
    }
  }
}
