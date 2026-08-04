// Progressive screen fracturing + terminal shatter (spec §4.2). The screen
// is a pane of glass the song slowly destroys: a stress accumulator births
// crack trees that subtly outline the ridges of a massive, impossible
// Denali-like mountain range. The final lead freezes the last frame, then
// shards ease apart and fade rather than detonating in a hard flash.
import { clamp, clamp01, mulberry32, hashSeed, lerp, smoothstep } from '../utils/math.js';
import { delaunayTriangulate, poissonDiscSample } from '../utils/delaunay.js';
import { ObjectPool } from '../utils/ObjectPool.js';
import { FLAT_WEIGHTS } from '../audio/bands.js';
import { Role } from '../core/NoteEvent.js';
import {
  analyzeSongFinale, buildPeakProgress, FINALE_FREEZE_LEAD_MS,
} from '../core/SongFinale.js';

// Many small ridge pieces, spaced evenly across song progress so the
// mountain draws itself gradually through the whole track (not a late pile-up).
export const RIDGE_GEN_COUNT = 16;
/** Even stress thresholds in [start, end] for progressive ridge birth. */
export function buildStressThresholds(count = RIDGE_GEN_COUNT, start = 0.04, end = 0.92) {
  const n = Math.max(1, count | 0);
  if (n === 1) return [start];
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = start + ((end - start) * i) / (n - 1);
  return out;
}
const THRESHOLDS = buildStressThresholds(RIDGE_GEN_COUNT);
// Slow grow: each ridge inks on over several seconds so births don't flash.
const GROW_MS = 3400;
const KICK_SYNC_WINDOW_MS = 120;
const FREEZE_LEAD_MS = FINALE_FREEZE_LEAD_MS;
// Shatter timing: a short hold on the frozen frame, then a long ease-out
// so the glass falls apart instead of exploding and vanishing in 600ms.
const FREEZE_HOLD_MS = 90;
const FLASH_AT_MS = 70; // soft white kiss right as shards begin to move
const FLASH_DUR_MS = 140;
const FADE_START_MS = 520;
const SHATTER_TOTAL_MS = 1600;
const SHATTER_BURST_MS = 380; // velocity eases from 0 → full over this window after hold

/**
 * Build polyline geometry from an ordered list of points.
 * @returns {{nodes:{x:number,y:number}[], lengths:number[], total:number, children:any[]}}
 */
export function polylineFromPoints(points) {
  const nodes = points.map((p) => ({ x: p.x, y: p.y }));
  const lengths = [];
  let total = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    const len = Math.hypot(nodes[i + 1].x - nodes[i].x, nodes[i + 1].y - nodes[i].y);
    lengths.push(len);
    total += len;
  }
  return { nodes, lengths, total, children: [] };
}

/**
 * Sample a jagged ridge chord between two points (integer midpoints, seeded
 * noise). Keeps polylines readable as ridgelines rather than smooth arcs.
 */
function jaggedChord(a, b, nMids, rand, ampPx) {
  const pts = [a];
  for (let i = 1; i <= nMids; i++) {
    const t = i / (nMids + 1);
    const x = lerp(a.x, b.x, t);
    const y = lerp(a.y, b.y, t);
    // Perpendicular jitter — ridge sawtooth, not soft noise.
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const j = (rand() * 2 - 1) * ampPx * (0.4 + 0.6 * Math.sin(t * Math.PI));
    pts.push({ x: x + nx * j, y: y + ny * j });
  }
  pts.push(b);
  return pts;
}

/**
 * Pure: a deterministic "impossible Denali" ridge plan for the screen.
 * Returns many *small* polylines (one birth each) so the massif inks on
 * gradually across the song. Peaks sit high (small canvas y); foothills
 * sit lower. Impossible geometry: floating spur peak, sky-hook ridge.
 *
 * @param {number} w canvas width
 * @param {number} h canvas height
 * @param {number} seed
 * @param {number} [count] number of ridge polylines (matches THRESHOLDS)
 */
export function buildMountainRidgePolylines(w, h, seed, count = RIDGE_GEN_COUNT) {
  const rand = mulberry32((seed ^ 0xde7a11) >>> 0 || 1);
  const foothills = h * 0.78;
  const midRidge = h * 0.48;
  const high = h * 0.18;
  const skyHook = h * 0.08;

  // Major summits (Denali massif bias: dominant central peak, satellite shoulders).
  const peaks = [
    { x: w * 0.12, y: foothills - h * 0.08 },
    { x: w * 0.22, y: midRidge + h * 0.06 },
    { x: w * 0.34, y: high + h * 0.10 },
    { x: w * 0.46, y: high },
    { x: w * 0.55, y: high + h * 0.07 },
    { x: w * 0.68, y: midRidge },
    { x: w * 0.82, y: midRidge + h * 0.12 },
    { x: w * 0.94, y: foothills - h * 0.05 },
  ].map((p) => ({
    x: p.x + (rand() - 0.5) * w * 0.02,
    y: p.y + (rand() - 0.5) * h * 0.02,
  }));

  const floating = {
    x: w * (0.40 + rand() * 0.08),
    y: skyHook + rand() * h * 0.04,
  };
  const skySpur = {
    x: peaks[3].x + w * 0.06,
    y: skyHook + h * 0.02,
  };

  // Small chord pieces — one birth each — so the range appears bit by bit.
  const plans = [];
  const pushChord = (a, b, mids = 2, amp = 8) => {
    plans.push(polylineFromPoints(jaggedChord(a, b, mids, rand, amp)));
  };

  // Main crest, peak-to-peak (west → summit → east)
  for (let i = 0; i < peaks.length - 1; i++) {
    pushChord(peaks[i], peaks[i + 1], 2 + (i % 2), 7 + (i % 3));
  }

  // Foothill traverse as several short segments
  {
    const base = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      base.push({
        x: w * (0.08 + 0.84 * t),
        y: foothills - h * 0.035 * Math.sin(t * Math.PI * 2.2 + 0.4)
          - h * 0.02 * Math.sin(t * Math.PI * 5)
          + (rand() - 0.5) * 6,
      });
    }
    for (let i = 0; i < base.length - 1; i++) pushChord(base[i], base[i + 1], 1, 5);
  }

  // Couloir / spur pieces (subtle interior structure)
  pushChord(peaks[3], { x: peaks[3].x - w * 0.04, y: foothills - h * 0.02 }, 3, 7);
  pushChord(peaks[4], { x: floating.x - w * 0.04, y: floating.y + h * 0.12 }, 2, 6);
  pushChord(peaks[2], { x: peaks[2].x + w * 0.03, y: foothills - h * 0.06 }, 2, 6);
  pushChord(peaks[5], { x: peaks[5].x - w * 0.05, y: foothills - h * 0.04 }, 2, 6);

  // Impossible floating peak (two short strokes, not a loud outline)
  pushChord(
    { x: floating.x - w * 0.04, y: floating.y + h * 0.05 },
    floating,
    1, 4,
  );
  pushChord(
    floating,
    { x: floating.x + w * 0.045, y: floating.y + h * 0.06 },
    1, 4,
  );

  // Sky-hook spur (impossible climb off the massif)
  pushChord(peaks[3], skySpur, 2, 5);
  pushChord(skySpur, { x: skySpur.x + w * 0.07, y: high + h * 0.05 }, 1, 4);

  // Pad with faint mid-ridge connectors if we still need more generations
  while (plans.length < count) {
    const i = plans.length;
    const a = peaks[i % peaks.length];
    const b = peaks[(i + 3) % peaks.length];
    pushChord(
      { x: a.x, y: lerp(a.y, foothills, 0.4) },
      { x: b.x, y: lerp(b.y, foothills, 0.5) },
      2, 5,
    );
  }
  return plans.slice(0, count);
}

/**
 * Attach subtle branch cracks (couloirs / secondary spurs) along a ridge
 * polyline so it still reads as glass fracture, not a single stroked outline.
 */
function attachRidgeBranches(poly, rand, maxDepth = 1, depth = 0) {
  if (depth >= maxDepth || poly.nodes.length < 3) return poly;
  const children = [];
  let arc = 0;
  for (let i = 0; i < poly.lengths.length; i++) {
    arc += poly.lengths[i];
    if (rand() > 0.12) continue; // sparse couloirs — keep the ridge whisper-quiet
    const origin = poly.nodes[i + 1];
    const prev = poly.nodes[i];
    const heading = (Math.atan2(origin.y - prev.y, origin.x - prev.x) * 180) / Math.PI;
    const side = rand() < 0.5 ? -1 : 1;
    const branchHeading = heading + side * (40 + rand() * 35);
    // Branches tend downhill (positive y) like couloirs off a ridge.
    const downBias = side * 0 + 25 * (0.5 + rand());
    const hdg = branchHeading + downBias * 0.3;
    const segs = 2 + Math.floor(rand() * 3);
    const nodes = [origin];
    let hh = hdg;
    const lengths = [];
    let total = 0;
    for (let s = 0; s < segs; s++) {
      const len = 14 + rand() * 22;
      hh += rand() * 36 - 18;
      const rad = (hh * Math.PI) / 180;
      const p = nodes[nodes.length - 1];
      nodes.push({ x: p.x + Math.cos(rad) * len, y: p.y + Math.sin(rad) * len });
      lengths.push(len);
      total += len;
    }
    const child = attachRidgeBranches(
      { nodes, lengths, total, children: [] },
      rand,
      maxDepth,
      depth + 1,
    );
    child.parentArcFraction = arc / Math.max(poly.total, 1e-6);
    children.push(child);
  }
  poly.children = children;
  return poly;
}

function assignBirthTimes(crack, birthMs) {
  crack.birthMs = birthMs;
  for (const child of crack.children || []) {
    assignBirthTimes(child, birthMs + GROW_MS * (child.parentArcFraction ?? 0));
  }
}

function collectNodes(crack, out) {
  for (const n of crack.nodes) out.push(n);
  for (const c of crack.children || []) collectNodes(c, out);
}

function drawRevealedPolyline(ctx, nodes, lengths, total, revealLen, glow = true) {
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
  // Hairline glass stroke — subtle enough to read as frost, not scaffolding.
  if (glow) {
    ctx.strokeStyle = '#9fd9ff';
    ctx.globalAlpha = 0.07;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
      else ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = '#ffffff';
  ctx.globalAlpha = 0.22;
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const segLen = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const wStart = lerp(0.95, 0.3, s / total);
    s += segLen;
    const wEnd = lerp(0.95, 0.3, Math.min(1, s / total));
    ctx.lineWidth = (wStart + wEnd) / 2;
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
}

function drawCrackTree(ctx, crack, nowMs, glow = true) {
  const t = clamp01((nowMs - crack.birthMs) / GROW_MS);
  const eased = 1 - (1 - t) ** 3;
  drawRevealedPolyline(ctx, crack.nodes, crack.lengths, crack.total, crack.total * eased, glow);
  for (const child of crack.children || []) {
    if (nowMs >= child.birthMs) drawCrackTree(ctx, child, nowMs, glow);
  }
}

/** Pure fade envelope for the shatter: hold full, then smoothstep down. */
export function shatterFadeAlpha(ageMs) {
  if (ageMs < FADE_START_MS) return 1;
  return 1 - smoothstep(FADE_START_MS, SHATTER_TOTAL_MS, ageMs);
}

/** Pure motion ease: 0 during freeze hold, then ease-out to 1. */
export function shatterMotionU(ageMs) {
  if (ageMs < FREEZE_HOLD_MS) return 0;
  return smoothstep(FREEZE_HOLD_MS, FREEZE_HOLD_MS + SHATTER_BURST_MS, ageMs);
}

export class FractureEngine {
  constructor(conductor, { canvasWidth, canvasHeight, songSeed, durationMs, energyCurves = null }) {
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

    // Precomputed impossible-Denali ridge plan — progressive births walk it
    // across the whole song (one small piece per stress threshold).
    this._ridgePlan = buildMountainRidgePolylines(this.w, this.h, songSeed, THRESHOLDS.length);

    this.flashAlpha = 0;

    this.shatterState = 'idle'; // idle | about-to-freeze | frozen | done
    this.freezeMs = null;
    this.freezeFrame = null;
    this.fragments = new ObjectPool(() => ({}), (o, i) => Object.assign(o, i), 256);
    this._flashFired = false;
    // One-shot flags for Simulation / main (audio silence, etc.).
    this.justEnteredFinale = false;
    this.audioSilenced = false;

    // Musical finale: last impact note + late build peak (not silence pad).
    this.finale = analyzeSongFinale(
      conductor.timeline || [],
      durationMs,
      energyCurves,
    );
    // about-to-freeze arms this far before freezeAtMs (last impact + ε).
    this._freezeArmMs = Math.max(0, this.finale.freezeAtMs - FREEZE_LEAD_MS);

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

    // Mostly linear song progress so ridge pieces birth evenly from ~4% to
    // ~92% of the track. Energy and impacts only nudge timing slightly —
    // they no longer clump all cracks into the loud final third.
    // Progress is relative to musical freeze (last impact), not silence pad.
    const musicalDur = Math.max(1, this.finale.freezeAtMs || this.durationMs || 1);
    const tNorm = clamp01(nowMs / musicalDur);
    // Late build-up peak slightly accelerates crack birth near the climax.
    const peakBoost = 0.10 * buildPeakProgress(nowMs, this.finale.buildPeakMs);
    this.stress = clamp(0.88 * tNorm + 0.08 * eBar + 0.12 * this.impactStress + peakBoost, 0, 1);

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
    this.justEnteredFinale = false;

    // Freeze arms on the last impact notes — not after empty duration padding.
    if (this.shatterState === 'idle' && this._freezeArmMs >= 0 && nowMs >= this._freezeArmMs) {
      this.shatterState = 'about-to-freeze';
      this.justEnteredFinale = true;
    }
  }

  _birthCrack(generation, birthMs, camera) {
    const rand = mulberry32(hashSeed(`${this.songSeed}:crack:${generation}`));
    const plan = this._ridgePlan[generation] || this._ridgePlan[this._ridgePlan.length - 1];
    // Clone plan geometry so birth/grow state is per-instance.
    const tree = attachRidgeBranches({
      nodes: plan.nodes.map((n) => ({ x: n.x, y: n.y })),
      lengths: plan.lengths.slice(),
      total: plan.total,
      children: [],
    }, rand, 2, 0);
    assignBirthTimes(tree, birthMs);
    this.cracks.push(tree);
    // Barely-there birth cue — no white-out, minimal shake.
    this.flashAlpha = 0.12;
    if (camera) camera.shake(1.2);
  }

  draw(ctx, canvas, { glow = true } = {}) {
    if (this.shatterState === 'frozen' || this.shatterState === 'done') return;
    ctx.save();
    for (const crack of this.cracks) drawCrackTree(ctx, crack, this._lastNowMs ?? 0, glow);
    if (this.flashAlpha > 0.01) {
      ctx.globalAlpha = this.flashAlpha * 0.12;
      ctx.fillStyle = '#cfefff';
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
    // Slightly denser sampling so shards follow ridge density more finely.
    const interior = poissonDiscSample(this.w, this.h, 78, rand);
    const corners = [{ x: 0, y: 0 }, { x: this.w, y: 0 }, { x: this.w, y: this.h }, { x: 0, y: this.h }];
    const points = [
      ...nodePoints.filter((p) => p.x >= 0 && p.x <= this.w && p.y >= 0 && p.y <= this.h),
      ...interior,
      ...corners,
    ];

    const tris = delaunayTriangulate(points);
    const screenCx = this.w / 2, screenCy = this.h / 2;

    for (const t of tris) {
      const a = points[t[0]], b = points[t[1]], c = points[t[2]];
      const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3;
      let dx = cx - screenCx, dy = cy - screenCy;
      const dlen = Math.hypot(dx, dy) || 1;
      dx /= dlen; dy /= dlen;
      // Gentler burst speeds; motion ease multiplies these at runtime.
      const speed = 55 + rand() * 110;
      // Stagger: shards near the main summit (upper-center) move first.
      const peakX = this.w * 0.46, peakY = this.h * 0.18;
      const distPeak = Math.hypot(cx - peakX, cy - peakY);
      const maxDist = Math.hypot(this.w, this.h);
      const startDelayMs = FREEZE_HOLD_MS + distPeak / maxDist * 220;
      this.fragments.spawn({
        tri: [{ x: a.x - cx, y: a.y - cy }, { x: b.x - cx, y: b.y - cy }, { x: c.x - cx, y: c.y - cy }],
        cx, cy, x: cx, y: cy,
        vx0: dx * speed, vy0: dy * speed - 30,
        rot: 0, omega: (rand() * 2 - 1) * 2.2,
        age: 0,
        startDelayMs,
      });
    }
    this._flashFired = false;
  }

  _updateShatter(nowMs, dtSec) {
    const t = nowMs - this.freezeMs;
    this.fragments.step(dtSec, (f) => {
      f.age += dtSec * 1000;
      const localAge = f.age - (f.startDelayMs || 0);
      if (localAge > 0) {
        // Ease motion in: full velocity after SHATTER_BURST_MS of this shard's life.
        const u = smoothstep(0, SHATTER_BURST_MS, localAge);
        const drag = 1 - 0.35 * u; // gentle coast, not constant rocket
        f.x += f.vx0 * u * drag * dtSec;
        f.y += (f.vy0 * u * drag + 420 * u * u) * dtSec; // gravity eases in too
        f.rot += f.omega * u * dtSec;
      }
      return true;
    });

    if (!this._flashFired && t >= FLASH_AT_MS) {
      this._flashFired = true;
      this.flashAlpha = 0.18; // soft kiss, not a hard white frame
    }
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
    const fadeAlpha = shatterFadeAlpha(t);
    // Slight whole-shard shrink as they fade — eases the dissolve.
    const scale = lerp(1, 0.92, 1 - fadeAlpha);

    for (const f of this.fragments.active) {
      ctx.save();
      ctx.globalAlpha = fadeAlpha;
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.scale(scale, scale);
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
      ctx.fillStyle = '#e8f4ff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.restore();
  }
}
