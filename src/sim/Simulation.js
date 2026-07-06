// Fixed-timestep simulation container (spec §0.2 rule 3, §6.1). Owns every
// gameplay system and exposes prev/current snapshots so the renderer can
// interpolate smoothly between 120 Hz sim steps regardless of display refresh.
import { Role } from '../core/NoteEvent.js';
import { Midio } from './Midio.js';
import { JumpController, A, GAMMA, W, H_BASE, D_MIN } from './JumpController.js';
import { MidioPerformer } from './MidioPerformer.js';
import { CalmDirector } from './CalmDirector.js';
import { CameraDirector } from '../render/CameraDirector.js';
import { ComboSystem } from './ComboSystem.js';
import { ImpactFX } from './ImpactFX.js';
import { TelegraphScanner } from './TelegraphScanner.js';
import { ObstacleSpawner } from './ObstacleSpawner.js';
import { Midasus } from './Midasus.js';
import { Broshi } from './Broshi.js';
import { BiomeManager } from '../world/BiomeManager.js';
import { FractureEngine } from '../world/FractureEngine.js';
import { GroundField } from '../world/GroundField.js';
import { hashSeed } from '../utils/math.js';

const WORLD_SPEED_PX_S = 220;
const CLEAN_WINDOW_MS = 90;
// v_ref = 2*Ha_max/(gamma*D_min) — the fastest "typical" landing (spec §2.2.1).
const V_REF = (2 * (1 - W) * H_BASE * 1.4) / (GAMMA * D_MIN);

export class Simulation {
  constructor(conductor, paramBus, { bpm = 120, energyCurves = null, canvasWidth = 1280, canvasHeight = 720 } = {}) {
    this.conductor = conductor;
    this.paramBus = paramBus;
    this.energyCurves = energyCurves;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    this.midio = new Midio({ canvasWidth, canvasHeight });
    this.jump = new JumpController(paramBus);
    this.camera = new CameraDirector();
    this.comboSystem = new ComboSystem();
    this.impactFX = new ImpactFX();
    this.telegraph = new TelegraphScanner();
    this.obstacles = new ObstacleSpawner(paramBus);
    this.obstacles.buildCandidates(conductor.timeline, 60000 / bpm, {
      energyCurves: this.energyCurves,
      barGrid: conductor.barGrid,
    });

    // worldScale keeps companion excursion amplitudes (tuned against a 1280px
    // reference) proportional to the actual canvas, so the cast's roam range
    // scales with the screen instead of staying pinned to fixed pixel offsets.
    const worldScale = canvasWidth / 1280;
    this.midasus = new Midasus(conductor, this.midio, {
      groundY: this.midio.groundY, ceilingY: canvasHeight * (40 / 720), worldScale,
    });
    this.broshi = new Broshi(conductor, paramBus, { worldScale });
    this.broshi._lastBarPeriodMs = (60000 / bpm) * 4;

    this.performer = new MidioPerformer({ seed: 1313 });
    this.performer.setMidasus(this.midasus);
    this.calm = new CalmDirector();

    const songSeed = hashSeed(`${conductor.timeline.length}:${conductor.durationMs}:${conductor.timeline[0]?.tMs ?? 0}:${conductor.timeline.at(-1)?.tMs ?? 0}`);
    this.ground = new GroundField({
      baseY: this.midio.groundY, canvasWidth, durationMs: conductor.durationMs,
      barGrid: conductor.barGrid, beatMs: 60000 / bpm,
      obstacleTimes: this.obstacles.candidates.map((c) => c.tMs), seed: songSeed,
    });
    this.biomes = new BiomeManager({
      conductor, paramBus, energyCurves, durationMs: conductor.durationMs,
      canvasWidth, canvasHeight, groundY: this.midio.groundY, songSeed,
    });
    this.fracture = new FractureEngine(conductor, {
      canvasWidth, canvasHeight, songSeed, durationMs: conductor.durationMs,
    });

    this.worldX = 0;
    this.timeMs = 0;
    this.perfMul = 1; // set by the perf governor (spec §6.2); 1 = full quality

    this.prev = this._snapshot();
    this.curr = this._snapshot();

    conductor.on(Role.RHYTHM, (evt) => {
      if (evt.kick) {
        // Accommodation: pass the nearest upcoming obstacle with its terrain-
        // aware effective height so JumpController can floor H for clearance.
        const o = this.obstacles.nearestAhead(this.worldX);
        const obstacle = o ? {
          tMs: o.tMs,
          height: o.height + (this.midio.groundY - this.ground.heightAt(o.wx, this.timeMs)),
        } : null;
        this.jump.onKick(evt, this.timeMs, obstacle, this.comboSystem.M);
      }
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

    // Ground field: drives the rolling terrain + gag, then becomes Midio's
    // local ground line so renderY (= groundY - y) follows the surface.
    this.ground.update(nowMs, dtSec, this.energyCurves, this.worldX);
    this.midio.groundY = this.ground.heightAt(this.worldX, nowMs);

    if (this.jump.pendingLanding) {
      const nearestKick = this.conductor.nearestEventMs(
        (e) => e.role === Role.RHYTHM && e.kick, nowMs, CLEAN_WINDOW_MS + 20,
      );
      const isClean = ComboSystem.isCleanLanding(nowMs, nearestKick ? nearestKick.tMs : null);
      this.comboSystem.onLanding(nowMs, isClean);
      const I = ImpactFX.intensity(this.jump.pendingLanding.vLandPxMs, V_REF);
      this.impactFX.trigger(this.worldX, this.midio.groundY, I, this.camera);
      this.fracture.registerImpact(I);
    }

    // Gag FX: crack-dust at the sag, camera punch + shake at the recovery.
    if (this.ground.justSagged) this.impactFX.dustBurst(this.worldX + 120, this.midio.groundY, 20);
    if (this.ground.justRecovered) { this.camera.punch(1.07); this.camera.shake(14); }

    const stumbled = this.obstacles.checkCollision(this.worldX, this.midio.halfWidth, this.jump.y, this.ground, nowMs);
    if (stumbled) this.comboSystem.onStumble();

    this.comboSystem.update(nowMs, this.jump.beatPeriodMs);

    const worldSpeed = WORLD_SPEED_PX_S * this.paramBus.live.scrollSpeed;
    this.worldX += worldSpeed * dtSec;

    this.obstacles.update(nowMs, this.worldX, worldSpeed / 1000);
    this.telegraph.update(nowMs, this.conductor, this.midio, this.jump, this.impactFX, this.worldX, this.midio.groundY, this.obstacles);

    // Midio stage presence: writes scale/lean/poseExtras from telegraph.a + jump/combo state.
    this.performer.update(nowMs, dtSec, this.jump, this.comboSystem, this.calm, this.midio, this.conductor, this.telegraph);
    this.impactFX.step(dtSec);

    this.calm.update(nowMs, dtSec, this.energyCurves);

    this.midasus.update(nowMs, dtSec, this.calm);
    this.broshi.update(nowMs, dtSec, this.midio, this.energyCurves, this.obstacles, this.worldX, this.midio.groundY, this.calm);
    this.biomes.update(nowMs, dtSec, this.energyCurves, this.calm, this.perfMul);
    this.fracture.update(nowMs, dtSec, this.energyCurves, this.camera);

    const comboZoom = 1 + 0.04 * Math.max(0, this.comboSystem.M - 1);
    if (comboZoom > 1.01) this.camera.punch(comboZoom);
    this.camera.update(dtSec, this.calm);
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
      mesh: { ...this.midio.poseExtras },
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
      mesh: c.mesh || {},
      airborne: this.jump.airborne,
    };
  }
}
