// Combo milestone flourish: a Fourier epicycle machine that literally
// draws the milestone digit ("5", "10", "20") above Midio with a chain
// of spinning circles, gold trail condensing behind the pen, then holds
// and fades. Multi-digit glyphs run one epicycle chain per stroke, all
// drawing simultaneously. Entirely stateless per frame: the trail is
// re-evaluated from the coefficients each draw, so there is nothing to
// reset or leak between shows.
import { closeStroke, resampleClosed, dftCoefficients, chainPoints, penPoint } from './epicycles.js';

// Single-stroke digits in a [-1,1] box, drawn the way a signwriter would.
const DIGIT_5 = [
  { x: 0.55, y: -0.8 }, { x: -0.5, y: -0.8 }, { x: -0.55, y: -0.1 },
  { x: -0.15, y: -0.28 }, { x: 0.3, y: -0.18 }, { x: 0.55, y: 0.15 },
  { x: 0.48, y: 0.55 }, { x: 0.05, y: 0.8 }, { x: -0.5, y: 0.62 },
];
const DIGIT_1 = [
  { x: -0.25, y: -0.5 }, { x: 0.05, y: -0.8 }, { x: 0.05, y: 0.8 },
];
const DIGIT_2 = [
  { x: -0.45, y: -0.5 }, { x: -0.18, y: -0.8 }, { x: 0.25, y: -0.8 },
  { x: 0.5, y: -0.5 }, { x: 0.42, y: -0.12 }, { x: -0.5, y: 0.8 }, { x: 0.55, y: 0.8 },
];
const DIGIT_0 = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(a) * 0.42, y: Math.sin(a) * 0.8 };
});

const shift = (pts, dx, sx = 1) => pts.map((p) => ({ x: p.x * sx + dx, y: p.y }));

// Milestone index (from MidioPerformer's MILESTONES [5,10,20]) -> strokes.
const GLYPH_STROKES = [
  [DIGIT_5],
  [shift(DIGIT_1, -0.62, 0.8), shift(DIGIT_0, 0.5, 0.85)],
  [shift(DIGIT_2, -0.6, 0.75), shift(DIGIT_0, 0.55, 0.85)],
];

const SAMPLES = 160;
const MAX_COEFFS = 36;
const DRAW_MS = 1100, HOLD_MS = 350, FADE_MS = 300;
const SCALE_PX = 68;
const TRAIL_STEPS = 90;
const GOLD = '#ffd75e';

export class EpicycleShow {
  constructor() {
    // Precompute every glyph's coefficient chains once. The 14-point "0"
    // is a closed loop already; the open digit strokes are closed by
    // retracing so the DFT sees a periodic path.
    this.glyphs = GLYPH_STROKES.map((strokes) => strokes.map((stroke) => {
      const closed = stroke.length >= 14 ? stroke : closeStroke(stroke);
      return dftCoefficients(resampleClosed(closed, SAMPLES), MAX_COEFFS);
    }));
    this.active = null;
    this.pending = null;
  }

  /**
   * Ask for a glyph. A drawing already in flight is never interrupted.
   *
   * This slot used to be assigned unconditionally, and the show takes 1750ms
   * (1100 of it actually drawing) while the streak needed to reach the next
   * milestone can be earned in well under a second on a dense chart -- so the
   * "5" was routinely wiped mid-stroke by the "10". That is the reported
   * "drawings get abandoned before they're done", and it was guaranteed by
   * construction rather than unlucky.
   *
   * The new arrival is held rather than dropped. There are only ever three
   * milestones in an entire song (MidioPerformer ratchets on idx and never
   * resets), so discarding one means the player simply never sees it.
   * Milestones are monotonic, so a newer pending glyph supersedes an older
   * pending one -- at most one waits, and it starts the moment the current
   * drawing finishes.
   */
  trigger(milestoneIdx, x, y, nowMs) {
    const idx = Math.max(0, Math.min(this.glyphs.length - 1, milestoneIdx));
    const show = { idx, x, y, startMs: nowMs };
    if (this.active) { this.pending = show; return false; }
    this.active = show;
    return true;
  }

  /** Drop everything, in flight and queued. For a seek or a teardown, where
   *  finishing a drawing the player has scrubbed away from is meaningless. */
  reset() {
    this.active = null;
    this.pending = null;
  }

  /** Promote a waiting glyph, restamped to start now: its original timestamp
   *  is long past, and reusing it would open the new drawing part-finished. */
  _advance(nowMs) {
    this.active = this.pending ? { ...this.pending, startMs: nowMs } : null;
    this.pending = null;
  }

  draw(ctx, nowMs) {
    if (!this.active) return;
    const elapsed = nowMs - this.active.startMs;
    // A backward seek puts us before our own start: cancel outright rather
    // than hold a glyph that belongs to a part of the song we have left.
    if (elapsed < 0) { this.reset(); return; }
    if (elapsed > DRAW_MS + HOLD_MS + FADE_MS) { this._advance(nowMs); return; }

    const progress = Math.min(1, elapsed / DRAW_MS);
    const fade = elapsed > DRAW_MS + HOLD_MS
      ? 1 - (elapsed - DRAW_MS - HOLD_MS) / FADE_MS
      : 1;

    const { x: cx, y: cy, idx } = this.active;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const coeffs of this.glyphs[idx]) {
      // The trail: everything the pen has drawn so far.
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2.6;
      ctx.globalAlpha = 0.85 * fade;
      ctx.beginPath();
      const steps = Math.max(2, Math.floor(TRAIL_STEPS * progress));
      for (let i = 0; i <= steps; i++) {
        const p = penPoint(coeffs, (i / steps) * progress);
        const px = cx + p.x * SCALE_PX, py = cy + p.y * SCALE_PX;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // The machine: the circle chain, only while still drawing.
      if (progress < 1) {
        const joints = chainPoints(coeffs, progress);
        ctx.lineWidth = 1;
        for (let i = 0; i < coeffs.length; i++) {
          const r = coeffs[i].mag * SCALE_PX;
          if (r < 1.5) continue;
          ctx.globalAlpha = 0.10 * fade;
          ctx.beginPath();
          ctx.arc(cx + joints[i].x * SCALE_PX, cy + joints[i].y * SCALE_PX, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 0.22 * fade;
          ctx.beginPath();
          ctx.moveTo(cx + joints[i].x * SCALE_PX, cy + joints[i].y * SCALE_PX);
          ctx.lineTo(cx + joints[i + 1].x * SCALE_PX, cy + joints[i + 1].y * SCALE_PX);
          ctx.stroke();
        }
        // The pen tip: a bright bead.
        const pen = joints[joints.length - 1];
        ctx.globalAlpha = 0.9 * fade;
        ctx.fillStyle = GOLD;
        ctx.beginPath();
        ctx.arc(cx + pen.x * SCALE_PX, cy + pen.y * SCALE_PX, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
