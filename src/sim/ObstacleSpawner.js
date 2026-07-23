// World obstacles placed against a *predicted* jump schedule (spec §2.2.3
// final paragraph: "never force an impossible double-jump"). Rather than
// reactively nudging jumps at runtime, placement itself is built to be safe:
// every candidate sits inside a window where predictJumpArcs guarantees
// Midio clears it, computed against the worst case the live-tunable
// ParamBus guardrails could ever produce (weakest jump height, slowest
// scroll speed) — so a collision can only ever come from the vision loop
// legitimately choosing to make the game harder, never from bad luck.
//
// Visually, an obstacle isn't a platformer block: it's an ambient, abstract
// manifestation of the music -- a shape that condenses into being as it
// approaches and dissolves into motes once cleared. Placement/collision are
// pure geometry (untouched below); only the presentation is reskinned.
import { Role } from '../core/NoteEvent.js';
import { clamp, clamp01, mulberry32 } from '../utils/math.js';
import { superformula } from '../render/oscillators.js';
import { capFlashAlpha } from '../ui/Accessibility.js';
import { hexToRgb } from '../utils/color.js';
import { GUARDRAIL_MIN } from '../core/ParamBus.js';
import { predictJumpArcs, safeWindowForArc } from './JumpPlanner.js';

const WORLD_SPEED_PX_S = 220;
const MIN_VEL = 0.55;
const CLEARANCE_MARGIN_PX = 14;
const MIN_SAFE_WINDOW_MS = 150; // discard slivers too narrow to place anything in safely
const EDGE_KEEPOUT_MS = 40; // stay this far off a window's own edges before crossing-width is even considered
const SPAWN_LEAD_MS = 2500;
const SPAWN_PROB_BASE = 0.75; // was 0.5 -- ambient forms read better with more of them present

export const ARCHETYPES = Object.freeze(['thorn', 'veil', 'echo']);
export const EMERGENCE_PX = 170; // condenses in over this much approach distance
export const DISSOLVE_PX = 130;  // dissolves out over this much departure distance

// The GEOMETRIC family: a distinct, hard-edged set of shapes (triangle,
// square, hexagon) that spawn LINED UP in a row across a single jump arc's
// safe window -- Midio takes off on the arc's kick, sails over the whole
// row, and lands on the next kick. They never appear as random singles (the
// organic thorn/veil/echo do that); a row only forms from an arc whose safe
// window is wide enough, and every shape sits inside that window so each is
// worst-case clearable exactly like a single obstacle.
export const GEO_SHAPES = Object.freeze([3, 4, 6]); // polygon side counts
const GEO_ROW_CHANCE = 0.3;   // fraction of wide-enough arcs that become a geometric row
const GEO_MIN_SPAN_MS = 240;  // usable window must be at least this wide to lay a row
const GEO_SPACING_MS = 120;   // nominal time gap between shapes in a row
const GEO_ROW_MIN = 3, GEO_ROW_MAX = 6;

/** The evenly-spaced onset times (ms) of the shapes in a geometric row that
 *  spans [fromMs, toMs] with `count` shapes. Every time lies within the
 *  window, so each shape inherits the window's worst-case clearance. Pure
 *  and exported so the placement-safety test can verify the whole row. */
export function geoRowTimes(fromMs, toMs, count) {
  const times = [];
  for (let i = 0; i < count; i++) {
    const frac = count > 1 ? i / (count - 1) : 0;
    times.push(fromMs + (toMs - fromMs) * frac);
  }
  return times;
}

/** Deterministic archetype pick from a 0..1 float (this.rand()'s own output). */
export function obstacleArchetype(u) {
  if (u < 1 / 3) return 'thorn';
  if (u < 2 / 3) return 'veil';
  return 'echo';
}

/** 0 far ahead, ramps to 1 over the last EMERGENCE_PX of approach. Clamped
 *  so a negative (already-arrived) distance still reads as fully formed. */
export function emergenceEnvelope(distanceAheadPx) {
  return clamp01(1 - distanceAheadPx / EMERGENCE_PX);
}

/** 1 right at the moment of being passed, easing to 0 over DISSOLVE_PX of
 *  departure -- symmetric partner to emergenceEnvelope. */
export function dissolveEnvelope(distanceBehindPx) {
  return clamp01(1 - distanceBehindPx / DISSOLVE_PX);
}

/** True when `obstacle` ({tMs}) is the one `jump` ({jumpStartMs, D}) is
 *  airborne to clear -- its scheduled crossing sits inside the jump's own
 *  hang window. Placement already guarantees every such jump clears (see
 *  file header) -- this just tells MidioPerformer WHICH launch is a dodge,
 *  so it can force a genuinely spectacular trick instead of leaving the
 *  presentation to velocity/combo RNG. Pure. */
export function obstacleInJumpWindow(jump, obstacle) {
  if (!jump || !obstacle) return false;
  if (!Number.isFinite(jump.jumpStartMs) || !Number.isFinite(jump.D)) return false;
  if (!Number.isFinite(obstacle.tMs)) return false;
  return obstacle.tMs >= jump.jumpStartMs && obstacle.tMs <= jump.jumpStartMs + jump.D;
}

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
   * @param {{fromMs:number, toMs:number}[]} excludeSpans keep-out ranges (hold
   *   notes: the player rides those grounded, so nothing placed there is clearable)
   */
  buildCandidates(timeline, beatPeriodMsGuess, midioHalfWidth = 23, excludeSpans = []) {
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

      // Occasionally lay a lined-up GEOMETRIC row across this whole safe
      // window instead of a single ambient obstacle. Every shape's onset
      // sits inside [usableFrom, usableTo] (see geoRowTimes), so the row
      // inherits the same worst-case clearance guarantee a single obstacle
      // gets -- Midio clears the entire line and lands on the next kick.
      const span = usableTo - usableFrom;
      if (span >= GEO_MIN_SPAN_MS && this.rand() < GEO_ROW_CHANCE) {
        if (usableFrom - lastAccepted < minGap) continue;
        const count = clamp(Math.round(span / GEO_SPACING_MS) + 1, GEO_ROW_MIN, GEO_ROW_MAX);
        const shape = GEO_SHAPES[Math.floor(this.rand() * GEO_SHAPES.length)];
        this.candidates.push({ tMs: usableFrom, row: { fromMs: usableFrom, toMs: usableTo, count, shape } });
        lastAccepted = usableTo;
        continue;
      }

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

      const blocked = excludeSpans.some((s) => arrival + crossHalfMs >= s.fromMs && arrival - crossHalfMs <= s.toMs);
      if (blocked) continue;

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
      const p = clamp(SPAWN_PROB_BASE * this.P.live.obstacleDensity, 0, 1);
      if (this.rand() > p) continue;
      if (c.row) {
        // A lined-up geometric row: one shape per evenly-spaced onset, all
        // the same polygon so the line reads as one deliberate formation.
        const { fromMs, toMs, count, shape } = c.row;
        for (const tMs of geoRowTimes(fromMs, toMs, count)) {
          const wx = worldX + scrollSpeedPxMs * (tMs - nowMs);
          this.active.push({
            wx, tMs, height: this.height, width: this.width, passed: false,
            archetype: 'geo', sides: shape, phase: this.rand() * Math.PI * 2,
          });
        }
        continue;
      }
      const wx = worldX + scrollSpeedPxMs * (c.tMs - nowMs);
      const archetype = obstacleArchetype(this.rand());
      const phase = this.rand() * Math.PI * 2;
      this.active.push({
        wx, tMs: c.tMs, height: this.height, width: this.width, passed: false, archetype, phase,
      });
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

  draw(ctx, worldX, originX, groundY, {
    nowMs = 0, energyCurves = null, haloColor = '#8a3a6b', wind = { x: 0, y: 0 },
    particleMul = 1, reducedFlash = false,
  } = {}) {
    if (this.active.length === 0) return;
    const { r, g, b } = hexToRgb(haloColor);
    const rgb = `${r},${g},${b}`;
    const pulse = energyCurves ? clamp01(energyCurves.globalEnergy(nowMs)) : 0.5 + 0.5 * Math.sin(nowMs / 900);
    const tSec = nowMs / 1000;

    for (const o of this.active) {
      const x = o.wx - worldX + originX;
      if (x < -80 || x > 2280) continue;

      const distanceAhead = o.wx - worldX;
      const emergence = o.passed ? 1 : emergenceEnvelope(Math.max(0, distanceAhead));
      const dissolve = o.passed ? dissolveEnvelope(Math.max(0, worldX - o.wx)) : 1;
      const presence = emergence * dissolve;
      if (presence <= 0.01) continue;

      // Telegraph: every archetype brightens right as it's about to be
      // crossed -- the "jump window is now" cue that makes clearing it
      // read as a deliberate, spectacular dodge rather than an ambient
      // shape that happened to be there.
      const nearMoment = o.passed ? 0 : clamp01(1 - Math.abs(distanceAhead) / 40);

      const cx = x, cy = groundY - o.height / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = 'lighter';

      switch (o.archetype) {
        case 'thorn': this._drawThorn(ctx, o, presence, emergence, rgb, tSec, reducedFlash, nearMoment); break;
        case 'veil': this._drawVeil(ctx, o, presence, distanceAhead, rgb, tSec, wind, reducedFlash); break;
        case 'geo': this._drawGeo(ctx, o, presence, emergence, pulse, rgb, tSec, reducedFlash); break;
        default: this._drawEcho(ctx, o, presence, pulse, rgb, tSec, particleMul, reducedFlash, nearMoment); break;
      }

      // Dissolve motes: a brief upward spray as the shape lets go, keyed off
      // how far into dissolving it is (1 - dissolve rises from 0 to 1).
      if (o.passed && dissolve < 0.99) {
        const u = 1 - dissolve;
        const n = Math.max(1, Math.round(6 * particleMul));
        ctx.fillStyle = `rgba(${rgb},${capFlashAlpha(0.5 * dissolve, reducedFlash)})`;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + o.phase;
          const r2 = 10 + u * 40;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * r2, Math.sin(a) * r2 - u * 30, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    }
  }

  /** A dark crystalline growth condensing out of the ground: a superformula
   *  spike with a slow internal shimmer riding its own hue, brightening as
   *  the jump window to clear it opens (nearMoment). */
  _drawThorn(ctx, o, presence, emergence, rgb, tSec, reducedFlash, nearMoment = 0) {
    const scale = 0.25 + 0.75 * emergence;
    ctx.scale(scale, scale);
    const shimmer = 0.5 + 0.5 * Math.sin(tSec * 1.6 + o.phase);
    const alpha = capFlashAlpha((0.55 + 0.35 * nearMoment) * presence, reducedFlash);
    ctx.fillStyle = `rgba(20,14,22,${0.7 * presence})`;
    ctx.strokeStyle = `rgba(${rgb},${alpha + 0.2 * shimmer})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const phi = (i / steps) * Math.PI * 2;
      const r = (o.height * 0.62) * superformula(phi, 5, 0.6 + 0.3 * shimmer, 1.7, 1.7);
      const px = Math.cos(phi) * r * 0.6, py = Math.sin(phi) * r - o.height * 0.05;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  /** A hanging ribbon of dissonance: nested translucent sine-curtains,
   *  swaying on the global wind, brightest right at the jump moment. */
  _drawVeil(ctx, o, presence, distanceAhead, rgb, tSec, wind, reducedFlash) {
    const nearMoment = clamp01(1 - Math.abs(distanceAhead) / 40);
    const layers = 4;
    for (let li = 0; li < layers; li++) {
      const depth = li / (layers - 1);
      const sway = (wind.x || 0) * 0.02 + Math.sin(tSec * 0.8 + o.phase + li) * 6;
      const alpha = capFlashAlpha((0.14 + 0.1 * depth + 0.35 * nearMoment) * presence, reducedFlash);
      ctx.strokeStyle = `rgba(${rgb},${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const h = o.height * (0.7 + 0.3 * depth);
      const segs = 12;
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const py = -h / 2 + u * h;
        const px = sway * Math.sin(u * Math.PI + tSec * 0.5 + li) + (li - layers / 2) * 5;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  /** A member of the lined-up geometric family: a crisp regular polygon
   *  (triangle/square/hexagon) standing on the ground, with a dark solid
   *  core and a bright, slowly-counter-rotating double edge -- deliberately
   *  hard-edged so the row reads as engineered, not organic. */
  _drawGeo(ctx, o, presence, emergence, pulse, rgb, tSec, reducedFlash) {
    const scale = 0.3 + 0.7 * emergence;
    ctx.scale(scale, scale);
    const sides = o.sides || 4;
    const r = o.height * 0.5;
    const rot = tSec * 0.5 + o.phase;
    const alpha = capFlashAlpha((0.55 + 0.25 * pulse) * presence, reducedFlash);

    const poly = (radius, spin) => {
      ctx.beginPath();
      for (let i = 0; i <= sides; i++) {
        const a = spin + (i / sides) * Math.PI * 2 - Math.PI / 2; // point-up
        const px = Math.cos(a) * radius, py = Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    // Solid dark body so it reads as a real obstacle, not just a glint.
    poly(r, rot);
    ctx.fillStyle = `rgba(18,16,26,${0.72 * presence})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${rgb},${alpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner counter-rotating echo edge -- the geometric "signature".
    poly(r * 0.55, -rot);
    ctx.strokeStyle = `rgba(${rgb},${(0.5 * alpha).toFixed(3)})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  /** A floating cluster of orbiting shards around a core that inhales and
   *  exhales with the song's global energy, flaring as the jump window to
   *  clear it opens (nearMoment). */
  _drawEcho(ctx, o, presence, pulse, rgb, tSec, particleMul, reducedFlash, nearMoment = 0) {
    const coreR = (6 + 5 * pulse) * (0.4 + 0.6 * presence) * (1 + 0.3 * nearMoment);
    const coreAlpha = capFlashAlpha((0.25 + 0.35 * pulse + 0.3 * nearMoment) * presence, reducedFlash);
    ctx.fillStyle = `rgba(${rgb},${coreAlpha})`;
    ctx.beginPath();
    ctx.arc(0, 0, coreR, 0, Math.PI * 2);
    ctx.fill();

    const shardCount = Math.max(1, Math.round(3 * particleMul));
    const orbitR = o.height * 0.5;
    for (let i = 0; i < shardCount; i++) {
      const a = tSec * 0.7 + o.phase + (i / 3) * Math.PI * 2;
      const sx = Math.cos(a) * orbitR, sy = Math.sin(a) * orbitR * 0.7;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(a);
      ctx.fillStyle = `rgba(${rgb},${capFlashAlpha(0.5 * presence, reducedFlash)})`;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const phi = (k / 5) * Math.PI * 2;
        const r = phi % 2 === 0 ? 6 : 3;
        const px = Math.cos(phi) * r, py = Math.sin(phi) * r;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}
