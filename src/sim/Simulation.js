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
import { Midasus } from './Midasus.js';
import { Broshi } from './Broshi.js';
import { MidioPerformer } from './MidioPerformer.js';
import { CalmDirector } from './CalmDirector.js';
import { GnatGag } from './GnatGag.js';
import { HypeDirector } from './HypeDirector.js';
import { VibeDirector } from './VibeDirector.js';
import { EnsembleDirector } from './EnsembleDirector.js';
import { ExcursionDirector } from './ExcursionDirector.js';
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

    this.midio = new Midio();
    this.jump = new JumpController(paramBus);
    this.camera = new CameraDirector();
    this.comboSystem = new ComboSystem();
    this.impactFX = new ImpactFX();
    this.telegraph = new TelegraphScanner();
    this.obstacles = new ObstacleSpawner(paramBus);
    this.obstacles.buildCandidates(conductor.timeline, 60000 / bpm, this.midio.halfWidth);

    this.midasus = new Midasus(conductor.timeline, this.midio, {
      groundY: this.midio.groundY, ceilingY: 40, stageW: canvasWidth, stageH: canvasHeight,
    });
    this.broshi = new Broshi(conductor, paramBus);
    this.broshi._lastBarPeriodMs = (60000 / bpm) * 4;

    const songSeed = hashSeed(`${conductor.timeline.length}:${conductor.durationMs}:${conductor.timeline[0]?.tMs ?? 0}:${conductor.timeline.at(-1)?.tMs ?? 0}`);
    this.performer = new MidioPerformer(songSeed);
    this.calm = new CalmDirector();
    this.hype = new HypeDirector();
    this.vibe = new VibeDirector(conductor.timeline);
    this.ensemble = new EnsembleDirector(songSeed, { stageW: canvasWidth, stageH: canvasHeight });
    this.excursions = new ExcursionDirector(conductor.durationMs || 0);
    this.gnat = new GnatGag(songSeed, { canvasWidth, canvasHeight });
    this.groundField = new GroundField(this.midio.groundY, {
      conductor, durationMs: conductor.durationMs, songSeed,
    });
    this.biomes = new BiomeManager({
      conductor, energyCurves, durationMs: conductor.durationMs,
      canvasWidth, canvasHeight, groundY: this.midio.groundY, songSeed,
      groundField: this.groundField,
    });
    this.fracture = new FractureEngine(conductor, {
      canvasWidth, canvasHeight, songSeed, durationMs: conductor.durationMs,
    });

    this.worldX = 0;
    this.timeMs = 0;

    this.prev = this._snapshot();
    this.curr = this._snapshot();

    conductor.on(Role.RHYTHM, (evt) => {
      if (evt.kick) {
        this.jump.onKick(evt);
        this.gnat.onKick(evt);
        this.performer.onKick();
        this.hype.onKick(evt.vel);
      }
    });
  }

  step(dtMs, nowMs) {
    this.prev = this.curr;
    this.timeMs = nowMs;
    const dtSec = dtMs / 1000;

    this.jump.clearFrameFlags();
    this.comboSystem.clearFrameFlags();
    this.performer.clearFrameFlags();

    this.conductor.dispatchUpTo(nowMs);
    this.calm.update(nowMs, dtSec, this.energyCurves);
    this.hype.update(nowMs, dtSec, this.energyCurves);
    this.vibe.update(nowMs, dtSec, this.energyCurves);
    this.ensemble.update(nowMs, dtSec, this.vibe, this.jump.beatPeriodMs);
    // Midio roams toward his ensemble anchor -- slow, never gameplay-fast.
    const dxA = this.ensemble.anchors[0].x - this.midio.screenX;
    this.midio.screenX += Math.max(-30 * dtSec, Math.min(30 * dtSec, dxA));
    this.jump.update(nowMs);
    this.midio.y = this.jump.y;

    this.groundField.update(nowMs, dtSec, this.worldX, this.energyCurves);
    this.midio.groundY = this.groundField.heightAt(this.worldX);
    if (this.groundField.justRecovered) this.camera.shake(10);

    if (this.jump.pendingLanding) {
      const nearestKick = this.conductor.nearestEventMs(
        (e) => e.role === Role.RHYTHM && e.kick, nowMs, CLEAN_WINDOW_MS + 20,
      );
      const isClean = ComboSystem.isCleanLanding(nowMs, nearestKick ? nearestKick.tMs : null);
      const I = ImpactFX.intensity(this.jump.pendingLanding.vLandPxMs, V_REF);
      this.comboSystem.onLanding(nowMs, isClean);
      this.performer.onLanding(nowMs, this.comboSystem.justClean, this.comboSystem.displayM, I);
      this.performer.onStreak(this.comboSystem.streak, nowMs);
      this.impactFX.trigger(this.worldX, this.midio.groundY, I, this.camera);
      if (this.comboSystem.justClean) this.impactFX.splat(this.worldX, this.midio.groundY);
      this.fracture.registerImpact(I);
    }

    const stumbled = this.obstacles.checkCollision(this.worldX, this.midio.halfWidth, this.jump.y);
    if (stumbled) this.comboSystem.onStumble();

    this.comboSystem.update(nowMs, this.jump.beatPeriodMs);

    const worldSpeed = WORLD_SPEED_PX_S * this.paramBus.live.scrollSpeed;
    this.worldX += worldSpeed * dtSec;

    this.obstacles.update(nowMs, this.worldX, worldSpeed / 1000);
    this.telegraph.update(nowMs, this.conductor, this.midio, this.jump, this.impactFX, this.worldX, this.midio.groundY, this.obstacles);
    this.performer.update(nowMs, dtSec, this.midio, this.jump, this.comboSystem, this.calm.level, this.ensemble);
    this.impactFX.step(dtSec);

    // Decides whether Midasus or Broshi leaves the ensemble this frame;
    // triggering here (before their own update() calls below) means a
    // freshly-launched excursion starts animating in this very frame
    // rather than waiting one extra tick.
    this.excursions.update(nowMs, dtSec, {
      vibe: this.vibe, calm: this.calm, hype: this.hype, energyCurves: this.energyCurves,
      conductor: this.conductor, midasus: this.midasus, broshi: this.broshi, worldX: this.worldX,
    });

    this.midasus.update(nowMs, dtSec, this.calm.level, {
      x: this.ensemble.anchors[2].x, y: this.ensemble.anchors[2].y,
      phase: this.ensemble.phase(2), melt: 2 + 4.5 * this.vibe.epic, epic: this.vibe.epic,
    });
    // She's off on a voyage -> the ensemble's Kuramoto math should feel the
    // hole (this takes effect next frame; the weight eases over ~1.5s
    // regardless, so the one-step lag is inaudible/invisible).
    this.ensemble.setPresence(2, this.midasus.voyage.active ? 0 : 1);
    this.broshi.update(nowMs, dtSec, this.midio, this.energyCurves, this.obstacles, this.worldX, this.midio.groundY, this.calm.level, {
      trailX: this.ensemble.anchors[1].x, phase: this.ensemble.phase(1), melt: 1.8 + 4 * this.vibe.epic,
    }, this.groundField);
    // He's underground -> same presence handoff as Midasus's voyage.
    this.ensemble.setPresence(1, this.broshi.burrow.active ? 0 : 1);
    this.biomes.hypeBoost = 1 + 0.6 * this.hype.surge; // drops surge every phenomena system
    this.biomes.update(nowMs, dtSec, this.energyCurves, this.calm.level);
    if (this.biomes.cutFlashJustFired) { this.camera.punch(1.06); this.camera.shake(6); }
    this.fracture.update(nowMs, dtSec, this.energyCurves, this.camera);

    this.gnat.update(nowMs, dtSec, this.calm.level);
    this.camera.update(dtSec, this.calm.level);
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
