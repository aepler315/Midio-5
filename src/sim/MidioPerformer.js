// Midio's stage presence (follow-up item 6): apex tricks, motion-streak
// afterimages, a landing flourish on hot combos, beat-synced idle strut,
// and a gold flash + HUD pulse at combo milestones. Layered on top of
// JumpController/TelegraphScanner rather than replacing them -- this class
// only ever *adds* to midio.leanDeg/scaleY or briefly overrides scale
// during a flourish window, so the underlying physics never changes.
import { mulberry32, clamp, smoothstep } from '../utils/math.js';
import { ModalRing } from '../render/oscillators.js';

const TRICK_HANG_START = 0.35; // matches JumpController's A
const TRICK_HANG_END = 0.65;   // matches JumpController's A+B
const TRICK_VEL_THRESHOLD = 0.8;
const TRICK_COMBO_THRESHOLD = 2.0;
const MILESTONES = [5, 10, 20];
const FLOURISH_MS = 90;
const FLOURISH_COMBO_THRESHOLD = 2.0;
const GOLD_FLASH_DECAY_SEC = 0.6;
const AFTERIMAGE_INTERVAL_MS = 28;
const AFTERIMAGE_COUNT = 4;
const STRUT_DEG = 2.2;

// Calm/idle behavior (follow-up item 3): distinctly relaxed vs. energetic
// sections, but never inert. Gated to !airborne so it never fights a trick.
const BREATH_HZ = 0.25;
const BREATH_AMP = 0.02;
const CALM_SWAY_DEG = 3.0;
const CALM_DRIFT_PX = 3.0;
const CALM_DRIFT_HZ = 0.2;
const BLINK_MIN_GAP_MS = 2500;
const BLINK_JITTER_MS = 3000;
const BLINK_DUR_MS = 180;
const BLINK_CALM_THRESHOLD = 0.3;

export class MidioPerformer {
  constructor(seed = 4242) {
    this.rand = mulberry32(seed);
    this._lastTrickType = null;
    this.trick = null; // {type, jumpStartMs, D}
    this._wasAirborne = false;
    this.spinDeg = 0;

    this._flourishUntilMs = -Infinity;

    this._lastMilestoneIdx = -1;
    this.milestoneFlash = false; // one-shot per step
    this.goldFlash = 0;

    this.afterimages = [];
    this._lastCaptureMs = -Infinity;

    this.blinkScale = 1; // 1 = eye open, 0 = fully closed
    this._nextBlinkMs = BLINK_MIN_GAP_MS + this.rand() * BLINK_JITTER_MS;
    this._blinkStartMs = -Infinity;

    // Modal body vibration: struck on landings (scaled by impact intensity)
    // and lightly on takeoff, rung down over ~half a second. The Renderer
    // displaces MIDIO_BODY's rim through this field.
    this.modal = new ModalRing({ modes: 4, baseHz: 8, decaySec: 0.55, seed: (seed ^ 0x9e37) >>> 0 });
  }

  clearFrameFlags() {
    this.milestoneFlash = false;
  }

  onLanding(nowMs, isClean, comboDisplay, intensity = 0) {
    if (isClean && comboDisplay >= FLOURISH_COMBO_THRESHOLD) this._flourishUntilMs = nowMs + FLOURISH_MS;
    this.modal.excite(1.5 + 4.5 * intensity);
  }

  onStreak(streak) {
    let idx = -1;
    for (let i = 0; i < MILESTONES.length; i++) if (streak >= MILESTONES[i]) idx = i;
    if (idx > this._lastMilestoneIdx) {
      this._lastMilestoneIdx = idx;
      this.milestoneFlash = true;
      this.goldFlash = 1;
    }
  }

  update(nowMs, dtSec, midio, jump, comboSystem, calmLevel = 0) {
    this.modal.update(dtSec);
    const justLaunched = !this._wasAirborne && jump.airborne;
    if (justLaunched) {
      this.modal.excite(0.8 + 1.6 * jump.lastLaunchVel);
      const shouldTrick = jump.lastLaunchVel > TRICK_VEL_THRESHOLD || comboSystem.displayM >= TRICK_COMBO_THRESHOLD;
      if (shouldTrick) {
        let type = this.rand() < 0.5 ? 'spin' : 'backflip';
        if (type === this._lastTrickType) type = type === 'spin' ? 'backflip' : 'spin'; // never twice in a row
        this.trick = { type, jumpStartMs: jump.jumpStartMs, D: jump.D };
        this._lastTrickType = type;
      } else {
        this.trick = null;
      }
    }
    this._wasAirborne = jump.airborne;
    if (!jump.airborne) this.trick = null;

    this.spinDeg = 0;
    let flipFactor = 1;
    if (this.trick && jump.airborne) {
      const u = clamp((nowMs - this.trick.jumpStartMs) / this.trick.D, 0, 1);
      const progress = smoothstep(TRICK_HANG_START, TRICK_HANG_END, u);
      if (this.trick.type === 'spin') this.spinDeg = 360 * progress;
      else flipFactor = Math.cos(progress * Math.PI); // 1 -> -1 -> 1, a 2D flip illusion
    }

    // Composite on top of whatever TelegraphScanner already wrote this step.
    midio.leanDeg += this.spinDeg;
    midio.scaleY *= flipFactor;

    if (nowMs < this._flourishUntilMs) {
      midio.scaleY = 0.65;
      midio.scaleX = 1.55;
    }

    if (!jump.airborne && jump.beatPeriodMs > 0) {
      const phase = (nowMs % jump.beatPeriodMs) / jump.beatPeriodMs;
      // Energetic strut damps down as calm rises; a slower, gentler sway
      // (half the frequency -- "synced to beat halves") takes its place, so
      // quiet sections read as distinctly relaxed without ever going still.
      const strutAmp = STRUT_DEG * (1 - 0.5 * calmLevel);
      const swayAmp = CALM_SWAY_DEG * calmLevel;
      midio.leanDeg += strutAmp * Math.sin(phase * Math.PI * 2) + swayAmp * Math.sin(phase * Math.PI + 1.7);
    }

    if (!jump.airborne && nowMs >= this._flourishUntilMs) {
      // Slow breathing cycle + a light coasting drift, both calm-scaled.
      const tSec = nowMs / 1000;
      midio.scaleY *= 1 + BREATH_AMP * calmLevel * Math.sin(2 * Math.PI * BREATH_HZ * tSec);
      midio.y += CALM_DRIFT_PX * calmLevel * Math.sin(2 * Math.PI * CALM_DRIFT_HZ * tSec);

      if (calmLevel > BLINK_CALM_THRESHOLD && nowMs >= this._nextBlinkMs) {
        this._blinkStartMs = nowMs;
        this._nextBlinkMs = nowMs + BLINK_MIN_GAP_MS + this.rand() * BLINK_JITTER_MS;
      }
    }
    const sinceBlink = nowMs - this._blinkStartMs;
    this.blinkScale = sinceBlink < BLINK_DUR_MS
      ? Math.abs(sinceBlink / BLINK_DUR_MS - 0.5) * 2
      : 1;

    this.goldFlash = Math.max(0, this.goldFlash - dtSec / GOLD_FLASH_DECAY_SEC);

    if (jump.airborne && nowMs - this._lastCaptureMs >= AFTERIMAGE_INTERVAL_MS) {
      this._lastCaptureMs = nowMs;
      this.afterimages.push({ y: midio.renderY, scaleX: midio.scaleX, scaleY: midio.scaleY, rot: midio.leanDeg });
      if (this.afterimages.length > AFTERIMAGE_COUNT) this.afterimages.shift();
    }
    if (!jump.airborne && this.afterimages.length) this.afterimages.length = 0;
  }
}
