// Range v2 forest placement (plan §3.4 forest row, Task 10). Pure and
// engine-agnostic: which trees stand where, as stable instances attached
// to the terrain surface. ForestGL.js turns the result into GPU instances.
//
// Stability: trees sit on a fixed metric lattice (LATTICE_M cells in local
// X/Z), one candidate per cell, jittered and sized by a hash of the cell
// itself. The same cell always yields the same tree, whatever the quality,
// camera position or seek time. Reducing density drops a stable subset
// (by each tree's own hash); it never regenerates the forest.
//
// Eligibility follows the same terrain rules the terrain shader uses for
// forest (material rules: treeline, max forest slope, density; no trees on
// hydro-flattened water or above the treeline), evaluated from the
// package's own heights. These are derived habitat masks, not measured
// land cover.
import { terrainHeightAt } from './TerrainMesh.js';
import { cameraPoseAt } from '../terrain/SceneTravel.js';

export const LATTICE_M = 13;
export const FOREST_RINGS = Object.freeze({ meshM: 1200, billboardM: 8000 });

/** Deterministic 32-bit hash of two integers and a salt. */
export function hash2(ix, iz, salt = 0) {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
const u01 = (h) => h / 4294967296;

/** Fraction of trees kept at a PerfGovernor rung (stable subset). */
export function forestKeepFraction(quality = 0) {
  return [1, 1, 0.85, 0.7, 0.55, 0.4, 0.3][Math.max(0, Math.min(6, quality | 0))];
}

/** Terrain slope in degrees at (x, z) from central differences. */
function slopeDegAt(data, x, z, d) {
  const hx0 = terrainHeightAt(data, x - d, z), hx1 = terrainHeightAt(data, x + d, z);
  const hz0 = terrainHeightAt(data, x, z - d), hz1 = terrainHeightAt(data, x, z + d);
  if (![hx0, hx1, hz0, hz1].every(Number.isFinite)) return NaN;
  const gx = (hx1 - hx0) / (2 * d), gz = (hz1 - hz0) / (2 * d);
  return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
}

/** Whether the package marks (x, z) as hydro-flattened water: true when
 *  any of the four samples around the point is water, because the terrain
 *  shader reads the flow byte bilinearly (a root between a water sample and
 *  a shore sample would stand in the water's fringe). */
function isWater(data, x, z) {
  const { grid, cells } = data;
  const gx = (x - grid.originM[0]) / grid.cellSizeM, gz = (z - grid.originM[1]) / grid.cellSizeM;
  const tile = data.byIndex.get(`${Math.floor(gx / cells)},${Math.floor(gz / cells)}`);
  if (!tile) return false;
  const fu = (gx - tile.ix * cells) / tile.stride, fv = (gz - tile.iz * cells) / tile.stride;
  const last = tile.samples - 1;
  for (const v of [Math.floor(fv), Math.ceil(fv)]) {
    for (const u of [Math.floor(fu), Math.ceil(fu)]) {
      if (tile.flowBytes[Math.min(last, v) * tile.samples + Math.min(last, u)] === 255) return true;
    }
  }
  return false;
}

/** Closest distance from (x, y, z) to the rail's eye segment. */
function railDistance(a, b, p) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  let t = len2 > 0 ? ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t);
}

/**
 * Place the view's trees.
 *   data    decoded terrain (TerrainMesh.decodeTerrain)
 *   view    SceneView (camera rail)
 *   rules   material rules (+ view overrides)
 *   options { seed, rings, bands: { nearM, midM } }
 * Returns { mesh: Float32Array, billboard: Float32Array, stride, count }.
 * Each instance: x, yRoot, z, height, width, variant, id01, bandIndex
 * (0 far, 1 mid, 2 near -- the terrain band that owns its root).
 */
export function placeForest(data, view, rules, options = {}) {
  const steps = placeForestSteps(data, view, rules, options);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** placeForest that yields to the event loop every `sliceMs` of work, so a
 *  view prepared during playback never blocks a frame for long. Same
 *  result as placeForest. */
export async function placeForestAsync(data, view, rules, { sliceMs = 8, yieldTo = defaultYield, signal = null, ...options } = {}) {
  const steps = placeForestSteps(data, view, rules, options);
  let t0 = performance.now();
  let r = steps.next();
  while (!r.done) {
    if (performance.now() - t0 > sliceMs) {
      await yieldTo();
      if (signal?.aborted) throw new Error('aborted');
      t0 = performance.now();
    }
    r = steps.next();
  }
  return r.value;
}

function defaultYield() {
  return new Promise((res) => (globalThis.scheduler?.yield ? globalThis.scheduler.yield().then(res) : setTimeout(res, 0)));
}

/** The placement, one tile per step (a generator returning the result). */
function* placeForestSteps(data, view, rules, { seed = 0, rings = FOREST_RINGS, bands = null } = {}) {
  const STRIDE = 8;
  const eyeA = cameraPoseAt(view, 0).eyeM, eyeB = cameraPoseAt(view, 1).eyeM;
  const b = bands || data.manifest.bands || { nearM: 1800, midM: 7000 };
  const treeline = rules.treelineM, maxSlope = rules.forestMaxSlopeDeg, density = rules.forestDensity;
  // Typed chunks, not growing JS arrays: a 300k-tree view would otherwise
  // reallocate and copy millions of elements in single long pauses.
  const mesh = new FloatChunks(), board = new FloatChunks();
  const cells = data.cells, cs = data.grid.cellSizeM;
  for (const tile of data.tiles.values()) {
    if (!tile.visible || tile.minY > treeline + 300) continue;
    const x0 = data.grid.originM[0] + tile.ix * cells * cs, z0 = data.grid.originM[1] + tile.iz * cells * cs;
    const x1 = x0 + cells * cs, z1 = z0 + cells * cs;
    // Tile-level ring cull before visiting its lattice cells.
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const tileDist = railDistance(eyeA, eyeB, [cx, (tile.minY + tile.maxY) / 2, cz]) - Math.hypot(x1 - x0, z1 - z0) / 2;
    if (tileDist > rings.billboardM) continue;
    for (let iz = Math.ceil(z0 / LATTICE_M); iz * LATTICE_M < z1; iz++) {
      for (let ix = Math.ceil(x0 / LATTICE_M); ix * LATTICE_M < x1; ix++) {
        const h0 = hash2(ix, iz, seed);
        if (u01(h0) > density) continue;
        const h1 = hash2(ix, iz, seed + 1), h2 = hash2(ix, iz, seed + 2), h3 = hash2(ix, iz, seed + 3);
        const x = (ix + 0.15 + 0.7 * u01(h1)) * LATTICE_M, z = (iz + 0.15 + 0.7 * u01(h2)) * LATTICE_M;
        const y = terrainHeightAt(data, x, z);
        if (!Number.isFinite(y)) continue;
        // Treeline with a stand-scale breakup, as the shader does.
        const edge = treeline + (u01(hash2(Math.floor(x / 90), Math.floor(z / 90), seed + 9)) - 0.5) * 220;
        if (y > edge) continue;
        const slope = slopeDegAt(data, x, z, cs);
        if (!(slope <= maxSlope + (u01(h3) - 0.5) * 6)) continue;
        if (isWater(data, x, z)) continue;
        const d = railDistance(eyeA, eyeB, [x, y, z]);
        if (d > rings.billboardM) continue;
        // Height tapers toward the treeline and on steep ground.
        const vigor = Math.min(1, Math.max(0.35, (edge - y) / 400)) * (1 - 0.3 * Math.max(0, slope - 25) / 25);
        const height = (18 + 30 * u01(h3)) * vigor;
        const width = height * (0.42 + 0.16 * u01(h1 ^ h2));
        const band = d < b.nearM ? 2 : d < b.midM ? 1 : 0;
        const rec = [x, y, z, height, width, (h2 >>> 8) % 4, u01(hash2(ix, iz, seed + 4)), band];
        (d < rings.meshM ? mesh : board).push(...rec);
      }
      // One lattice row per step: a 64-cell tile holds ~100 rows of ~100
      // candidates, so a whole tile between yields could run for 100 ms.
      yield;
    }
  }
  return { mesh: mesh.toArray(), billboard: board.toArray(), stride: STRIDE, count: (mesh.length + board.length) / STRIDE };
}

/** Append-only float storage in fixed typed chunks. */
class FloatChunks {
  constructor(size = 1 << 16) { this.size = size; this.chunks = [new Float32Array(size)]; this.fill = 0; this.length = 0; }
  push(...values) {
    for (const v of values) {
      if (this.fill === this.size) { this.chunks.push(new Float32Array(this.size)); this.fill = 0; }
      this.chunks[this.chunks.length - 1][this.fill++] = v;
      this.length++;
    }
  }
  toArray() {
    const out = new Float32Array(this.length);
    let at = 0;
    for (const c of this.chunks) {
      const n = Math.min(c.length, this.length - at);
      out.set(n === c.length ? c : c.subarray(0, n), at);
      at += n;
    }
    return out;
  }
}

/** Indices (into an instance array) kept at a quality rung: a stable
 *  subset by each tree's own id hash (column 6). */
export function keptInstances(instances, stride, quality) {
  const keep = forestKeepFraction(quality);
  const out = [];
  for (let i = 0; i < instances.length / stride; i++) if (instances[i * stride + 6] < keep) out.push(i);
  return out;
}
