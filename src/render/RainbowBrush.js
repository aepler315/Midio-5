// The Mario Paint rainbow pen, repurposed: while Midio is airborne his
// trajectory is painted as a trail of chunky square dabs cycling through
// the hue wheel, world-locked so the stroke stays where he drew it and
// scrolls away with the terrain. Deliberately unsmoothed -- crisp square
// dabs snapped to pixels are the whole aesthetic.
const MAX_DABS = 320;
const LIFE_MS = 3200;
const SPACING_PX = 8;
const HUE_STEP_DEG = 16;

export class RainbowBrush {
  constructor() {
    this.dabs = [];
    this._hueIdx = 0;
    this._lastX = NaN;
    this._lastY = NaN;
  }

  /** Feed Midio's world-space position each frame; dabs drop at fixed stroke spacing. */
  update(nowMs, airborne, wx, y) {
    if (!airborne) { this._lastX = NaN; return; }
    const dx = wx - this._lastX, dy = y - this._lastY;
    if (Number.isFinite(this._lastX) && dx * dx + dy * dy < SPACING_PX * SPACING_PX) return;
    this.dabs.push({ wx, y, hue: (this._hueIdx++ * HUE_STEP_DEG) % 360, bornMs: nowMs });
    this._lastX = wx; this._lastY = y;
    if (this.dabs.length > MAX_DABS) this.dabs.shift();
  }

  draw(ctx, worldX, originX, nowMs, sizeMul = 1) {
    while (this.dabs.length && nowMs - this.dabs[0].bornMs >= LIFE_MS) this.dabs.shift();
    if (this.dabs.length === 0) return;
    ctx.save();
    for (const d of this.dabs) {
      const age = (nowMs - d.bornMs) / LIFE_MS;
      const size = Math.max(3, Math.round((9 - 4 * age) * sizeMul));
      ctx.globalAlpha = 0.72 * (1 - age);
      ctx.fillStyle = `hsl(${d.hue},90%,62%)`;
      const x = Math.round(d.wx - worldX + originX - size / 2);
      ctx.fillRect(x, Math.round(d.y - size / 2), size, size);
    }
    ctx.restore();
  }
}
