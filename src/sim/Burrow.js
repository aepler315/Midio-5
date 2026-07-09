// Broshi's underground excursion: he dives beneath the ground and swims
// through an intricate cavern generated from noise (see marchingSquares.js),
// steering away from rock via direct potential-field sampling of the same
// noise field the walls were extracted from -- a hard guarantee he never
// swims into solid earth, not just a statistical one. The cave geometry is
// pure data here (fully unit-testable); draw() composites the "dirt-sight"
// fog-of-war (browser-only -- needs a real canvas).
import { mulberry32, clamp01, lerp } from '../utils/math.js';
import { curl2, valueNoise3 } from '../utils/fields.js';
import {
  sampleCaveGrid, extractContours, insetContour, polygonArea, polygonCentroid,
} from '../render/marchingSquares.js';

export const BurrowPhase = Object.freeze({
  IDLE: 'IDLE', DIG_IN: 'DIG_IN', TUNNELING: 'TUNNELING', ERUPT: 'ERUPT',
});

const DIG_IN_SEC = 0.7;
const TUNNEL_SEC = 8.0;
const ERUPT_SEC = 0.5;
const GRID_COLS = 110, GRID_ROWS = 20;
const CELL_PX = 13;
const NOISE_SCALE = 0.09;
const THRESHOLD = 0.5;
const SWIM_SPEED_PX_S = 130;
const RIDGE_PERIOD_SEC = 1.0; // a mole-ridge surface tell at a fixed cadence
const MIN_CONTOUR_AREA = 6; // grid-units^2; skip decorating tiny noise-blob contours
const MAX_SPIKES = 14; // combined stalactite + stalagmite cap
const MAX_CRYSTALS = 5;

export class Burrow {
  constructor(seed = 1) {
    this.rand = mulberry32((seed ^ 0x8123) >>> 0 || 1);
    this.phase = BurrowPhase.IDLE;
    this.phaseStartMs = 0;
    this.p = { x: 0, y: 0 }; // world px
    this.heading = 0;
    this.contours = []; // [{points:[{x,y}] (world px), insets:[[...]x2], area}]
    this.stalactites = []; // [{x,y}] anchor points (world px), hanging from a ceiling edge
    this.stalagmites = []; // [{x,y}] anchor points, growing from a floor edge
    this.crystals = []; // [{x,y,hue}]
    this._worldOriginX = 0;
    this._gx = GRID_COLS / 2;
    this._gy = GRID_ROWS / 2;
    this._t = 0;
    this._nextRidgeMs = -Infinity;
    this._enteredTunneling = false;
    this._diveTarget = { x: 0, y: 0 };
  }

  get active() { return this.phase !== BurrowPhase.IDLE; }

  /** Fraction of the way into "fully underground" -- 0 at the surface, 1
   * once diving/tunneling/erupting are all in the underground band. Used
   * to fade Broshi's normal surface glyph out and back in. */
  get depth() {
    if (this.phase === BurrowPhase.DIG_IN) return clamp01(((this._nowMs ?? 0) - this.phaseStartMs) / (DIG_IN_SEC * 1000));
    if (this.phase === BurrowPhase.TUNNELING) return 1;
    if (this.phase === BurrowPhase.ERUPT) return 1 - clamp01(((this._nowMs ?? 0) - this.phaseStartMs) / (ERUPT_SEC * 1000));
    return 0;
  }

  trigger(nowMs, fromPos, worldX, groundY) {
    if (this.active) return false;
    this.phase = BurrowPhase.DIG_IN;
    this.phaseStartMs = nowMs;
    this._nowMs = nowMs;
    this._diveTarget = { ...fromPos };
    this._groundY = groundY;
    this._dugInPulseFired = false;
    this._geoCanvas = null; // rebuilt lazily on first draw() from the fresh geometry below
    this._generateCave(worldX);
    return true;
  }

  forceEnd(nowMs) {
    if (!this.active || this.phase === BurrowPhase.ERUPT) return;
    this.phase = BurrowPhase.ERUPT;
    this.phaseStartMs = nowMs;
  }

  _noiseAt(gx, gy) {
    return valueNoise3((this._worldOriginX / CELL_PX + gx) * NOISE_SCALE, gy * NOISE_SCALE, this._seedZ);
  }

  _generateCave(worldX) {
    this._worldOriginX = worldX;
    this._seedZ = this.rand() * 1000;
    const originGrid = worldX / CELL_PX;
    const grid = sampleCaveGrid(GRID_COLS, GRID_ROWS, originGrid, this._seedZ, { noiseScale: NOISE_SCALE });
    const rawContours = extractContours(grid, GRID_COLS, GRID_ROWS, THRESHOLD);

    // Local cave-window pixel space (not world coordinates): this is what
    // gets baked into the static geo-canvas once in draw(); the live
    // worldX/groundY offset is applied only at blit time each frame.
    const toLocal = (pt) => ({ x: pt.x * CELL_PX, y: pt.y * CELL_PX });
    this.contours = rawContours.map((c) => ({
      points: c.points.map(toLocal),
      insets: [0.10, 0.20].map((f) => insetContour(c.points, f).map(toLocal)),
      area: Math.abs(polygonArea(c.points)),
    }));

    // Entry point: search outward from the grid center for an open cell.
    let entry = { x: GRID_COLS / 2, y: GRID_ROWS / 2 };
    if (this._noiseAt(entry.x, entry.y) > THRESHOLD) {
      outer: for (let r = 1; r < 8; r++) {
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          const cand = { x: entry.x + Math.cos(ang) * r * 1.5, y: entry.y + Math.sin(ang) * r * 1.5 };
          if (this._noiseAt(cand.x, cand.y) <= THRESHOLD) { entry = cand; break outer; }
        }
      }
    }
    this._gx = entry.x;
    this._gy = entry.y;
    this.heading = this.rand() * Math.PI * 2;

    this.stalactites = [];
    this.stalagmites = [];
    this.crystals = [];
    const bigContours = rawContours.filter((c) => Math.abs(polygonArea(c.points)) > MIN_CONTOUR_AREA);
    for (const c of bigContours) {
      const pts = c.points;
      for (let i = 0; i < pts.length; i += 3) {
        if (this.stalactites.length + this.stalagmites.length >= MAX_SPIKES) break;
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const above = this._noiseAt(mx, my - 0.6);
        const below = this._noiseAt(mx, my + 0.6);
        const len = 14 + this.rand() * 10; // fixed at generation time -- draw() never calls rand()
        if (above > THRESHOLD && below <= THRESHOLD) this.stalactites.push({ ...toLocal({ x: mx, y: my }), len });
        else if (below > THRESHOLD && above <= THRESHOLD) this.stalagmites.push({ ...toLocal({ x: mx, y: my }), len });
      }
    }
    const bySize = [...rawContours].sort((c1, c2) => Math.abs(polygonArea(c2.points)) - Math.abs(polygonArea(c1.points)));
    for (const c of bySize.slice(0, 3)) {
      if (this.crystals.length >= MAX_CRYSTALS) break;
      const centroid = toLocal(polygonCentroid(c.points));
      this.crystals.push({ x: centroid.x + (this.rand() - 0.5) * 20, y: centroid.y + (this.rand() - 0.5) * 20, hue: 180 + this.rand() * 60 });
    }
  }

  /** Advances the phase machine, Broshi's underground steering, and the
   * surface mole-ridge tell. `groundField` (optional) receives pulseAt()
   * calls for both the mole-ridge and the DIG_IN/ERUPT ground deformation --
   * passing null is fine for pure-logic tests that don't care about the
   * ground's visual reaction. */
  update(nowMs, dtSec, worldX, groundField = null) {
    this._nowMs = nowMs;
    if (!this.active) return;
    this._t += dtSec;

    if (this.phase === BurrowPhase.DIG_IN) {
      if (!this._dugInPulseFired) {
        this._dugInPulseFired = true;
        if (groundField) groundField.pulseAt(nowMs, worldX, 34, nowMs + 260);
      }
      const u = clamp01((nowMs - this.phaseStartMs) / (DIG_IN_SEC * 1000));
      this.p = { x: this._diveTarget.x, y: this._diveTarget.y + u * u * 60 }; // an accelerating nose-down dip
      if (u >= 1) {
        this.phase = BurrowPhase.TUNNELING;
        this.phaseStartMs = nowMs;
        this._nextRidgeMs = nowMs + RIDGE_PERIOD_SEC * 1000;
      }
    } else if (this.phase === BurrowPhase.TUNNELING) {
      this._stepSwim(dtSec);
      this.p = { x: this._worldOriginX + this._gx * CELL_PX, y: this._groundY + this._gy * CELL_PX };

      if (groundField && nowMs >= this._nextRidgeMs) {
        this._nextRidgeMs = nowMs + RIDGE_PERIOD_SEC * 1000;
        groundField.pulseAt(nowMs, this.p.x, -7, nowMs + 220);
      }
      if (nowMs - this.phaseStartMs >= TUNNEL_SEC * 1000) {
        this.phase = BurrowPhase.ERUPT;
        this.phaseStartMs = nowMs;
        if (groundField) groundField.pulseAt(nowMs, this.p.x, 46, nowMs + 480);
      }
    } else if (this.phase === BurrowPhase.ERUPT) {
      const u = clamp01((nowMs - this.phaseStartMs) / (ERUPT_SEC * 1000));
      this.p = { x: lerp(this.p.x, this._diveTarget.x, u), y: lerp(this.p.y, this._diveTarget.y, u) };
      if (u >= 1) {
        this.phase = BurrowPhase.IDLE;
        this.contours = [];
        this.stalactites = [];
        this.stalagmites = [];
        this.crystals = [];
      }
    }
  }

  /** Curl-noise wander with hard wall avoidance: if the tentative next
   * position would be inside rock, a handful of alternate headings are
   * tried and the lowest-noise one is taken instead. If even the best
   * option is still rock (a tight corner), he simply holds position for
   * that frame rather than tunneling through the wall. */
  _stepSwim(dtSec) {
    const wander = curl2(this._t * 0.6, this._gx * 0.3, this._t * 0.4);
    this.heading += wander.x * dtSec * 2;

    const tryHeading = (h) => {
      const gx = this._gx + (Math.cos(h) * SWIM_SPEED_PX_S * dtSec) / CELL_PX;
      const gy = this._gy + (Math.sin(h) * SWIM_SPEED_PX_S * dtSec) / CELL_PX;
      return { gx, gy, noise: this._noiseAt(gx, gy) };
    };

    let best = tryHeading(this.heading);
    if (best.noise > THRESHOLD) {
      for (let k = -3; k <= 3; k++) {
        if (k === 0) continue;
        const cand = tryHeading(this.heading + k * 0.35);
        if (cand.noise < best.noise) best = { ...cand, heading: this.heading + k * 0.35 };
      }
      if (best.heading !== undefined) this.heading = best.heading;
    }
    if (best.noise > THRESHOLD) return; // cornered -- hold position this frame
    this._gx = clamp01(best.gx / GRID_COLS) * GRID_COLS;
    this._gy = clamp01(best.gy / GRID_ROWS) * GRID_ROWS;
  }

  // --- Rendering (browser-only: needs a real <canvas>, not covered by
  // node --test). Draws the underground band beneath the world: a static
  // "geo" image of the cave (built once per burrow), masked each frame by
  // a "vision" alpha field that blooms around Broshi as he swims and fades
  // behind him -- the fog-of-war dirt-sight. ---

  _ensureCanvases() {
    if (this._geoCanvas) return;
    const w = GRID_COLS * CELL_PX, h = GRID_ROWS * CELL_PX;
    this._geoCanvas = this._buildGeoCanvas(w, h);
    this._visionCanvas = document.createElement('canvas');
    this._visionCanvas.width = w; this._visionCanvas.height = h;
    this._scratchCanvas = document.createElement('canvas');
    this._scratchCanvas.width = w; this._scratchCanvas.height = h;
    this._erupted = false;
  }

  _strokePoly(ctx, points) {
    ctx.beginPath();
    points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.closePath();
    ctx.stroke();
  }

  _buildGeoCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1024';
    ctx.fillRect(0, 0, w, h);

    for (const c of this.contours) {
      ctx.strokeStyle = 'hsla(260, 30%, 72%, 0.9)';
      ctx.lineWidth = 2;
      this._strokePoly(ctx, c.points);
      ctx.strokeStyle = 'hsla(260, 25%, 60%, 0.4)';
      ctx.lineWidth = 1;
      for (const inset of c.insets) this._strokePoly(ctx, inset);
    }

    ctx.fillStyle = 'hsla(250, 20%, 58%, 0.85)';
    for (const s of this.stalactites) {
      ctx.beginPath();
      ctx.moveTo(s.x - 4, s.y); ctx.lineTo(s.x, s.y + s.len); ctx.lineTo(s.x + 4, s.y);
      ctx.closePath(); ctx.fill();
    }
    for (const s of this.stalagmites) {
      ctx.beginPath();
      ctx.moveTo(s.x - 4, s.y); ctx.lineTo(s.x, s.y - s.len); ctx.lineTo(s.x + 4, s.y);
      ctx.closePath(); ctx.fill();
    }

    for (const cr of this.crystals) {
      ctx.save();
      ctx.translate(cr.x, cr.y);
      ctx.fillStyle = `hsla(${cr.hue}, 70%, 70%, 0.8)`;
      ctx.strokeStyle = `hsla(${cr.hue}, 80%, 88%, 0.9)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        const r = i % 2 === 0 ? 10 : 5;
        const px = Math.cos(ang) * r, py = Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    return canvas;
  }

  draw(ctx, worldX, originX) {
    if (!this.active || this.depth <= 0.02) return;
    this._ensureCanvases();
    const w = GRID_COLS * CELL_PX, h = GRID_ROWS * CELL_PX;
    const vctx = this._visionCanvas.getContext('2d');

    // Memory fades: what he's already seen dims back into darkness rather
    // than staying revealed, so the cave blooms into visibility as he
    // swims and fades like an after-image behind him.
    vctx.save();
    vctx.globalCompositeOperation = 'destination-out';
    vctx.fillStyle = 'rgba(0,0,0,0.007)';
    vctx.fillRect(0, 0, w, h);
    vctx.restore();

    // The eruption payoff: the whole system floods into view for a beat.
    if (this.phase === BurrowPhase.ERUPT && !this._erupted) {
      this._erupted = true;
      vctx.fillStyle = 'white';
      vctx.fillRect(0, 0, w, h);
    }

    // Headlight: a soft ellipse offset ahead of his heading.
    const lx = this._gx * CELL_PX, ly = this._gy * CELL_PX;
    const hx = lx + Math.cos(this.heading) * 30, hy = ly + Math.sin(this.heading) * 30;
    const HEADLIGHT_R = 145;
    const grad = vctx.createRadialGradient(hx, hy, 0, hx, hy, HEADLIGHT_R);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    vctx.fillStyle = grad;
    vctx.beginPath();
    vctx.arc(hx, hy, HEADLIGHT_R, 0, Math.PI * 2);
    vctx.fill();

    // Composite: the static geometry, masked by the live vision field.
    const sctx = this._scratchCanvas.getContext('2d');
    sctx.clearRect(0, 0, w, h);
    sctx.globalCompositeOperation = 'source-over';
    sctx.drawImage(this._geoCanvas, 0, 0);
    sctx.globalCompositeOperation = 'destination-in';
    sctx.drawImage(this._visionCanvas, 0, 0);
    sctx.globalCompositeOperation = 'source-over';

    const screenX = this._worldOriginX - worldX + originX;
    const screenY = this._groundY;

    ctx.save();
    ctx.fillStyle = '#140d1c';
    ctx.fillRect(screenX, screenY, w, h);
    ctx.drawImage(this._scratchCanvas, screenX, screenY);

    // Broshi himself: a small marker plus a short dotted excavation line
    // trailing behind his heading.
    const bx = screenX + lx, by = screenY + ly;
    ctx.strokeStyle = 'rgba(150,255,180,0.35)';
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx - Math.cos(this.heading) * 40, by - Math.sin(this.heading) * 40);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#a8f0c0';
    ctx.beginPath();
    ctx.arc(bx, by, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
