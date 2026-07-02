// Ground as N vertical EQ slices (item 5) — a rolling terrain whose per-slice
// target height is driven by band energy (shifted so it echoes the horizon EQ),
// heavily spring-smoothed and capped so the play surface stays readable. Owns
// the seeded "almost-falls" gag: a scheduled, localized sag ahead of Midio that
// holds an "oh no" beat then recovers with an overshooting elastic spring +
// camera punch.
//
// Pure logic (no canvas) so it can be unit-tested in node. heightAt(worldX) is
// the single groundYAt(worldX) the spec calls for — every gameplay/draw system
// samples the ground through it.
import { clamp, smoothstep, mulberry32 } from '../utils/math.js';

const ZETA = 0.8;        // spring damping (≈400ms settle)
const OMEGA_N = 12.5;    // spring natural frequency (s^-1)
const MAX_OFFSET = 22;   // ±px slice travel around baseY (readable surface)
const GAG_SAG_MS = 1500;
const GAG_HOLD_BEATS = 1;
const GAG_RECOVER_MS = 520;
const GAG_MAX_SAG = 70;  // px
const GAG_REACH_PX = 720; // how far ahead of Midio the gag reaches
const GAG_AVOID_BEATS = 2;

const easeIn = (t) => t * t;
// Elastic ease-out: 0→1 with one overshoot above 1, settling to 1 at t=1.
const elasticOut = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
};

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export class GroundField {
  constructor({
    baseY = 480, slices = 14, shift = 3, canvasWidth = 1280, bands = 7,
    durationMs, barGrid = [], beatMs = 500, obstacleTimes = [], seed = 1,
  } = {}) {
    this.baseY = baseY;
    this.n = slices;
    this.bands = bands; // EQ band count (7); 14 slices == bands repeated x2
    this.shift = shift;
    this.spacing = canvasWidth / slices;
    this.durationMs = durationMs;
    this.beatMs = beatMs;

    // Per-slice spring state (offset around baseY).
    this.h = new Float32Array(slices);
    this.v = new Float32Array(slices);
    this.target = new Float32Array(slices);

    this.zeta = ZETA;

    // Gag scheduling + state machine.
    this._rand = mulberry32(seed);
    this._gagSchedule = this._scheduleGags(barGrid, obstacleTimes, durationMs, beatMs);
    this._gagIdx = 0;
    this.gagState = 'idle'; // 'idle' | 'sag' | 'hold' | 'recover'
    this._gagStartMs = 0;
    this._gagCenterWorldX = 0;

    // One-shot flags for the Simulation to wire FX/camera.
    this.justSagged = false;
    this.justRecovered = false;
  }

  _scheduleGags(barGrid, obstacleTimes, durationMs, beatMs) {
    const rand = this._rand;
    const count = 1 + (rand() < 0.45 ? 1 : 0); // 1–2 gags
    // Second-half bar boundaries, leaving room for the recover before the end.
    const secondHalf = barGrid
      .map((b) => b.ms)
      .filter((ms) => ms >= 0.5 * durationMs && ms <= durationMs - 2 * beatMs - GAG_RECOVER_MS);
    const avoid = GAG_AVOID_BEATS * beatMs;
    const out = [];
    let tries = 0;
    while (out.length < count && tries < 40 && secondHalf.length) {
      tries++;
      const ms = secondHalf[Math.floor(rand() * secondHalf.length)];
      if (out.some((m) => Math.abs(m - ms) < 4 * beatMs)) continue; // gags spaced apart
      if (obstacleTimes.some((t) => Math.abs(t - ms) < avoid)) continue; // not near an obstacle
      out.push(ms);
    }
    out.sort((a, b) => a - b);
    return out;
  }

  update(nowMs, dtSec, energyCurves, worldX) {
    this._lastNowMs = nowMs;
    // Per-slice targets from band energy, shifted so the ground echoes the EQ.
    if (energyCurves) {
      for (let i = 0; i < this.n; i++) {
        const band = energyCurves.sample((i + this.shift) % this.bands, nowMs);
        this.target[i] = clamp((band - 0.5) * 2 * MAX_OFFSET, -MAX_OFFSET, MAX_OFFSET);
      }
    }
    // Critically-damped spring toward target (underdamped during recover for overshoot).
    const z = this.zeta;
    for (let i = 0; i < this.n; i++) {
      const a = -OMEGA_N * OMEGA_N * (this.h[i] - this.target[i]) - 2 * z * OMEGA_N * this.v[i];
      this.v[i] += a * dtSec;
      this.h[i] += this.v[i] * dtSec;
    }

    // --- gag state machine ---
    this.justSagged = false;
    this.justRecovered = false;
    if (this.gagState === 'idle') {
      if (this._gagIdx < this._gagSchedule.length && nowMs >= this._gagSchedule[this._gagIdx]) {
        this._gagIdx++;
        this.gagState = 'sag';
        this._gagStartMs = nowMs;
        this._gagCenterWorldX = worldX; // anchor the collapse ahead of Midio's current spot
        this.justSagged = true;
      }
    } else if (this.gagState === 'sag') {
      if (nowMs - this._gagStartMs >= GAG_SAG_MS) {
        this.gagState = 'hold';
        this._holdStartMs = nowMs;
      }
    } else if (this.gagState === 'hold') {
      if (nowMs - this._holdStartMs >= GAG_HOLD_BEATS * this.beatMs) {
        this.gagState = 'recover';
        this._recoverStartMs = nowMs;
        this.zeta = 0.25; // underdamped → overshooting elastic recovery
        this.justRecovered = true;
      }
    } else if (this.gagState === 'recover') {
      if (nowMs - this._recoverStartMs >= GAG_RECOVER_MS) {
        this.gagState = 'idle';
        this.zeta = ZETA;
      }
    }
  }

  /** Sag offset (px, positive = ground lower) at worldX during the gag. */
  _gagOffset(worldX, nowMs) {
    if (this.gagState === 'idle') return 0;
    const dist = worldX - this._gagCenterWorldX;
    if (dist < -24 || dist > GAG_REACH_PX) return 0;
    const reach = clamp(1 - dist / GAG_REACH_PX, 0, 1); // 1 under Midio → 0 far ahead
    let amp;
    if (this.gagState === 'sag') {
      const p = clamp((nowMs - this._gagStartMs) / GAG_SAG_MS, 0, 1);
      const stagger = clamp(p - dist / GAG_REACH_PX, 0, 1); // nearer slices drop first
      amp = GAG_MAX_SAG * reach * easeIn(stagger);
    } else if (this.gagState === 'hold') {
      amp = GAG_MAX_SAG * reach;
    } else { // recover
      const r = clamp((nowMs - this._recoverStartMs) / GAG_RECOVER_MS, 0, 1);
      amp = GAG_MAX_SAG * reach * (1 - elasticOut(r)); // overshoots negative, settles to 0
    }
    return amp;
  }

  /** The ground's screen-y at a world x — replaces the constant groundY. */
  heightAt(worldX, nowMs) {
    const now = nowMs ?? this._lastNowMs;
    const f = (((worldX / this.spacing) % this.n) + this.n) % this.n;
    const i0 = Math.floor(f);
    const frac = f - i0;
    const h = this.h;
    const terrain = catmull(
      h[(i0 - 1 + this.n) % this.n],
      h[i0 % this.n],
      h[(i0 + 1) % this.n],
      h[(i0 + 2) % this.n],
      frac,
    );
    return this.baseY + terrain + this._gagOffset(worldX, now);
  }

  get gagActive() { return this.gagState !== 'idle'; }
}