// The third equalizer: a crystalline/orbital node-and-segment line high in
// the deep sky — deliberately MASSIVE but far back in the cosmos (megalophobia:
// something too large to be nearby). Unlike the horizon EQ's soft aurora and
// GeoCrest's terrain-pinned geology: stepped segments, treble-weighted band
// reads, fast envelopes. Pure math + draw().
import { mulberry32, clamp01 } from '../utils/math.js';
import { capFlashAlpha } from '../ui/Accessibility.js';

// +1 joint past each edge vs the old 24-on-screen packing (26 total).
export const N_NODES = 26;
const ATTACK_SEC = 0.05;
const RELEASE_SEC = 0.25;
const FLASH_JUMP_THRESHOLD = 0.35;
const FLASH_LIFE_MS = 300;
// Deep sky baseline — below the celestial band so it doesn't pin the top edge.
const BASELINE_FRAC = 0.19;
// Vertical throw: large but not half the frame (was 0.44 — too tall/high).
const MAX_H_FRAC = 0.22;
// Extra span past each screen edge (in units of one joint spacing).
const EDGE_JOINTS = 1;
// Glacial parallax — far cosmos barely tracks the world scroll.
const PARALLAX = 0.011;

// Icosahedron: 12 vertices, 30 edges. Precomputed once (module scope).
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_RAW = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];
const ICO_NORM = Math.hypot(1, PHI, 0);
export const ICO_VERTS = ICO_RAW.map(([x, y, z]) => [x / ICO_NORM, y / ICO_NORM, z / ICO_NORM]);
export const ICO_EDGES = (() => {
  const edges = [];
  for (let i = 0; i < ICO_VERTS.length; i++) {
    for (let j = i + 1; j < ICO_VERTS.length; j++) {
      const [ax, ay, az] = ICO_VERTS[i], [bx, by, bz] = ICO_VERTS[j];
      const d = Math.hypot(ax - bx, ay - by, az - bz);
      if (d < 1.06) edges.push([i, j]); // nearest-neighbor edge length ~1.05
    }
  }
  return edges;
})();

/** Rotate every vertex by (rotX, rotY) and orthographically project to 2D,
 *  scaled by `scale`. Pure; returns {points:[{x,y}], edges} for the caller
 *  to stroke. */
export function projectWireframe(verts, edges, rotX, rotY, scale) {
  const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
  const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
  const points = verts.map(([x, y, z]) => {
    // Rotate around X, then Y.
    const y1 = y * cosX - z * sinX;
    const z1 = y * sinX + z * cosX;
    const x2 = x * cosY + z1 * sinY;
    const z2 = -x * sinY + z1 * cosY;
    void z2;
    return { x: x2 * scale, y: y1 * scale };
  });
  return { points, edges };
}

/** xFrac span: one joint past left and right of [0,1]. */
export function nodeXFrac(i, n = N_NODES, edgeJoints = EDGE_JOINTS) {
  const denom = Math.max(1, n - 1 - 2 * edgeJoints);
  // i=0 → -edgeJoints/denom units left of 0; i=n-1 → past 1 on the right.
  return (i - edgeJoints) / denom;
}

export class SpaceRidge {
  constructor(seed) {
    const rand = mulberry32((seed ^ 0x2b1e) >>> 0 || 1);
    this.nodes = [];
    for (let i = 0; i < N_NODES; i++) {
      const xFrac = nodeXFrac(i) + (rand() - 0.5) * 0.012;
      // Treble-weighted band pick: bands 4-6 get ~65% of nodes, 0-1 ~10%.
      const r = rand();
      let band;
      if (r < 0.10) band = rand() < 0.5 ? 0 : 1;
      else if (r < 0.35) band = 2 + Math.floor(rand() * 2); // 2-3
      else band = 4 + Math.floor(rand() * 3); // 4-6
      this.nodes.push({ xFrac, band, phase: rand() * Math.PI * 2, level: 0 });
    }
    this._flashes = [];
    this._rotX = 0;
    this._rotY = 0;
  }

  update(nowMs, dtSec, eqBands) {
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const raw = clamp01(eqBands ? (eqBands[n.band] ?? 0) : 0);
      const target = Math.pow(raw, 1.4);
      const tau = target > n.level ? ATTACK_SEC : RELEASE_SEC;
      const prev = n.level;
      n.level += (1 - Math.exp(-dtSec / tau)) * (target - n.level);
      if (n.level - prev > FLASH_JUMP_THRESHOLD) this._flashes.push({ i, atMs: nowMs });
    }
    this._flashes = this._flashes.filter((f) => nowMs - f.atMs < FLASH_LIFE_MS);
    this._rotX = nowMs * 0.001 * 0.04;
    this._rotY = nowMs * 0.001 * 0.027;
  }

  /** Screen-space samples for the ridge polyline (no wrap — extends past edges). */
  _samples(canvas, worldX, tSec) {
    const sx = worldX * PARALLAX;
    const y0 = canvas.height * BASELINE_FRAC;
    const maxH = canvas.height * MAX_H_FRAC;
    const pts = this.nodes.map((n, i) => {
      // Far structure: slight perspective scale (edges recede a hair).
      const x = n.xFrac * canvas.width - sx;
      const edgeFade = 1 - 0.12 * Math.min(1, Math.abs(n.xFrac - 0.5) * 1.6);
      const y = y0 - n.level * maxH * edgeFade
        + 3.5 * Math.sin(tSec * 0.45 + n.phase) * (0.5 + 0.5 * n.level);
      return { x, y, i, level: n.level };
    });
    // Stable left→right order (xFrac is already ordered; scroll doesn't reorder).
    return { pts, y0, maxH };
  }

  draw(ctx, canvas, worldX, color, tSec, reducedFlash = false) {
    const { pts, y0, maxH } = this._samples(canvas, worldX, tSec);

    const flashSet = new Map();
    const nowMs = tSec * 1000;
    for (const f of this._flashes) {
      const u = clamp01((nowMs - f.atMs) / FLASH_LIFE_MS);
      flashSet.set(f.i, 1 - u);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // One soft depth ghost only (two tall ghosts read as extra sky-high bands).
    const depthLayers = [
      { yScale: 1.2, yOff: -maxH * 0.06, alpha: 0.035, lw: 8 },
    ];
    for (const layer of depthLayers) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = capFlashAlpha(layer.alpha, reducedFlash);
      ctx.lineWidth = layer.lw;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const ly = y0 + (p.y - y0) * layer.yScale + layer.yOff;
        if (i === 0) ctx.moveTo(p.x, ly); else ctx.lineTo(p.x, ly);
      }
      ctx.stroke();
    }

    // Vast mirrored ghost above — inverted cosmos echo, not a hairline.
    ctx.strokeStyle = color;
    ctx.globalAlpha = capFlashAlpha(0.035, reducedFlash);
    ctx.lineWidth = 5;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const gy = (y0 - maxH * 0.85) - (p.y - y0) * 0.55;
      if (i === 0) ctx.moveTo(p.x, gy); else ctx.lineTo(p.x, gy);
    });
    ctx.stroke();

    // Main ridge: thick soft underglow + thinner bright core (distant power).
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const flash = Math.max(flashSet.get(a.i) || 0, flashSet.get(b.i) || 0);
      for (const [lw, base] of [[11, 0.055], [4.5, 0.11], [1.6, 0.28]]) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = capFlashAlpha(base + 0.35 * flash, reducedFlash);
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Node cores — larger, softer (star-stations on a structure too big).
    for (const p of pts) {
      const n = this.nodes[p.i];
      ctx.fillStyle = color;
      ctx.globalAlpha = capFlashAlpha(0.07, reducedFlash);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7 + 4 * n.level, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = capFlashAlpha(0.4 + 0.4 * n.level, reducedFlash);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tumbling polyhedron — same deep-sky band as the ridge, not the top bezel.
    const sx = worldX * PARALLAX;
    const cx = canvas.width * 0.16 - sx * 0.35;
    const cy = canvas.height * (BASELINE_FRAC - 0.04);
    const icoScale = Math.max(36, canvas.height * 0.055);
    const wf = projectWireframe(ICO_VERTS, ICO_EDGES, this._rotX, this._rotY, icoScale);
    ctx.strokeStyle = color;
    ctx.globalAlpha = capFlashAlpha(0.055, reducedFlash);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const [i, j] of wf.edges) {
      const a = wf.points[i], b = wf.points[j];
      ctx.moveTo(cx + a.x, cy + a.y);
      ctx.lineTo(cx + b.x, cy + b.y);
    }
    ctx.stroke();

    ctx.restore();
  }
}
