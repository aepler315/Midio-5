// Progressive screen fracturing + terminal shatter (spec §4.2). The screen
// is a pane of glass the song slowly destroys: a stress accumulator births
// procedural crack trees through the song, and the final 300ms triangulates
// the accumulated damage into flying shards over a frozen last frame.
import { clamp, clamp01, mulberry32, hashSeed, lerp } from '../utils/math.js';
import { delaunayTriangulate, poissonDiscSample } from '../utils/delaunay.js';
import { ObjectPool } from '../utils/ObjectPool.js';
import { FLAT_WEIGHTS } from '../audio/bands.js';
import { Role } from '../core/NoteEvent.js';

const THRESHOLDS = [0.15, 0.27, 0.39, 0.51, 0.63, 0.75, 0.85, 0.93];
const GROW_MS = 1800;
const KICK_SYNC_WINDOW_MS = 120;
const FREEZE_LEAD_MS = 300;
const FLASH_AT_MS = 260; // relative to freeze start (T-300 -> flash at T-40)
const FLASH_DUR_MS = 60;
const FADE_START_MS = 150;
const SHATTER_TOTAL_MS = 600;

function growPolyline(rand, origin, heading, segCount) {
  const nodes = [origin];
  const headings = [heading];
  const lengths = [];
  let h = heading, total = 0;
  for (let i = 0; i < segCount; i++) {
    const len = 18 + rand() * 24;
    h += rand() * 50 - 25;
    const rad = (h * Math.PI) / 180;
    const prev = nodes[nodes.length - 1];
    nodes.push({ x: prev.x + Math.cos(rad) * len, y: prev.y + Math.sin(rad) * len });
    headings.push(h);
    lengths.push(len);
    total += len;
  }
  return { nodes, headings, lengths, total };
}

function buildCrackNode(rand, origin, heading, segCount, depth, maxDepth) {
  const { nodes, headings, lengths, total } = growPolyline(rand, origin, heading, segCount);
  const children = [];
  if (depth < maxDepth && total > 0) {
    let arc = 0;
    for (let i = 0; i < lengths.length; i++) {
      arc += lengths[i];
      if (rand() < 0.18) {
        const offset = (rand() < 0.5 ? -1 : 1) * (30 + rand() * 25);
        const childSegCount = Math.max(2, Math.round(segCount / 2));
        const child = buildCrackNode(rand, nodes[i + 1], headings[i + 1] + offset, childSegCount, depth + 1, maxDepth);
        child.parentArcFraction = arc / total;
        children.push(child);
      }
    }
  }
  return { nodes, lengths, total, children };
}

function assignBirthTimes(crack, birthMs) {
  crack.birthMs = birthMs;
  for (const child of crack.children) assignBirthTimes(child, birthMs + GROW_MS * child.parentArcFraction);
}

function spawnCrackTree(songSeed, generation, w, h) {
  const rand = mulberry32(hashSeed(`${songSeed}:crack:${generation}`));
  const perimeter = 2 * (w + h);
  const d = rand() * perimeter;
  let origin, normalDeg;
  if (d < w) { origin = { x: d, y: 0 }; normalDeg = 90; }
  else if (d < w + h) { origin = { x: w, y: d - w }; normalDeg = 180; }
  else if (d < 2 * w + h) { origin = { x: 2 * w + h - d, y: h }; normalDeg = 270; }
  else { origin = { x: 0, y: 2 * w + 2 * h - d }; normalDeg = 0; }
  const heading0 = normalDeg + (rand() * 40 - 20);
  const segCount = 6 + Math.floor(rand() * 8);
  const tree = buildCrackNode(rand, origin, heading0, segCount, 0, 3);
  return tree;
}

function collectNodes(crack, out) {
  for (const n of crack.nodes) out.push(n);
  for (const c of crack.children) collectNodes(c, out);
}

function drawRevealedPolyline(ctx, nodes, lengths, total, revealLen) {
  if (revealLen <= 0 || total <= 0) return;
  const pts = [nodes[0]];
  let acc = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (acc + lengths[i] <= revealLen) { pts.push(nodes[i + 1]); acc += lengths[i]; }
    else {
      const f = (revealLen - acc) / lengths[i];
      const a = nodes[i], b = nodes[i + 1];
      pts.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      break;
    }
  }
  ctx.strokeStyle = '#9fd9ff';
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) { if (i === 0) ctx.moveTo(pts[i].x, pts[i].y); else ctx.lineTo(pts[i].x, pts[i].y); }
  ctx.stroke();

  ctx.strokeStyle = '#ffffff';
  ctx.globalAlpha = 0.55;
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const segLen = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const wStart = lerp(2, 0.5, s / total);
    s += segLen;
    const wEnd = lerp(2, 0.5, Math.min(1, s / total));
    ctx.lineWidth = (wStart + wEnd) / 2;
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
}

function drawCrackTree(ctx, crack, nowMs) {
  const t = clamp01((nowMs - crack.birthMs) / GROW_MS);
  const eased = 1 - (1 - t) ** 3;
  drawRevealedPolyline(ctx, crack.nodes, crack.lengths, crack.total, crack.total * eased);
  for (const child of crack.children) {
    if (nowMs >= child.birthMs) drawCrackTree(ctx, child, nowMs);
  }
}

export class FractureEngine {
  constructor(conductor, { canvasWidth, canvasHeight, songSeed, durationMs }) {
    this.conductor = conductor;
    this.w = canvasWidth;
    this.h = canvasHeight;
    this.songSeed = songSeed;
    this.durationMs = durationMs;

    this.impactStress = 0;
    this._barAccum = 0;
    this._barSamples = 0;
    this._barEnergyHistory = [];
    this.stress = 0;
    this._nextThresholdIdx = 0;
    this._pendingBirths = [];
    this.cracks = [];

    this.flashAlpha = 0;

    this.shatterState = 'idle'; // idle | about-to-freeze | frozen | done
    this.freezeMs = null;
    this.freezeFrame = null;
    this.fragments = new ObjectPool(() => ({}), (o, i) => Object.assign(o, i), 256);
    this._flashFired = false;

    conductor.onBar(() => {
      const e = this._barSamples > 0 ? this._barAccum / this._barSamples : 0;
      this._barEnergyHistory.push(e);
      if (this._barEnergyHistory.length > 8) this._barEnergyHistory.shift();
      this._barAccum = 0;
      this._barSamples = 0;
    });
  }

  registerImpact(I) {
    this.impactStress = Math.min(1, this.impactStress + 0.02 * I);
  }

  update(nowMs, dtSec, energyCurves, camera) {
    this._lastNowMs = nowMs;
    if (this.shatterState === 'frozen' || this.shatterState === 'done') {
      this._updateShatter(nowMs, dtSec);
      return;
    }

    const gInstant = energyCurves ? energyCurves.globalEnergy(nowMs, FLAT_WEIGHTS) : 0;
    this._barAccum += gInstant;
    this._barSamples++;
    const eBar = this._barEnergyHistory.length
      ? this._barEnergyHistory.reduce((a, b) => a + b, 0) / this._barEnergyHistory.length
      : 0;

    const tNorm = this.durationMs > 0 ? clamp01(nowMs / this.durationMs) : 0;
    this.stress = clamp(0.70 * tNorm ** 1.4 + 0.25 * eBar + this.impactStress, 0, 1);

    while (this._nextThresholdIdx < THRESHOLDS.length && this.stress >= THRESHOLDS[this._nextThresholdIdx]) {
      const generation = this._nextThresholdIdx;
      this._nextThresholdIdx++;
      const nearestKick = this.conductor.nearestEventMs((e) => e.role === Role.RHYTHM && e.kick, nowMs, KICK_SYNC_WINDOW_MS);
      const birthMs = nearestKick ? Math.max(nowMs, nearestKick.tMs) : nowMs;
      this._pendingBirths.push({ generation, birthMs });
    }

    for (let i = this._pendingBirths.length - 1; i >= 0; i--) {
      const pb = this._pendingBirths[i];
      if (nowMs >= pb.birthMs) {
        this._birthCrack(pb.generation, pb.birthMs, camera);
        this._pendingBirths.splice(i, 1);
      }
    }

    this.flashAlpha = Math.max(0, this.flashAlpha - dtSec / 0.04);

    if (this.durationMs > 0 && this.shatterState === 'idle' && nowMs >= this.durationMs - FREEZE_LEAD_MS) {
      this.shatterState = 'about-to-freeze';
    }
  }

  _birthCrack(generation, birthMs, camera) {
    const tree = spawnCrackTree(this.songSeed, generation, this.w, this.h);
    assignBirthTimes(tree, birthMs);
    this.cracks.push(tree);
    this.flashAlpha = 1;
    if (camera) camera.shake(4);
  }

  draw(ctx, canvas) {
    if (this.shatterState === 'frozen' || this.shatterState === 'done') return; // handled by Renderer's shatter path
    ctx.save();
    for (const crack of this.cracks) drawCrackTree(ctx, crack, this._lastNowMs ?? 0);
    if (this.flashAlpha > 0.01) {
      ctx.globalAlpha = this.flashAlpha * 0.9;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.restore();
  }

  /** Renderer calls this once, right after drawing the frame the freeze should capture. */
  captureFreeze(sourceCanvas, nowMs) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(this.w, this.h) : document.createElement('canvas');
    if (!(c instanceof OffscreenCanvas)) { c.width = this.w; c.height = this.h; }
    const fctx = c.getContext('2d');
    fctx.drawImage(sourceCanvas, 0, 0, this.w, this.h);
    this.freezeFrame = c;
    this.freezeMs = nowMs;
    this.shatterState = 'frozen';
    this._triangulate();
  }

  _triangulate() {
    const nodePoints = [];
    for (const crack of this.cracks) collectNodes(crack, nodePoints);
    const rand = mulberry32(hashSeed(`${this.songSeed}:shatter`));
    const interior = poissonDiscSample(this.w, this.h, 90, rand);
    const corners = [{ x: 0, y: 0 }, { x: this.w, y: 0 }, { x: this.w, y: this.h }, { x: 0, y: this.h }];
    const points = [...nodePoints.filter((p) => p.x >= 0 && p.x <= this.w && p.y >= 0 && p.y <= this.h), ...interior, ...corners];

    const tris = delaunayTriangulate(points);
    const screenCx = this.w / 2, screenCy = this.h / 2;

    for (const t of tris) {
      const a = points[t[0]], b = points[t[1]], c = points[t[2]];
      const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3;
      let dx = cx - screenCx, dy = cy - screenCy;
      const dlen = Math.hypot(dx, dy) || 1;
      dx /= dlen; dy /= dlen;
      const speed = 140 + rand() * 260;
      this.fragments.spawn({
        tri: [{ x: a.x - cx, y: a.y - cy }, { x: b.x - cx, y: b.y - cy }, { x: c.x - cx, y: c.y - cy }],
        cx, cy, x: cx, y: cy,
        vx: dx * speed, vy: dy * speed - 80,
        rot: 0, omega: (rand() * 2 - 1) * 6,
        age: 0,
      });
    }
    this._flashFired = false;
  }

  _updateShatter(nowMs, dtSec) {
    const t = nowMs - this.freezeMs;
    this.fragments.step(dtSec, (f) => {
      f.vy += 900 * dtSec;
      f.x += f.vx * dtSec;
      f.y += f.vy * dtSec;
      f.rot += f.omega * dtSec;
      f.age += dtSec * 1000;
      return true; // reclaimed manually below once shatter completes
    });

    if (!this._flashFired && t >= FLASH_AT_MS) { this._flashFired = true; this.flashAlpha = 0.3; }
    if (this._flashFired) this.flashAlpha = Math.max(0, this.flashAlpha - dtSec / (FLASH_DUR_MS / 1000));

    if (t >= SHATTER_TOTAL_MS && this.shatterState !== 'done') {
      this.shatterState = 'done';
      this.fragments.clear();
    }
  }

  get isFrozen() { return this.shatterState === 'frozen'; }
  get isAboutToFreeze() { return this.shatterState === 'about-to-freeze'; }
  get isDone() { return this.shatterState === 'done'; }

  drawShatter(ctx, canvas) {
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const t = (this._lastNowMs ?? this.freezeMs) - this.freezeMs;
    const fadeAlpha = t < FADE_START_MS ? 1 : clamp01(1 - (t - FADE_START_MS) / (SHATTER_TOTAL_MS - FADE_START_MS));

    for (const f of this.fragments.active) {
      ctx.save();
      ctx.globalAlpha = fadeAlpha;
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.beginPath();
      ctx.moveTo(f.tri[0].x, f.tri[0].y);
      ctx.lineTo(f.tri[1].x, f.tri[1].y);
      ctx.lineTo(f.tri[2].x, f.tri[2].y);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(this.freezeFrame, -f.cx, -f.cy);
      ctx.restore();
    }

    if (this.flashAlpha > 0.01) {
      ctx.globalAlpha = this.flashAlpha;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.restore();
  }
}
