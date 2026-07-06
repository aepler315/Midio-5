// World obstacles placed under Midio's predicted jump arcs (spec §2.2.3 final
// paragraph, item 4). Since Midio's jumps are entirely music-driven (no player
// input), obstacle placement is a contract with the deterministic jump
// schedule: colliding terraces snap into covered arc windows; weak phrase
// accents become decorative props that never trip collision.
import { Role } from '../core/NoteEvent.js';
import { mulberry32 } from '../utils/math.js';
import { planTerraces } from './TerrainHazardPlanner.js';

const SPAWN_LEAD_MS = 2500;
const BERM_BASE_SPREAD = 1.38;
const PROP_SCALE = 0.72;

function groundYAt(ground, groundY, wx, nowMs) {
  return ground ? ground.heightAt(wx, nowMs) : groundY;
}

function screenX(wx, worldX, originX) {
  return wx - worldX + originX;
}

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
        kind: c.kind ?? 'berm',
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
      const cx = screenX(o.wx, worldX, originX);
      if (cx < -80 || cx > 2200) continue;

      const kind = o.kind ?? (o.colliding === false ? 'prop' : 'berm');
      if (o.colliding === false || kind === 'stump' || kind === 'crystal' || kind === 'prop') {
        this._drawProp(ctx, o, cx, worldX, groundY, ground, nowMs, kind);
      } else {
        this._drawBerm(ctx, o, cx, groundY, ground, nowMs, edgeLight);
      }
    }
  }

  /** Colliding berm — trapezoid wider at the base, base corners follow ground.heightAt. */
  _drawBerm(ctx, o, cx, groundY, ground, nowMs, edgeLight) {
    const topW = o.width;
    const baseW = o.width * BERM_BASE_SPREAD;

    const wxL = o.wx - baseW / 2;
    const wxR = o.wx + baseW / 2;
    const yBL = groundYAt(ground, groundY, wxL, nowMs);
    const yBR = groundYAt(ground, groundY, wxR, nowMs);
    const yCenter = groundYAt(ground, groundY, o.wx, nowMs);
    const topY = yCenter - o.height;

    const xBL = cx - baseW / 2;
    const xBR = cx + baseW / 2;
    const xTL = cx - topW / 2;
    const xTR = cx + topW / 2;
    const baseY = Math.max(yBL, yBR);

    const bodyGrad = ctx.createLinearGradient(0, topY, 0, baseY);
    if (edgeLight) {
      bodyGrad.addColorStop(0, 'rgba(80,40,70,0.95)');
      bodyGrad.addColorStop(1, 'rgba(40,15,35,0.90)');
    } else {
      bodyGrad.addColorStop(0, '#8a3a6b');
      bodyGrad.addColorStop(1, '#5a244d');
    }

    ctx.beginPath();
    ctx.moveTo(xBL, yBL);
    ctx.lineTo(xBR, yBR);
    ctx.lineTo(xTR, topY);
    ctx.lineTo(xTL, topY);
    ctx.closePath();
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    if (edgeLight) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = edgeLight;
      ctx.lineWidth = 2;
      ctx.shadowColor = edgeLight;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(xTL, topY);
      ctx.lineTo(xTR, topY);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xTL, topY);
      ctx.lineTo(xTR, topY);
      ctx.stroke();
    }
  }

  /** Decorative prop — smaller stump or crystal with a muted palette (no neon edge). */
  _drawProp(ctx, o, cx, worldX, groundY, ground, nowMs, kind) {
    const propKind = kind === 'stump' || kind === 'crystal' ? kind : (o.wx % 2 < 1 ? 'stump' : 'crystal');
    const w = o.width * PROP_SCALE;
    const h = o.height * PROP_SCALE;
    const baseY = groundYAt(ground, groundY, o.wx, nowMs);
    const topY = baseY - h;

    if (propKind === 'crystal') {
      const bodyGrad = ctx.createLinearGradient(0, topY, 0, baseY);
      bodyGrad.addColorStop(0, 'rgba(60,80,90,0.55)');
      bodyGrad.addColorStop(0.5, 'rgba(45,60,72,0.50)');
      bodyGrad.addColorStop(1, 'rgba(30,40,50,0.45)');
      ctx.beginPath();
      ctx.moveTo(cx, topY - h * 0.12);
      ctx.lineTo(cx + w / 2, baseY);
      ctx.lineTo(cx - w / 2, baseY);
      ctx.closePath();
      ctx.fillStyle = bodyGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }

    // stump — short rounded column
    const left = cx - w / 2;
    const r = w * 0.22;
    const bodyGrad = ctx.createLinearGradient(0, topY, 0, baseY);
    bodyGrad.addColorStop(0, 'rgba(70,90,100,0.65)');
    bodyGrad.addColorStop(1, 'rgba(40,55,65,0.55)');
    ctx.beginPath();
    ctx.moveTo(left + r, topY);
    ctx.lineTo(left + w - r, topY);
    ctx.quadraticCurveTo(left + w, topY, left + w, topY + r);
    ctx.lineTo(left + w, baseY);
    ctx.lineTo(left, baseY);
    ctx.lineTo(left, topY + r);
    ctx.quadraticCurveTo(left, topY, left + r, topY);
    ctx.closePath();
    ctx.fillStyle = bodyGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}