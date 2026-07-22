// The third equalizer: a crystalline/orbital node-and-segment line high in
// the sky, plus one slowly tumbling wireframe polyhedron -- the "space"
// geometry. Deliberately unlike the horizon EQ's smooth aurora (cosine
// interpolation, evenly-weighted bands, slow breathing) and GeoCrest's
// angular terrain-pinned geology: stepped/linear segments, treble-weighted
// band reads, its own fast envelopes. Pure math + draw(); state lives on
// the instance the way MeteorShowerFX/ConstellationWeaver do.
import { mulberry32, clamp01 } from '../utils/math.js';
import { capFlashAlpha } from '../ui/Accessibility.js';

const N_NODES = 24;
const ATTACK_SEC = 0.05;
const RELEASE_SEC = 0.25;
const FLASH_JUMP_THRESHOLD = 0.35;
const FLASH_LIFE_MS = 300;
const BASELINE_FRAC = 0.16;
const MAX_H = 70;

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

export class SpaceRidge {
  constructor(seed) {
    const rand = mulberry32((seed ^ 0x2b1e) >>> 0 || 1);
    this.nodes = [];
    for (let i = 0; i < N_NODES; i++) {
      const xFrac = (i + 0.5) / N_NODES + (rand() - 0.5) * 0.015;
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
    this._rotX = nowMs * 0.001 * 0.05;
    this._rotY = nowMs * 0.001 * 0.033;
  }

  draw(ctx, canvas, worldX, color, tSec, reducedFlash = false) {
    const sx = worldX * 0.04;
    const y0 = canvas.height * BASELINE_FRAC;
    const pts = this.nodes.map((n, i) => {
      const wrapFrac = (((n.xFrac - sx / canvas.width) % 1) + 1) % 1;
      const x = wrapFrac * canvas.width;
      const y = y0 - n.level * MAX_H + 2 * Math.sin(tSec * 0.7 + n.phase);
      return { x, y, i };
    }).sort((a, b) => a.x - b.x);

    const flashSet = new Map();
    const nowMs = tSec * 1000;
    for (const f of this._flashes) {
      const u = clamp01((nowMs - f.atMs) / FLASH_LIFE_MS);
      flashSet.set(f.i, 1 - u);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Dim mirrored ghost above -- the "space" tell.
    ctx.strokeStyle = color;
    ctx.globalAlpha = capFlashAlpha(0.05, reducedFlash);
    ctx.lineWidth = 1;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const gy = (y0 - MAX_H * 1.25) - (p.y - y0);
      if (i === 0) ctx.moveTo(p.x, gy); else ctx.lineTo(p.x, gy);
    });
    ctx.stroke();

    // Connecting segments: straight, stepped -- never smoothed.
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const flash = Math.max(flashSet.get(a.i) || 0, flashSet.get(b.i) || 0);
      for (const [lw, base] of [[3, 0.08], [1, 0.30]]) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = capFlashAlpha(base + 0.5 * flash, reducedFlash);
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Node dots.
    for (const p of pts) {
      const n = this.nodes[p.i];
      ctx.fillStyle = color;
      ctx.globalAlpha = capFlashAlpha(0.10, reducedFlash);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = capFlashAlpha(0.55 + 0.35 * n.level, reducedFlash);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // One slowly tumbling wireframe polyhedron, floating in the sky.
    const cx = canvas.width * 0.18 - sx * 0.5, cy = canvas.height * 0.10;
    const wf = projectWireframe(ICO_VERTS, ICO_EDGES, this._rotX, this._rotY, 26);
    ctx.strokeStyle = color;
    ctx.globalAlpha = capFlashAlpha(0.08, reducedFlash);
    ctx.lineWidth = 1;
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
