// Range v2 rock stage (plan §6.2 fixed-ground row, Task 11): the ground the
// cast stands on, as layered slate slabs with broken edges, moss in the
// cracks and shallow pools -- built every frame on the RENDERED support
// curve (GroundField.visibleBars, ripple/groove/quake included) so contact
// never drifts, while physics keeps its own heightAt(). Pure geometry in
// fixed-ground logical coordinates; RockStageGL draws it.
//
// Stage space. Each column x has the support height S(x) (screen y of the
// curve) and the frame bottom B. Depth d runs 0 at the support line (where
// the cast stands) to 1 below the bottom edge. The stage is a stack of
// slabs toward the camera: slab k's top face spans d in [e_k, e_k+1) and is
// separated from the next by a riser -- a front face whose screen height
// is its drop. Slab edges wander with WORLD x (wx = x + worldX - originX),
// so the rock travels with the ground the cast walks on, not with the
// screen. The first top face always starts exactly on S(x): the contact
// line is the support curve itself.
//
// Pools sit on slab tops as flat water. A water surface is level, so a pool
// is only shown where the support curve is level across its whole width
// (interior samples, not just its endpoints); on a hump it fades out rather
// than climbing it. Wet masks are the exact pool polygons.
import { hash2 } from './ForestCover.js';

const u01 = (h) => h / 4294967296;
export const STAGE_SLABS = 4;
export const COLUMN_PX = 8;
export const POOL_FLAT_PX = 2.5;

/** Smooth value noise on the world-x axis, deterministic in (wx, salt). */
export function noise1(wx, scale, salt) {
  const f = wx / scale;
  const i = Math.floor(f), t = f - i;
  const a = u01(hash2(i, salt, 91)), b = u01(hash2(i + 1, salt, 91));
  const s = t * t * (3 - 2 * t);
  return a + (b - a) * s;
}

/** The rendered support curve from visibleBars, sampled at `x`: bar tops
 *  joined at their centres, clamped at the ends (the legacy ground path's
 *  own vertices). */
export function supportAt(bars, x) {
  if (!bars.length) return NaN;
  const cx = (b) => b.x + b.width / 2;
  if (x <= cx(bars[0])) return bars[0].y;
  const last = bars[bars.length - 1];
  if (x >= cx(last)) return last.y;
  let lo = 0, hi = bars.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cx(bars[mid]) <= x) lo = mid; else hi = mid;
  }
  const a = bars[lo], b = bars[hi];
  const t = (x - cx(a)) / Math.max(1e-6, cx(b) - cx(a));
  return a.y + (b.y - a.y) * t;
}

/** Depth fractions of the slab edges at world x (first is always 0). */
export function slabEdges(wx, seed) {
  const edges = [0];
  let at = 0;
  for (let k = 1; k < STAGE_SLABS; k++) {
    const span = 0.16 + 0.22 * noise1(wx, 170 + 40 * k, seed + k * 13);
    // Broken edges: a fine wander on top of the slab-scale one.
    const jag = (noise1(wx, 23, seed + k * 7) - 0.5) * 0.05;
    at = Math.min(0.95, at + span + jag);
    edges.push(at);
  }
  return edges;
}

/** Riser height (px) in front of slab k at world x. */
function riserPx(wx, k, seed) {
  return 7 + 16 * noise1(wx, 90 + 25 * k, seed + 31 * k);
}

/**
 * Build the stage for one frame.
 *   bars      RangeFrame.groundBars (rendered support)
 *   width, height   fixed-ground logical stage size
 *   worldX, originX pose values (world anchoring)
 *   seed      song/view seed
 * Returns { positions, normals, surfaces, uv, indices, pools, wetMasks, contactY(x) }
 * positions: Float32 [x, y, depth01] per vertex (logical px; depth for the
 *   z-buffer), normals: stage-space [nx, ny, nz] (y up, z toward camera),
 *   surfaces: 0 top face, 1 riser, uv: world-anchored material coords (px).
 */
export function buildRockStage({ bars, width, height, worldX = 0, originX = 0, seed = 0, overscan = 48 }) {
  const cols = Math.ceil((width + 2 * overscan) / COLUMN_PX) + 1;
  const bottom = height + overscan;
  const pos = [], nor = [], srf = [], uv = [], idx = [];
  let v = 0;
  const colX = (c) => -overscan + c * COLUMN_PX;
  // Per column: screen y of every face boundary, top to bottom.
  const layout = [];
  for (let c = 0; c < cols; c++) {
    const x = colX(c);
    const wx = x + worldX - originX;
    const S = supportAt(bars, x);
    const edges = slabEdges(wx, seed);
    const span = Math.max(8, bottom - S);
    const rows = [];
    let drop = 0;
    for (let k = 0; k < STAGE_SLABS; k++) {
      const top0 = S + edges[k] * span + drop;
      const next = k + 1 < STAGE_SLABS ? edges[k + 1] : 1.05;
      const top1 = S + next * span + drop;
      rows.push({ kind: 0, y0: top0, y1: top1, d0: edges[k], d1: next, k });
      if (k + 1 < STAGE_SLABS) {
        const r = riserPx(wx, k, seed);
        rows.push({ kind: 1, y0: top1, y1: top1 + r, d0: next, d1: next, k });
        drop += r;
      }
    }
    layout.push({ x, wx, S, rows });
  }
  // Emit faces as quads between neighbouring columns (same row index).
  for (let c = 0; c + 1 < cols; c++) {
    const L = layout[c], R = layout[c + 1];
    for (let r = 0; r < L.rows.length; r++) {
      const a = L.rows[r], b = R.rows[r];
      const riser = a.kind === 1;
      // Normals: tops face up with a tilt from the local slope of the
      // support; risers face the camera, leaning with their edge.
      const slope = (R.S - L.S) / COLUMN_PX;
      const n = riser ? [-(b.y0 - a.y0) / COLUMN_PX * 0.3, 0.15, 1] : [-slope * 0.6, 1, 0.12];
      const len = Math.hypot(n[0], n[1], n[2]);
      const nn = [n[0] / len, n[1] / len, n[2] / len];
      const quad = [[L.x, a.y0, a.d0, L.wx, 0], [R.x, b.y0, b.d0, R.wx, 0], [R.x, b.y1, b.d1, R.wx, 1], [L.x, a.y1, a.d1, L.wx, 1]];
      for (const [x, y, d, wx, t] of quad) {
        pos.push(x, y, riser ? d + 0.001 : d);
        nor.push(...nn);
        srf.push(riser ? 1 : 0);
        // Material coordinates in px: world x along, face-local down.
        uv.push(wx, riser ? a.y0 + t * (a.y1 - a.y0) - L.S : (a.d0 + t * (a.d1 - a.d0)) * 400 + a.k * 173);
      }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
  }
  // Pools: world-anchored candidates on slab tops 1..2 (never the contact
  // slab), kept only where the support is level across the pool.
  const pools = [];
  const wx0 = -overscan + worldX - originX, wx1 = width + overscan + worldX - originX;
  const cell = 260;
  for (let i = Math.floor(wx0 / cell); i * cell < wx1; i++) {
    const h = hash2(i, seed, 404);
    if (u01(h) > 0.45) continue;
    const pw = 60 + 110 * u01(hash2(i, seed, 405));
    const pcx = i * cell + 40 + (cell - 80 - pw) * u01(hash2(i, seed, 406)) + pw / 2;
    const slab = 1 + (hash2(i, seed, 407) % 2);
    const xL = pcx - pw / 2 - (worldX - originX), xR = pcx + pw / 2 - (worldX - originX);
    // Level test over interior samples, not only the endpoints.
    let lo = Infinity, hi = -Infinity;
    for (let s = 0; s <= 12; s++) {
      const y = supportAt(bars, xL + (xR - xL) * s / 12);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    const unevenness = hi - lo;
    const alpha = Math.max(0, Math.min(1, (POOL_FLAT_PX * 2 - unevenness) / POOL_FLAT_PX));
    if (alpha <= 0) continue;
    // The pool polygon: a rounded lens on the slab top, level at the
    // slab's front-edge line (the water surface is flat in screen y).
    const pts = [];
    const topAt = (x) => {
      const col = layout[Math.max(0, Math.min(cols - 1, Math.round((x + overscan) / COLUMN_PX)))];
      const row = col.rows[slab * 2];
      return { y0: row.y0, y1: row.y1 };
    };
    const mid = topAt((xL + xR) / 2);
    const waterY = mid.y0 + (mid.y1 - mid.y0) * 0.45;
    const depthPx = Math.max(3, (mid.y1 - mid.y0) * 0.38);
    for (let s = 0; s <= 16; s++) {
      const a = (s / 16) * Math.PI * 2;
      const wob = 1 + 0.12 * Math.sin(a * 3 + i) + 0.08 * Math.sin(a * 5 + 2 * i);
      pts.push({ x: (xL + xR) / 2 + Math.cos(a) * (pw / 2) * wob, y: waterY + Math.sin(a) * depthPx * wob });
    }
    pools.push({ id: `pool:${seed}:${i}`, polygon: pts, waterY, alpha, slab, unevenness });
  }
  return {
    positions: Float32Array.from(pos), normals: Float32Array.from(nor), surfaces: Float32Array.from(srf),
    uv: Float32Array.from(uv), indices: Uint32Array.from(idx),
    pools, wetMasks: pools.map((p) => ({ id: p.id, polygon: p.polygon, alpha: p.alpha })),
    contactY: (x) => supportAt(bars, x),
    vertexCount: v,
  };
}

/** Even-odd point-in-polygon test (exact wet-mask membership). */
export function insidePolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
