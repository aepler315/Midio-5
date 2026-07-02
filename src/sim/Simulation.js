// Fixed-timestep simulation container (spec §0.2 rule 3, §6.1). Owns every
// gameplay system and exposes prev/current snapshots so the renderer can
// interpolate smoothly between 120 Hz sim steps regardless of display refresh.
import { Role } from '../core/NoteEvent.js';
import { Midio } from './Midio.js';
import { JumpController } from './JumpController.js';
import { CameraDirector } from '../render/CameraDirector.js';

const WORLD_SPEED_PX_S = 220;

export class Simulation {
  constructor(conductor, paramBus) {
    this.conductor = conductor;
    this.paramBus = paramBus;

    this.midio = new Midio();
    this.jump = new JumpController(paramBus);
    this.camera = new CameraDirector();

    this.worldX = 0;
    this.timeMs = 0;

    this.prev = this._snapshot();
    this.curr = this._snapshot();

    conductor.on(Role.RHYTHM, (evt) => {
      if (evt.kick) this.jump.onKick(evt, this.timeMs);
    });
  }

  step(dtMs, nowMs) {
    this.prev = this.curr;
    this.timeMs = nowMs;

    this.jump.clearFrameFlags();
    this.conductor.dispatchUpTo(nowMs);
    this.jump.update(nowMs);
    this.midio.y = this.jump.y;

    const worldSpeed = WORLD_SPEED_PX_S * this.paramBus.live.scrollSpeed;
    this.worldX += worldSpeed * (dtMs / 1000);

    this.camera.update(dtMs / 1000);
    this.paramBus.step();

    this.curr = this._snapshot();
  }

  _snapshot() {
    return {
      worldX: this.worldX,
      midioY: this.midio.renderY,
      scaleX: this.midio.scaleX,
      scaleY: this.midio.scaleY,
      leanDeg: this.midio.leanDeg,
    };
  }

  /** alpha in [0,1] — blend between the last two sim states for a jitter-free render. */
  lerpState(alpha) {
    const p = this.prev, c = this.curr;
    const lerp = (a, b) => a + (b - a) * alpha;
    return {
      worldX: lerp(p.worldX, c.worldX),
      midioX: this.midio.screenX,
      midioY: lerp(p.midioY, c.midioY),
      scaleX: lerp(p.scaleX, c.scaleX),
      scaleY: lerp(p.scaleY, c.scaleY),
      leanDeg: lerp(p.leanDeg, c.leanDeg),
      airborne: this.jump.airborne,
    };
  }
}
