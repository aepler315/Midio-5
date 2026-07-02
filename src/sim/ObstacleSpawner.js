// World obstacles placed under Midio's predicted jump arcs (spec §2.2.3 final
// paragraph, item 4). Since Midio's jumps are entirely music-driven (no player
// input), obstacle placement is a contract with the deterministic jump
// schedule: every candidate is snapped into the middle 50% of a covered arc,
// so Midio is guaranteed airborne when it passes. Density only thins
// candidates, it never relocates them.
import { Role } from '../core/NoteEvent.js';
import { clamp, mulberry32 } from '../utils/math.js';
import * as JumpPlanner from './JumpPlanner.js';

const SPAWN_LEAD_MS = 2500;
const MIN_VEL = 0.55;

export class ObstacleSpawner {
  constructor(paramBus, { seed = 99, height = 46, width = 28 } = {}) {
    this.P = paramBus;
    this.candidates = [];
    this.nextCandidateIdx = 0;
    this.active = [];
    this.rand = mulberry32(seed);
    this.height = height;
    this.width = width;
  }

  buildCandidates(timeline, beatPeriodMsGuess) {
    const kicks = [];
    for (const e of timeline) if (e.role === Role.RHYTHM && e.kick) kicks.push({ tMs: e.tMs, vel: e.vel });

    // Predict where Midio is airborne high enough to clear this obstacle.
    const windows = JumpPlanner.coveredWindows(kicks, {
      obstacleHeight: this.height,
      jumpHeight: this.P.live.jumpHeight,
    });

    let lastAccepted = -Infinity;
    const minGap = Math.max(beatPeriodMsGuess, 420);

    for (const e of timeline) {
      if (e.role !== Role.RHYTHM || e.kick || e.vel < MIN_VEL) continue;
      // Snap the salient seed into the nearest covered arc's middle 50%.
      const snap = JumpPlanner.snapToWindow(e.tMs, windows, this.rand);
      if (!snap) continue; // no arc clears this obstacle → drop, never place where unavoidable
      if (snap.placeMs - lastAccepted < minGap) continue;
      this.candidates.push({ tMs: snap.placeMs });
      lastAccepted = snap.placeMs;
    }
    // Candidates are consumed in tMs order by update(); snap jitter can break
    // that ordering, so sort once at build time.
    this.candidates.sort((a, b) => a.tMs - b.tMs);
  }

  update(nowMs, worldX, scrollSpeedPxMs) {
    while (
      this.nextCandidateIdx < this.candidates.length &&
      this.candidates[this.nextCandidateIdx].tMs <= nowMs + SPAWN_LEAD_MS
    ) {
      const c = this.candidates[this.nextCandidateIdx++];
      if (c.tMs < nowMs) continue;
      const p = clamp(0.5 * this.P.live.obstacleDensity, 0, 1);
      if (this.rand() > p) continue;
      const wx = worldX + scrollSpeedPxMs * (c.tMs - nowMs);
      this.active.push({ wx, tMs: c.tMs, height: this.height, width: this.width, passed: false });
    }
    while (this.active.length && this.active[0].wx < worldX - 400) this.active.shift();
  }

  nearestAhead(worldX) {
    for (const o of this.active) if (o.wx >= worldX) return o;
    return null;
  }

  /** Marks crossed obstacles as passed; returns true if Midio was too low to clear one.
   *  `ground` (GroundField) makes the effective obstacle height terrain-aware:
   *  effH = o.height + (groundAtMidio - groundAtObstacle). */
  checkCollision(worldX, halfWidth, jumpYPx, ground = null, nowMs = 0) {
    let stumbled = false;
    const gM = ground ? ground.heightAt(worldX, nowMs) : 0;
    for (const o of this.active) {
      if (o.passed) continue;
      if (Math.abs(o.wx - worldX) <= halfWidth + o.width / 2) {
        const effH = ground ? o.height + (gM - ground.heightAt(o.wx, nowMs)) : o.height;
        if (jumpYPx < effH) stumbled = true;
        o.passed = true;
      }
    }
    return stumbled;
  }

  draw(ctx, worldX, originX, groundY, ground = null, nowMs = 0) {
    for (const o of this.active) {
      const x = o.wx - worldX + originX;
      if (x < -60 || x > 2200) continue;
      const baseY = ground ? ground.heightAt(o.wx, nowMs) : groundY;
      ctx.fillStyle = '#8a3a6b';
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(x - o.width / 2, baseY - o.height, o.width, o.height);
      ctx.strokeRect(x - o.width / 2, baseY - o.height, o.width, o.height);
    }
  }
}
