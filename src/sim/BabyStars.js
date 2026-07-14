// Three baby stars — miniatures of Midasus's hexagram — who treat her as a
// secure base in the attachment-theory sense: they orbit close, and when
// the world feels safe (a calm stretch) exactly one at a time ventures out
// to explore a point of interest, glancing home the whole way. The moment
// the song turns loud, or the trip has run its course, they rush back to
// the nest. Pure logic apart from draw(); the state machine is unit-tested.
import { BABY_STAR_MESH } from '../render/meshes.js';
import { computeRestLengths, drawMeshPart } from '../render/MeshDrawer.js';
import { clamp, mulberry32 } from '../utils/math.js';

export const BABY_COUNT = 3;
export const NEST_RADIUS = 22;
const EXPLORE_RANGE = 170;       // how far a trip may roam from the base
const EXPLORE_MIN_CALM = 0.3;    // world must be at least this calm to venture
const RECALL_CALM = 0.15;        // below this the song is loud: everyone home
const TRIP_MIN_SEC = 2.2, TRIP_MAX_SEC = 4.6;
const COOLDOWN_MIN_SEC = 1.5, COOLDOWN_MAX_SEC = 4;
const HOME_EPS = 12;             // close enough to the nest slot to re-latch
const KP = 55, KD = 9;

export class BabyStars {
  constructor(seed = 99) {
    this.rand = mulberry32(seed);
    this.stars = Array.from({ length: BABY_COUNT }, (_, i) => ({
      state: 'nest', // 'nest' | 'explore' | 'return'
      x: 0, y: 0, vx: 0, vy: 0,
      slotPhase: (i / BABY_COUNT) * Math.PI * 2, // nest orbit slot
      orbitHz: 0.24 + 0.1 * this.rand(),
      bobPhase: this.rand() * Math.PI * 2,
      spin: this.rand() * Math.PI * 2,
      spinHz: (0.4 + 0.5 * this.rand()) * (this.rand() < 0.5 ? -1 : 1),
      cooldownSec: 1 + 3 * this.rand(),
      tripSec: 0,
      tripEndSec: 0,
      target: { x: 0, y: 0 },
      placed: false,
    }));
    this._t = 0;
  }

  get explorer() {
    return this.stars.find((s) => s.state === 'explore' || s.state === 'return') || null;
  }

  _slot(star, base) {
    const a = star.slotPhase + this._t * star.orbitHz * Math.PI * 2;
    return {
      x: base.x + NEST_RADIUS * Math.cos(a),
      y: base.y + NEST_RADIUS * 0.7 * Math.sin(a) + 2.5 * Math.sin(this._t * 2.1 + star.bobPhase),
    };
  }

  /**
   * @param {{x:number,y:number}} base Midasus's position — the secure base
   * @param {number} calmLevel 0..1, 1 = calm (CalmDirector.level)
   * @param {{x:number,y:number}|null} interest optional point of interest a
   *   trip aims near (e.g. Midio); trips wander around the base otherwise
   */
  update(nowMs, dtSec, base, calmLevel = 0, interest = null) {
    this._t += dtSec;
    const loud = calmLevel < RECALL_CALM;
    for (const star of this.stars) {
      if (!star.placed) { // first frame: materialize on the nest slot
        const s = this._slot(star, base);
        star.x = s.x; star.y = s.y; star.placed = true;
      }
      star.spin += star.spinHz * dtSec * Math.PI * 2;

      if (star.state === 'nest') {
        star.cooldownSec -= dtSec;
        const mayExplore = !this.explorer && calmLevel >= EXPLORE_MIN_CALM && star.cooldownSec <= 0;
        if (mayExplore) {
          star.state = 'explore';
          star.tripSec = 0;
          star.tripEndSec = TRIP_MIN_SEC + (TRIP_MAX_SEC - TRIP_MIN_SEC) * this.rand();
          const ang = this.rand() * Math.PI * 2;
          const reach = EXPLORE_RANGE * (0.45 + 0.55 * this.rand());
          const ax = interest ? base.x * 0.4 + interest.x * 0.6 : base.x;
          const ay = interest ? base.y * 0.5 + interest.y * 0.5 : base.y;
          star.target = { x: ax + Math.cos(ang) * reach, y: ay + Math.sin(ang) * reach * 0.6 };
        }
      } else if (star.state === 'explore') {
        star.tripSec += dtSec;
        // Mid-trip curiosity: the target itself drifts a little.
        star.target.x += 14 * dtSec * Math.sin(this._t * 1.7 + star.bobPhase);
        star.target.y += 10 * dtSec * Math.cos(this._t * 1.3 + star.bobPhase);
        if (loud || star.tripSec >= star.tripEndSec) star.state = 'return';
      } else if (star.state === 'return') {
        const s = this._slot(star, base);
        if (Math.hypot(star.x - s.x, star.y - s.y) < HOME_EPS) {
          star.state = 'nest';
          star.cooldownSec = COOLDOWN_MIN_SEC + (COOLDOWN_MAX_SEC - COOLDOWN_MIN_SEC) * this.rand();
        }
      }

      const goal = star.state === 'explore' ? star.target : this._slot(star, base);
      // Returning home under a loud sky is urgent; exploring is a saunter.
      const urgency = star.state === 'return' && loud ? 2.2 : star.state === 'explore' ? 0.55 : 1;
      star.vx += (KP * urgency * (goal.x - star.x) - KD * star.vx) * dtSec;
      star.vy += (KP * urgency * (goal.y - star.y) - KD * star.vy) * dtSec;
      star.x += star.vx * dtSec;
      star.y += star.vy * dtSec;
    }
  }

  draw(ctx, hue, rest = 0) {
    if (!this._meshRest) this._meshRest = computeRestLengths(BABY_STAR_MESH);
    const sat = Math.round(52 - 22 * rest);
    this.stars.forEach((star, i) => {
      const h = (hue + 24 * (i - 1) + 360) % 360;
      const away = star.state !== 'nest';
      drawMeshPart(ctx, BABY_STAR_MESH, this._meshRest, {
        tx: star.x, ty: star.y, rot: star.spin,
        scaleX: away ? 1.15 : 1, scaleY: away ? 1.15 : 1,
      }, h, { satBase: sat, lightBase: 74, alpha: away ? 0.95 : 0.8, widthBase: 1.2, hueSpread: 18 });
    });
  }
}
