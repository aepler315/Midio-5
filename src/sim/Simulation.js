// Fixed-timestep simulation container (spec §0.2 rule 3, §6.1). Owns every
// gameplay system and exposes prev/current snapshots so the renderer can
// interpolate smoothly between 120 Hz sim steps regardless of display refresh.
import { Role } from '../core/NoteEvent.js';
import { Midio } from './Midio.js';
import { JumpController, A, GAMMA, W, H_BASE, D_MIN } from './JumpController.js';
import { CameraDirector } from '../render/CameraDirector.js';
import { ComboSystem } from './ComboSystem.js';
import { ImpactFX } from './ImpactFX.js';
import { TelegraphScanner } from './TelegraphScanner.js';
import { ObstacleSpawner } from './ObstacleSpawner.js';

const WORLD_SPEED_PX_S = 220;
const CLEAN_WINDOW_MS = 90;
// v_ref = 2*Ha_max/(gamma*D_min) — the fastest "typical" landing (spec §2.2.1).
const V_REF = (2 * (1 - W) * H_BASE * 1.4) / (GAMMA * D_MIN);

export class Simulation {
  constructor(conductor, paramBus, { bpm = 120 } = {}) {
    this.conductor = conductor;
    this.paramBus = paramBus;

    this.midio = new Midio();
    this.jump = new JumpController(paramBus);
    this.camera = new CameraDirector();
    this.comboSystem = new ComboSystem();
    this.impactFX = new ImpactFX();
    this.telegraph = new TelegraphScanner();
    this.obstacles = new ObstacleSpawner(paramBus);
    this.obstacles.buildCandidates(conductor.timeline, 60000 / bpm);

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
    const dtSec = dtMs / 1000;

    this.jump.clearFrameFlags();
    this.comboSystem.clearFrameFlags();

    this.conductor.dispatchUpTo(nowMs);
    this.jump.update(nowMs);
    this.midio.y = this.jump.y;

    if (this.jump.pendingLanding) {
      const nearestKick = this.conductor.nearestEventMs(
        (e) => e.role === Role.RHYTHM && e.kick, nowMs, CLEAN_WINDOW_MS + 20,
      );
      const isClean = ComboSystem.isCleanLanding(nowMs, nearestKick ? nearestKick.tMs : null);
      this.comboSystem.onLanding(nowMs, isClean);
      const I = ImpactFX.intensity(this.jump.pendingLanding.vLandPxMs, V_REF);
      this.impactFX.trigger(this.worldX, this.midio.groundY, I, this.camera);
    }

    const stumbled = this.obstacles.checkCollision(this.worldX, this.midio.halfWidth, this.jump.y);
    if (stumbled) this.comboSystem.onStumble();

    this.comboSystem.update(nowMs, this.jump.beatPeriodMs);

    const worldSpeed = WORLD_SPEED_PX_S * this.paramBus.live.scrollSpeed;
    this.worldX += worldSpeed * dtSec;

    this.obstacles.update(nowMs, this.worldX, worldSpeed / 1000);
    this.telegraph.update(nowMs, this.conductor, this.midio, this.jump, this.impactFX, this.worldX, this.midio.groundY, this.obstacles);
    this.impactFX.step(dtSec);
    this.camera.update(dtSec);
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
