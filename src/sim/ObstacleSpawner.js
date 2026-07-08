// World obstacles placed against a *predicted* jump schedule (spec §2.2.3
// final paragraph: "never force an impossible double-jump"). Rather than
// reactively nudging jumps at runtime, placement itself is built to be safe:
// every candidate sits inside a window where predictJumpArcs guarantees
// Midio clears it, computed against the worst case the live-tunable
// ParamBus guardrails could ever produce (weakest jump height, slowest
// scroll speed) — so a collision can only ever come from the vision loop
// legitimately choosing to make the game harder, never from bad luck.
import { Role } from '../core/NoteEvent.js';
import { clamp, mulberry32 } from '../utils/math.js';
import { GUARDRAIL_MIN } from '../core/ParamBus.js';
import { predictJumpArcs, safeWindowForArc } from './JumpPlanner.js';

const WORLD_SPEED_PX_S = 220;
const MIN_VEL = 0.55;
const CLEARANCE_MARGIN_PX = 14;
const MIN_SAFE_WINDOW_MS = 150; // discard slivers too narrow to place anything in safely
const EDGE_KEEPOUT_MS = 40; // stay this far off a window's own edges before crossing-width is even considered
const SPAWN_LEAD_MS = 2500;

export class ObstacleSpawner {
  constructor(paramBus, { seed = 99, height = 46, width = 28 } = {}) {
    this.P = paramBus;
    this.candidates = [];
    this.nextCandidateIdx = 0;
    this.active = [];
    this.rand = mulberry32(seed);
    this.height = height;
    this.width = width;
    this.halfWidth = 0; // set from Midio in buildCandidates
  }

  /**
   * @param {import('../core/NoteEvent.js').NoteEvent[]} timeline full song timeline
   * @param {number} beatPeriodMsGuess used only for candidate min-gap spacing
   * @param {number} midioHalfWidth Midio's collision half-width, for crossing-time math
   */
  buildCandidates(timeline, beatPeriodMsGuess, midioHalfWidth = 23) {
    this.candidates = [];
    this.halfWidth = midioHalfWidth;

    const kicks = [];
    for (const e of timeline) if (e.role === Role.RHYTHM && e.kick) kicks.push({ tMs: e.tMs, vel: e.vel });
    if (kicks.length === 0) return;

    // Worst case across the ParamBus's full live-tunable range: the weakest
    // jump the vision loop could ever produce, and the slowest scroll (which
    // maximizes how long an obstacle lingers in the danger zone).
    const arcs = predictJumpArcs(kicks, { jumpHeightMul: GUARDRAIL_MIN });
    const threshold = this.height + CLEARANCE_MARGIN_PX;
    const worstScrollPxPerMs = (WORLD_SPEED_PX_S * GUARDRAIL_MIN) / 1000;
    const crossHalfMs = (midioHalfWidth + this.width / 2) / worstScrollPxPerMs;

    const rhythmEvents = timeline.filter((e) => e.role === Role.RHYTHM && !e.kick && e.vel >= MIN_VEL);
    let ei = 0;
    let lastAccepted = -Infinity;
    const minGap = Math.max(beatPeriodMsGuess, 420);

    for (const arc of arcs) {
      const w = safeWindowForArc(arc, threshold);
      if (!w) continue; // this arc never clears the obstacle height at all -- skip, don't gamble

      const usableFrom = w.fromMs + EDGE_KEEPOUT_MS + crossHalfMs;
      const usableTo = w.toMs - EDGE_KEEPOUT_MS - crossHalfMs;
      if (usableTo - usableFrom < MIN_SAFE_WINDOW_MS - 2 * crossHalfMs) continue; // too narrow once crossing time is reserved
      if (usableFrom > usableTo) continue;

      // Anchor to the loudest nearby off-kick rhythm event for musical
      // correlation; fall back to the window's center if none qualify.
      while (ei < rhythmEvents.length && rhythmEvents[ei].tMs < usableFrom) ei++;
      let arrival = (usableFrom + usableTo) / 2;
      let bestVel = -1;
      let ej = ei;
      while (ej < rhythmEvents.length && rhythmEvents[ej].tMs <= usableTo) {
        if (rhythmEvents[ej].vel > bestVel) { bestVel = rhythmEvents[ej].vel; arrival = rhythmEvents[ej].tMs; }
        ej++;
      }

      if (arrival - lastAccepted < minGap) continue;
      this.candidates.push({ tMs: arrival });
      lastAccepted = arrival;
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
    while (this.active.length && this.active[0].wx < worldX - 1000) this.active.shift(); // roam-safe cull margin
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
