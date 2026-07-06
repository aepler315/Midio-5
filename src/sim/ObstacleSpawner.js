// World obstacles placed under Midio's predicted jump arcs (spec §2.2.3 final
// paragraph, item 4). Since Midio's jumps are entirely music-driven (no player
// input), obstacle placement is a contract with the deterministic jump
// schedule: colliding terraces snap into covered arc windows; weak phrase
// accents become decorative props that never trip collision.
import { Role } from '../core/NoteEvent.js';
import { mulberry32 } from '../utils/math.js';
import { planTerraces } from './TerrainHazardPlanner.js';

const SPAWN_LEAD_MS = 2500;

export class ObstacleSpawner {
  constructor(paramBus, { seed = 99, width = 28 } = {}) {
    this.P = paramBus;
    this.candidates = [];
    this.nextCandidateIdx = 0;
    this.active = [];
    this.rand = mulberry32(seed);
    this.width = width;
  }

  buildCandidates(timeline, beatPeriodMsGuess, { energyCurves = null, barGrid = [] } = {}) {
    const kicks = [];
    for (const e of timeline) if (e.role === Role.RHYTHM && e.kick) kicks.push({ tMs: e.tMs, vel: e.vel });

    this.candidates = planTerraces({
      timeline,
      barGrid,
      kicks,
      energyCurves,
      obstacleDensity: this.P.live.obstacleDensity,
      jumpHeight: this.P.live.jumpHeight,
      beatPeriodMs: beatPeriodMsGuess,
      rand: this.rand,
    });
  }

  update(nowMs, worldX, scrollSpeedPxMs) {
    while (
      this.nextCandidateIdx < this.candidates.length &&
      this.candidates[this.nextCandidateIdx].tMs <= nowMs + SPAWN_LEAD_MS
    ) {
      const c = this.candidates[this.nextCandidateIdx++];
      if (c.tMs < nowMs) continue;
      const wx = worldX + scrollSpeedPxMs * (c.tMs - nowMs);
      this.active.push({
        wx,
        tMs: c.tMs,
        height: c.height,
        width: c.width ?? this.width,
        kind: c.kind ?? 'terrace',
        colliding: c.colliding !== false,
        passed: false,
      });
    }
    while (this.active.length && this.active[0].wx < worldX - 400) this.active.shift();
  }

  nearestAhead(worldX) {
    for (const o of this.active) if (o.wx >= worldX && o.colliding !== false) return o;
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
        o.passed = true;
        if (o.colliding === false) continue;
        // Spatial overlap can precede the musical crossing — only judge clearance
        // once sim time has reached the obstacle's scheduled tMs.
        if (nowMs < o.tMs - 40) continue;
        const effH = ground ? o.height + (gM - ground.heightAt(o.wx, nowMs)) : o.height;
        if (jumpYPx < effH) stumbled = true;
      }
    }
    return stumbled;
  }

  draw(ctx, worldX, originX, groundY, ground = null, nowMs = 0, edgeLight = null) {
    for (const o of this.active) {
      const x = o.wx - worldX + originX;
      if (x < -60 || x > 2200) continue;
      const baseY = ground ? ground.heightAt(o.wx, nowMs) : groundY;
      const left = x - o.width / 2;
      const top = baseY - o.height;

      const isProp = o.colliding === false;
      const bodyGrad = ctx.createLinearGradient(0, top, 0, baseY);
      if (isProp) {
        bodyGrad.addColorStop(0, edgeLight ? 'rgba(60,80,90,0.55)' : 'rgba(70,90,100,0.65)');
        bodyGrad.addColorStop(1, edgeLight ? 'rgba(30,40,50,0.45)' : 'rgba(40,55,65,0.55)');
      } else {
        bodyGrad.addColorStop(0, edgeLight ? 'rgba(80,40,70,0.95)' : '#8a3a6b');
        bodyGrad.addColorStop(1, edgeLight ? 'rgba(40,15,35,0.90)' : '#5a244d');
      }
      ctx.fillStyle = bodyGrad;
      ctx.fillRect(left, top, o.width, o.height);

      if (edgeLight) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = edgeLight;
        ctx.lineWidth = isProp ? 1 : 2;
        ctx.shadowColor = edgeLight;
        ctx.shadowBlur = isProp ? 4 : 10;
        ctx.beginPath();
        ctx.moveTo(left, top);
        ctx.lineTo(left + o.width, top);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.strokeStyle = isProp ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(left, top, o.width, o.height);
      }
    }
  }
}