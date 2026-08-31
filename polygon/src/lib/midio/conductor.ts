import { clamp, clamp01 } from "./math";

export const A = 0.32;
export const B = 0.36;
export const GAMMA = 0.32;
export const W = 0.08;
export const H_BASE = 118;

export function jumpY(u: number, H: number) {
  const Ha = (1 - W) * H;
  if (u < A) {
    const p = u / A;
    return Ha * (1 - (1 - p) * (1 - p));
  }
  if (u < A + B) {
    const q = (u - A) / B;
    const s = Math.sin(Math.PI * q);
    return Ha + W * H * s * s;
  }
  const r = clamp((u - A - B) / GAMMA, 0, 1);
  return Ha * (1 - r * r);
}

export interface ConductorState {
  timeMs: number;
  bpm: number;
  beatPeriod: number;
  y: number;
  leanDeg: number;
  scaleX: number;
  scaleY: number;
  airborne: boolean;
  jumpStartMs: number;
  jumpD: number;
  jumpH: number;
  energy: number;
  beatFlash: number;
  kickImpulse: number;
  apo: number;
  blink: number;
  spinDeg: number;
  trauma: number;
}

export function createConductor(): ConductorState {
  return {
    timeMs: 0,
    bpm: 118,
    beatPeriod: 60000 / 118,
    y: 0,
    leanDeg: 0,
    scaleX: 1,
    scaleY: 1,
    airborne: false,
    jumpStartMs: -1e9,
    jumpD: 520,
    jumpH: H_BASE,
    energy: 0.2,
    beatFlash: 0,
    kickImpulse: 0,
    apo: 0,
    blink: 1,
    spinDeg: 0,
    trauma: 0,
  };
}

export function launchJump(c: ConductorState, nowMs: number, energy: number) {
  if (c.airborne) return false;
  c.airborne = true;
  c.jumpStartMs = nowMs;
  c.jumpD = 420 + (1 - energy) * 220;
  c.jumpH = H_BASE * (0.72 + energy * 0.55);
  c.scaleY = 1.12;
  c.scaleX = 0.9;
  return true;
}

export function stepConductor(
  c: ConductorState,
  dtSec: number,
  kicked: boolean,
  energy: number,
  bpm: number,
) {
  c.timeMs += dtSec * 1000;
  c.bpm = bpm;
  c.beatPeriod = 60000 / Math.max(40, bpm);
  c.energy = energy;
  c.kickImpulse = 0;

  const now = c.timeMs;

  if (kicked && !c.airborne) {
    launchJump(c, now, energy);
    c.beatFlash = 1;
    c.kickImpulse = 90 + energy * 140;
    c.trauma = Math.min(1, c.trauma + 0.28 + energy * 0.22);
  } else if (kicked && c.airborne) {
    c.beatFlash = 1;
    c.kickImpulse = 40 + energy * 70;
    c.spinDeg += 180 * (energy > 0.55 ? 2 : 1);
    c.trauma = Math.min(1, c.trauma + 0.18);
  }

  if (c.airborne) {
    const u = clamp01((now - c.jumpStartMs) / c.jumpD);
    c.y = jumpY(u, c.jumpH);
    c.leanDeg = Math.sin(u * Math.PI) * 9 * (c.spinDeg === 0 ? 1 : 0);
    if (c.spinDeg > 0) {
      const spin = Math.min(c.spinDeg, 540 * dtSec);
      c.spinDeg -= spin;
      c.leanDeg += spin;
    }
    const stretch = 1 + 0.08 * Math.sin(u * Math.PI);
    c.scaleY = stretch;
    c.scaleX = 1 / stretch;
    if (u >= 1) {
      c.airborne = false;
      c.y = 0;
      c.scaleY = 0.82;
      c.scaleX = 1.16;
      c.spinDeg = 0;
      c.trauma = Math.min(1, c.trauma + 0.35);
    }
  } else {
    c.y += (0 - c.y) * (1 - Math.exp(-14 * dtSec));
    const strut = Math.sin((now / c.beatPeriod) * Math.PI * 2) * 3.0;
    const breath = 1 + 0.02 * Math.sin(now * 0.0042);
    c.leanDeg += (strut - c.leanDeg) * (1 - Math.exp(-10 * dtSec));
    c.scaleY += (breath - c.scaleY) * (1 - Math.exp(-12 * dtSec));
    c.scaleX += (1 / breath - c.scaleX) * (1 - Math.exp(-12 * dtSec));
  }

  c.beatFlash *= Math.exp(-7.5 * dtSec);
  c.trauma = Math.max(0, c.trauma - dtSec * 1.6);
  c.apo += ((energy > 0.72 ? 1 : 0) - c.apo) * (1 - Math.exp(-0.55 * dtSec));

  const blinkCycle = (now / 1000) % 3.4;
  c.blink = blinkCycle > 3.22 ? 1 - clamp01((blinkCycle - 3.22) / 0.08) * 0.85 : 1;
}
