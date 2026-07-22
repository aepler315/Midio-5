// A satisfying outward ripple on every Midio landing: a few staggered rings
// expanding across the ground plane plus a pair of bright pulses sliding
// out along the ground line, both scaled by landing intensity I (0..1).
// Same perspective-squash convention as ImpactFX (ry = 0.28*rx) and the
// same pooled/world-space pattern (positions in world-x, screen-mapped at
// draw time via worldX/originX).
import { ObjectPool } from '../utils/ObjectPool.js';
import { clamp01 } from '../utils/math.js';
import { capFlashAlpha } from '../ui/Accessibility.js';

export const RIPPLE_RINGS = 3;
export const RIPPLE_RING_STAGGER_MS = 90;
export const RIPPLE_SQUASH = 0.28;

/** Outward radius (px) of a ring at `ageMs` for landing intensity I (0..1):
 *  eased out (fast start, settling), scaling both the final radius and the
 *  life span with I so hard landings ripple farther and longer. */
export function rippleRadius(ageMs, I) {
  const life = rippleLifeMs(I);
  const u = clamp01(ageMs / life);
  const eased = 1 - (1 - u) * (1 - u) * (1 - u); // ease-out cubic
  return (60 + 180 * clamp01(I)) * eased;
}

export function rippleLifeMs(I) {
  return 700 + 300 * clamp01(I);
}

/** Ring opacity (0..1) across its life: starts bright, fades to 0 by the
 *  end of its life. */
export function rippleAlpha(ageMs, I) {
  const life = rippleLifeMs(I);
  const u = clamp01(ageMs / life);
  if (u >= 1) return 0;
  return (0.5 + 0.3 * clamp01(I)) * (1 - u) * (1 - u);
}

/** Outward distance (px) of the twin ground-line pulses at `ageMs`. */
export function groundPulseX(ageMs, I) {
  const life = 500 + 200 * clamp01(I);
  const u = clamp01(ageMs / life);
  return (90 + 160 * clamp01(I)) * (1 - (1 - u) * (1 - u));
}

export class RippleFX {
  constructor() {
    this.rings = new ObjectPool(() => ({}), (o, i) => Object.assign(o, { age: 0 }, i), 12);
    this.pulses = new ObjectPool(() => ({}), (o, i) => Object.assign(o, { age: 0 }, i), 8);
  }

  trigger(worldX, groundY, I) {
    for (let i = 0; i < RIPPLE_RINGS; i++) {
      this.rings.spawn({ wx: worldX, y: groundY, I, delayMs: i * RIPPLE_RING_STAGGER_MS, age: -i * RIPPLE_RING_STAGGER_MS });
    }
    this.pulses.spawn({ wx: worldX, y: groundY, I });
  }

  update(dtMs) {
    const dtSec = dtMs / 1000;
    this.rings.step(dtSec, (o, dt) => { o.age += dt * 1000; return o.age < rippleLifeMs(o.I); });
    this.pulses.step(dtSec, (o, dt) => { o.age += dt * 1000; return o.age < 500 + 200 * clamp01(o.I); });
  }

  draw(ctx, worldX, originX, reducedFlash) {
    const toScreen = (wx) => wx - worldX + originX;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const r of this.rings.active) {
      if (r.age < 0) continue; // staggered start not yet reached
      const alpha = rippleAlpha(r.age, r.I);
      if (alpha <= 0.005) continue;
      const radius = rippleRadius(r.age, r.I);
      const x = toScreen(r.wx);
      ctx.strokeStyle = `hsla(42, 85%, 65%, ${capFlashAlpha(alpha, reducedFlash).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.6, 3 * (1 - r.age / rippleLifeMs(r.I)));
      ctx.beginPath();
      ctx.ellipse(x, r.y, radius, radius * RIPPLE_SQUASH, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const p of this.pulses.active) {
      const life = 500 + 200 * clamp01(p.I);
      const u = clamp01(p.age / life);
      const alpha = (1 - u) * (0.6 + 0.3 * clamp01(p.I));
      if (alpha <= 0.005) continue;
      const dist = groundPulseX(p.age, p.I);
      const x = toScreen(p.wx);
      ctx.strokeStyle = `hsla(42, 95%, 75%, ${capFlashAlpha(alpha, reducedFlash).toFixed(3)})`;
      ctx.lineWidth = 2;
      const segLen = 16 + 20 * clamp01(p.I);
      ctx.beginPath();
      ctx.moveTo(x + dist - segLen, p.y);
      ctx.lineTo(x + dist, p.y);
      ctx.moveTo(x - dist + segLen, p.y);
      ctx.lineTo(x - dist, p.y);
      ctx.stroke();
    }

    ctx.restore();
  }
}
