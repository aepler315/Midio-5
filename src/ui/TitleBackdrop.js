// The title/loader backdrop: the one moment in Midio that used to be a
// dead, static gradient. Before a song starts the stage canvas is never
// drawn (frame() returns early while !running), so the player's very first
// impression was a flat #0a0a14 rectangle behind the loader panel. This
// module gives that screen the same living, spectral language the world
// runs on -- a seeded twinkling starfield and a soft nebula -- so
// the first frame already reads as "this is a Midio world" before a note
// plays. Self-contained and cheap: a handful of gradient fills + the same
// drawMeshPart/drawGlowHalo calls the sim uses, no audio, no sim.
//
// Everything is seeded (mulberry32) so the composition is deterministic
// per page load and unit-testable without a canvas.
import { mulberry32 } from '../utils/math.js';

export const STAR_COUNT = 140;
export const NEBULA_COUNT = 3;

/** Build the deterministic starfield + nebula layout for a given seed. */
export function buildBackdropLayout(seed = 1, w = 1280, h = 720) {
  const rand = mulberry32(seed >>> 0);
  const stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      x: rand() * w,
      y: rand() * h,
      r: 0.4 + rand() * 1.3,
      phase: rand() * Math.PI * 2,
      speed: 0.6 + rand() * 1.4,
      hue: rand() < 0.5 ? 0 : 200 + rand() * 60, // warm gold vs cool blue
    });
  }
  const nebulae = [];
  for (let i = 0; i < NEBULA_COUNT; i++) {
    nebulae.push({
      x: rand() * w,
      y: rand() * h * 0.6,
      r: 120 + rand() * 160,
      hue: rand() * 360,
      alpha: 0.05 + rand() * 0.05,
    });
  }
  return { stars, nebulae };
}

export class TitleBackdrop {
  constructor({ seed = 1, width = 1280, height = 720, tonic = null } = {}) {
    this.width = width;
    this.height = height;
    this.layout = buildBackdropLayout(seed, width, height);

  }

  /** Draw one frame at time tSec. Pure-ish: only reads this.layout + tSec. */
  draw(ctx, tSec) {
    ctx.save();
    this._drawNebula(ctx, tSec);
    this._drawStars(ctx, tSec);
    ctx.restore();
  }

  _drawNebula(ctx, tSec) {
    for (const n of this.layout.nebulae) {
      const drift = Math.sin(tSec * 0.05 + n.hue) * 18;
      const g = ctx.createRadialGradient(n.x + drift, n.y, 0, n.x + drift, n.y, n.r);
      g.addColorStop(0, `hsla(${n.hue.toFixed(0)},60%,55%,${n.alpha.toFixed(3)})`);
      g.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  _drawStars(ctx, tSec) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.layout.stars) {
      const tw = 0.5 + 0.5 * Math.sin(tSec * s.speed * 2 + s.phase);
      const alpha = 0.25 + 0.55 * tw;
      ctx.fillStyle = `hsla(${s.hue.toFixed(0)},70%,${(70 + 20 * tw).toFixed(0)}%,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (0.7 + 0.5 * tw), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

}
