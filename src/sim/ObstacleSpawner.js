// World obstacles seeded from RHYTHM events away from any kick (spec §2.2.3
// final paragraph). Since Midio's jumps are entirely music-driven (no player
// input), obstacle placement is designed to be clearable by the deterministic
// jump arc; density only thins candidates, it never relocates them.
import { Role } from '../core/NoteEvent.js';
import { clamp, mulberry32 } from '../utils/math.js';

const SPAWN_LEAD_MS = 2500;
const MIN_VEL = 0.55;
const MIN_KICK_DISTANCE_BEATS = 1.5;

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
    for (const e of timeline) if (e.role === Role.RHYTHM && e.kick) kicks.push(e.tMs);

    let ki = 0;
    let lastAccepted = -Infinity;
    const minGap = Math.max(beatPeriodMsGuess, 420);
    const minKickDist = MIN_KICK_DISTANCE_BEATS * beatPeriodMsGuess;

    for (const e of timeline) {
      if (e.role !== Role.RHYTHM || e.kick || e.vel < MIN_VEL) continue;
      while (ki + 1 < kicks.length && kicks[ki + 1] <= e.tMs) ki++;
      const dPrev = ki < kicks.length ? Math.abs(e.tMs - kicks[ki]) : Infinity;
      const dNext = ki + 1 < kicks.length ? Math.abs(e.tMs - kicks[ki + 1]) : Infinity;
      if (Math.min(dPrev, dNext) < minKickDist) continue;
      if (e.tMs - lastAccepted < minGap) continue;
      this.candidates.push({ tMs: e.tMs });
      lastAccepted = e.tMs;
    }
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

  /** Marks crossed obstacles as passed; returns true if Midio was too low to clear one. */
  checkCollision(worldX, halfWidth, jumpYPx) {
    let stumbled = false;
    for (const o of this.active) {
      if (o.passed) continue;
      if (Math.abs(o.wx - worldX) <= halfWidth + o.width / 2) {
        if (jumpYPx < o.height) stumbled = true;
        o.passed = true;
      }
    }
    return stumbled;
  }

  draw(ctx, worldX, originX, groundY) {
    for (const o of this.active) {
      const x = o.wx - worldX + originX;
      if (x < -60 || x > 2200) continue;
      ctx.fillStyle = '#8a3a6b';
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(x - o.width / 2, groundY - o.height, o.width, o.height);
      ctx.strokeRect(x - o.width / 2, groundY - o.height, o.width, o.height);
    }
  }
}
