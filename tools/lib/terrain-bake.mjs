// Range v2 terrain baker (plan §3.3, Task 3). Turns one normalized DemGrid
// into a compact, validated, multiresolution heightfield package for one
// curated view:
//
//   <view>.terrain.json     manifest (schema midio.terrain v1)
//   <view>.terrain.bin.gz   gzip payload of every tile's samples
//
// Format choice. The plan's default is explicit Float32 position/normal/UV
// buffers. For a real 10-20 m corridor that is ~20-30 bytes per vertex and
// several hundred thousand vertices per view -- far past the agreed 60 MB
// runtime budget across 12-18 views. Every surface here is a regular
// heightfield, so the package stores each tile's height samples (Uint16,
// one global quantization) at the tile's baked stride; positions, UVs and
// indices are regular functions of (tile, sample) and are constructed at
// load by src/world/alpine/TerrainMesh.js after the same validation. The
// manifest still declares every byte range, count, type and SHA-256.
//
// Detail levels. Tiles are TILE_CELLS cells square. For each tile and each
// power-of-two stride the baker measures the true maximum vertical
// deviation of that stride's triangulation from the full-resolution
// samples. The camera rail is known, so each tile's closest visible
// approach is known too: the baked stride is the coarsest whose deviation
// projects to <= the desktop pixel budget there. Coarser strides' errors
// are kept so the runtime can drop to the mobile budget without re-baking.
// All strides are subsets of one sample lattice, so levels share
// geographic identity; the runtime snaps a finer tile's edge to its
// coarser neighbour's edge so mixed levels meet without cracks.
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { cameraPoseAt, boxMayBeVisible, distanceToBox, focalPx, cameraRailErrors } from '../../src/world/terrain/SceneTravel.js';

import { TERRAIN_SCHEMA, TERRAIN_VERSION, STRIDES, WATER_FLOW } from '../../src/world/alpine/TerrainPackage.js';

export { TERRAIN_SCHEMA, TERRAIN_VERSION, STRIDES, WATER_FLOW };
export { validateTerrainManifest, decodeResiduals } from '../../src/world/alpine/TerrainPackage.js';
export const TILE_CELLS = 64;
export const LOD_BUDGETS = Object.freeze({
  desktop: { errorPx: 1, heightPx: 1080 },
  mobile: { errorPx: 2, heightPx: 720 },
});
// Frustum widening used for visibility: the widest supported framing
// (2.4:1), the deepest camera pull-back (1 / ZOOM_MIN = 1.52) and the shake
// overscan margin together. Conservative on purpose: a tile culled here is
// never baked finely, so under-estimating would show coarse terrain.
export const VISIBILITY = Object.freeze({ aspect: 2.4, fovScale: 1.85, stations: 21, minDistanceM: 40 });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Validate a DemGrid before baking. Returns { ok, errors }. */
export function validateDemGrid(grid) {
  const errors = [];
  if (!grid || typeof grid !== 'object') return { ok: false, errors: ['grid missing'] };
  const { width, height, cellSizeM } = grid;
  if (!(Number.isInteger(width) && width >= 2 && Number.isInteger(height) && height >= 2)) errors.push('bad dimensions');
  if (!(cellSizeM > 0)) errors.push('bad cell size');
  if (!(grid.heightsM instanceof Float32Array) || grid.heightsM.length !== width * height) errors.push('heights length');
  if (!(grid.valid instanceof Uint8Array) || grid.valid.length !== width * height) errors.push('validity length');
  if (!Array.isArray(grid.originM) || grid.originM.length !== 2 || !grid.originM.every(Number.isFinite)) errors.push('origin');
  if (!errors.length) {
    for (let i = 0; i < grid.heightsM.length; i++) {
      if (grid.valid[i] && !Number.isFinite(grid.heightsM[i])) { errors.push(`valid cell ${i} not finite`); break; }
    }
  }
  if (grid.upsampled) errors.push('grid is upsampled beyond its source resolution');
  return { ok: !errors.length, errors };
}

// ---------------------------------------------------------------------------
// Hydrology: depression-filled D8 flow accumulation and a water mask from
// hydro-flattened surfaces. Derived fields, not measured land cover.

/** Priority-flood depression filling (Barnes et al. 2014) with an epsilon
 *  gradient so flats drain. Returns filled heights (Float64Array). */
export function fillDepressions(h, valid, w, hgt, eps = 1e-3) {
  const n = w * hgt;
  const out = new Float64Array(n);
  const done = new Uint8Array(n);
  // Binary heap of [height, index].
  const heapH = new Float64Array(n);
  const heapI = new Int32Array(n);
  let size = 0;
  const push = (hh, i) => {
    let k = size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapH[p] <= hh) break;
      heapH[k] = heapH[p]; heapI[k] = heapI[p]; k = p;
    }
    heapH[k] = hh; heapI[k] = i;
  };
  const pop = () => {
    const topI = heapI[0];
    const lastH = heapH[--size], lastI = heapI[size];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= size) break;
      if (c + 1 < size && heapH[c + 1] < heapH[c]) c++;
      if (heapH[c] >= lastH) break;
      heapH[k] = heapH[c]; heapI[k] = heapI[c]; k = c;
    }
    heapH[k] = lastH; heapI[k] = lastI;
    return topI;
  };
  for (let i = 0; i < n; i++) {
    const x = i % w, y = (i / w) | 0;
    const edge = x === 0 || y === 0 || x === w - 1 || y === hgt - 1;
    let nearHole = false;
    if (!edge && valid[i]) {
      for (let dy = -1; dy <= 1 && !nearHole; dy++) for (let dx = -1; dx <= 1; dx++) if (!valid[i + dy * w + dx]) { nearHole = true; break; }
    }
    if (valid[i] && (edge || nearHole)) { out[i] = h[i]; done[i] = 1; push(h[i], i); }
    if (!valid[i]) done[i] = 1;
  }
  while (size > 0) {
    const i = pop();
    const x = i % w, y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= hgt) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if ((!dx && !dy) || xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (done[j]) continue;
        done[j] = 1;
        out[j] = Math.max(h[j], out[i] + eps);
        push(out[j], j);
      }
    }
  }
  return out;
}

/** D8 flow accumulation (cells draining through each cell, itself
 *  included) over depression-filled heights. */
export function flowAccumulation(filled, valid, w, hgt) {
  const n = w * hgt;
  const order = new Int32Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) if (valid[i]) order[m++] = i;
  const idx = Array.from(order.subarray(0, m)).sort((a, b) => filled[b] - filled[a]);
  const acc = new Float64Array(n);
  for (const i of idx) acc[i] += 1;
  for (const i of idx) {
    const x = i % w, y = (i / w) | 0;
    let best = -1, drop = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= hgt) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if ((!dx && !dy) || xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (!valid[j]) continue;
        const d = (filled[i] - filled[j]) / (dx && dy ? Math.SQRT2 : 1);
        if (d > drop) { drop = d; best = j; }
      }
    }
    if (best >= 0) acc[best] += acc[i];
  }
  return acc;
}

/** Hydro-flattened water: connected cells whose 3x3 neighbourhood is flat
 *  to within `flatM`, in components of at least `minCells`. Bare-earth
 *  3DEP flattens lakes and wide rivers, so this reads the source's own
 *  water surfaces rather than guessing them. */
export function waterMask(h, valid, w, hgt, { flatM = 0.35, minCells = 60 } = {}) {
  const n = w * hgt;
  const flat = new Uint8Array(n);
  for (let y = 1; y < hgt - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!valid[i]) continue;
      let lo = Infinity, hi = -Infinity, ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = i + dy * w + dx;
        if (!valid[j]) { ok = false; break; }
        lo = Math.min(lo, h[j]); hi = Math.max(hi, h[j]);
      }
      if (ok && hi - lo <= flatM) flat[i] = 1;
    }
  }
  const out = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (!flat[s] || seen[s]) continue;
    let top = 0, count = 0;
    const members = [];
    stack[top++] = s; seen[s] = 1;
    while (top) {
      const i = stack[--top];
      members.push(i); count++;
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= hgt) continue;
        const j = yy * w + xx;
        if (flat[j] && !seen[j] && Math.abs(h[j] - h[i]) <= flatM) { seen[j] = 1; stack[top++] = j; }
      }
    }
    if (count >= minCells) for (const i of members) out[i] = 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Detail levels.

/** Height of the stride-`s` triangulation at local sample (u, v) inside a
 *  cell of that stride whose corners are a (0,0), b (s,0), c (0,s), d (s,s).
 *  Quads split along the a-d diagonal, as TerrainMesh does. */
export function triangulatedHeight(a, b, c, d, fu, fv) {
  return fu >= fv ? a + (b - a) * fu + (d - b) * fv : a + (d - c) * fu + (c - a) * fv;
}

/** Max |full - stride triangulation| over one tile. Cells with an invalid
 *  corner are skipped (they are not drawn); a cell that would bridge an
 *  invalid interior sample makes the stride ineligible (Infinity). */
export function tileStrideError(h, valid, w, hgt, x0, y0, cells, stride) {
  if (stride === 1) return 0;
  let err = 0;
  for (let cy = 0; cy < cells; cy += stride) {
    for (let cx = 0; cx < cells; cx += stride) {
      const X = x0 + cx, Y = y0 + cy;
      if (X + stride >= w || Y + stride >= hgt) continue;
      const ia = Y * w + X, ib = ia + stride, ic = ia + stride * w, id = ic + stride;
      if (!(valid[ia] && valid[ib] && valid[ic] && valid[id])) continue;
      const a = h[ia], b = h[ib], c = h[ic], d = h[id];
      for (let v = 0; v <= stride; v++) {
        for (let u = 0; u <= stride; u++) {
          const j = (Y + v) * w + X + u;
          // A coarse cell with valid corners would draw over no-data inside
          // it: that stride cannot represent this tile.
          if (!valid[j]) return Infinity;
          const e = Math.abs(h[j] - triangulatedHeight(a, b, c, d, u / stride, v / stride));
          if (e > err) err = e;
        }
      }
    }
  }
  return err;
}

function railStations(view, count) {
  return Array.from({ length: count }, (_, k) => cameraPoseAt(view, count > 1 ? k / (count - 1) : 0));
}

/** Byte-plane split of Uint16 values (low bytes, then high bytes): gzip
 *  compresses small residuals far better this way. */
function splitPlanes(u16) {
  const out = new Uint8Array(u16.length * 2);
  for (let i = 0; i < u16.length; i++) { out[i] = u16[i] & 0xff; out[u16.length + i] = u16[i] >>> 8; }
  return out;
}

/** Planar predictor residuals (left + up - upleft), modulo 2^16. */
export function encodeResiduals(q, n) {
  const r = new Uint16Array(q.length);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const left = x ? q[i - 1] : (y ? q[i - n] : 0);
      const up = y ? q[i - n] : left;
      const ul = x && y ? q[i - n - 1] : (y ? q[i - n] : left);
      const pred = x && y ? Math.min(65535, Math.max(0, left + up - ul)) : (x ? left : up);
      r[i] = (q[i] - pred) & 0xffff;
    }
  }
  return r;
}

/**
 * Bake one view's terrain package.
 *   grid     DemGrid (tools/lib/terrain-source.mjs)
 *   view     SceneView (camera rail, bands, id)
 *   options  { tileCells, budgets, visibility, dataUrl, quantStepM, landmarks }
 * Returns { manifest, payload (gzip Buffer), decoded (Buffer), stats }.
 */
export async function bakeTerrain(grid, view, options = {}) {
  const check = validateDemGrid(grid);
  if (!check.ok) throw new Error(`DEM rejected: ${check.errors.join('; ')}`);
  const railErrors = cameraRailErrors(view?.camera);
  if (railErrors.length) throw new Error(`view ${view?.id}: ${railErrors.join('; ')}`);
  const cells = options.tileCells || TILE_CELLS;
  const budgets = options.budgets || LOD_BUDGETS;
  const vis = { ...VISIBILITY, ...(options.visibility || {}) };
  const bands = { nearM: 1800, midM: 7000, ...(view.bands || {}), ...(options.bands || {}) };
  const { width: w, height: hgt, cellSizeM: cell, originM } = grid;
  const h = grid.heightsM, valid = grid.valid;

  // Global quantization: shared samples quantize identically in every tile.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < h.length; i++) if (valid[i]) { lo = Math.min(lo, h[i]); hi = Math.max(hi, h[i]); }
  const stepM = options.quantStepM || Math.max(0.05, Math.ceil(((hi - lo + 2) / 65000) * 100) / 100);
  const offsetM = Math.floor(lo) - 1;
  const quant = (v) => Math.max(1, Math.min(65535, Math.round((v - offsetM) / stepM)));

  // Hydrology on the whole grid (tile-independent, so seams agree).
  const filled = fillDepressions(h, valid, w, hgt);
  const acc = flowAccumulation(filled, valid, w, hgt);
  const water = waterMask(h, valid, w, hgt, options.water);
  const flowByte = (i) => (water[i] ? WATER_FLOW : Math.min(254, Math.round(Math.log2(Math.max(1, acc[i])) * 16)));

  const tilesX = Math.ceil((w - 1) / cells), tilesZ = Math.ceil((hgt - 1) / cells);
  const stations = railStations(view, vis.stations);
  const focal = Object.fromEntries(Object.entries(budgets).map(([k, b]) => [k, focalPx(view.camera.fovYDeg, b.heightPx)]));
  const tiles = [];
  const chunks = [];
  let byteOffset = 0;
  const pushChunk = (buf) => { const at = byteOffset; chunks.push(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)); byteOffset += buf.byteLength; return at; };
  const achieved = Object.fromEntries(Object.keys(budgets).map((k) => [k, 0]));
  let bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };

  for (let iz = 0; iz < tilesZ; iz++) {
    for (let ix = 0; ix < tilesX; ix++) {
      const x0 = ix * cells, y0 = iz * cells;
      let minY = Infinity, maxY = -Infinity, validCount = 0;
      for (let v = 0; v <= cells; v++) for (let u = 0; u <= cells; u++) {
        const X = x0 + u, Y = y0 + v;
        if (X >= w || Y >= hgt) continue;
        const i = Y * w + X;
        if (!valid[i]) continue;
        validCount++;
        minY = Math.min(minY, h[i]); maxY = Math.max(maxY, h[i]);
      }
      if (!validCount) continue;
      const box = {
        min: [originM[0] + x0 * cell, minY, originM[1] + y0 * cell],
        max: [originM[0] + (x0 + cells) * cell, maxY, originM[1] + (y0 + cells) * cell],
      };
      let dmin = Infinity;
      for (const pose of stations) {
        if (!boxMayBeVisible(pose, vis.aspect, box, vis.fovScale)) continue;
        dmin = Math.min(dmin, distanceToBox(pose.eyeM, box));
      }
      const visible = Number.isFinite(dmin);
      const dist = Math.max(vis.minDistanceM, visible ? dmin : Infinity);
      const errorsM = {};
      for (const s of STRIDES) if (s <= cells) errorsM[s] = tileStrideError(h, valid, w, hgt, x0, y0, cells, s);
      const pick = (budget) => {
        if (!visible) return cells;
        let best = 1;
        for (const s of STRIDES) {
          if (s > cells) break;
          if (errorsM[s] * focal[budget] / dist <= budgets[budget].errorPx) best = s;
        }
        return best;
      };
      const lod = Object.fromEntries(Object.keys(budgets).map((k) => [k, pick(k)]));
      const stride = Math.min(...Object.values(lod));
      for (const k of Object.keys(lod)) {
        if (visible) achieved[k] = Math.max(achieved[k], errorsM[lod[k]] * focal[k] / dist);
      }
      const n = cells / stride + 1;
      const q = new Uint16Array(n * n);
      const flow = new Uint8Array(n * n);
      const vbits = new Uint8Array(Math.ceil((n * n) / 8));
      let allValid = true;
      for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) {
        const X = x0 + u * stride, Y = y0 + v * stride;
        const k = v * n + u;
        const inside = X < w && Y < hgt;
        const i = Y * w + X;
        if (inside && valid[i]) {
          q[k] = quant(h[i]);
          flow[k] = flowByte(i);
          vbits[k >> 3] |= 1 << (k & 7);
        } else {
          allValid = false;
          // Carry the neighbour's value so the residual stream stays small;
          // the validity bit, not this value, decides what is drawn.
          q[k] = k ? q[k - 1] : quant(minY);
        }
      }
      const residual = splitPlanes(encodeResiduals(q, n));
      const hAt = pushChunk(residual);
      const fAt = pushChunk(flow);
      const tile = {
        id: `t${ix}_${iz}`, ix, iz, stride, samples: n,
        heights: { byteOffset: hAt, byteLength: residual.byteLength, count: n * n, type: 'uint16', predictor: 'planar', planes: 'lo-hi' },
        flow: { byteOffset: fAt, byteLength: flow.byteLength, count: n * n, type: 'uint8', water: WATER_FLOW },
        validity: allValid ? { mode: 'all' } : { mode: 'bits', byteOffset: pushChunk(vbits), byteLength: vbits.byteLength },
        minY, maxY, visible, closestM: visible ? Math.round(dist) : null,
        band: !visible ? 'far' : dist < bands.nearM ? 'near' : dist < bands.midM ? 'mid' : 'far',
        lod, errorsM: Object.fromEntries(Object.entries(errorsM).filter(([s]) => Number(s) >= stride).map(([s, e]) => [s, Math.round(e * 1000) / 1000])),
      };
      tiles.push(tile);
      for (let a = 0; a < 3; a++) { bounds.min[a] = Math.min(bounds.min[a], box.min[a]); bounds.max[a] = Math.max(bounds.max[a], box.max[a]); }
    }
  }
  const decoded = Buffer.concat(chunks);
  const payload = zlib.gzipSync(decoded, { level: 9, mtime: 0 });
  // gzip's header carries an mtime and OS byte; zero them for reproducible hashes.
  payload[4] = payload[5] = payload[6] = payload[7] = 0;
  payload[9] = 255;
  const estimate = (budget) => {
    let vertices = 0, triangles = 0;
    for (const t of tiles) {
      if (!t.visible) continue;
      const s = t.lod[budget];
      const m = cells / s;
      vertices += (m + 1) * (m + 1);
      triangles += 2 * m * m;
    }
    return {
      vertices, triangles,
      // Float32 xyz position + Uint32 indices, plus the RGBA8 surface
      // texture at grid resolution with a full mip chain (x4/3).
      meshBytes: vertices * 12 + triangles * 3 * 4,
      surfaceTextureBytes: Math.round(w * hgt * 4 * 4 / 3),
    };
  };
  const manifest = {
    schema: TERRAIN_SCHEMA, version: TERRAIN_VERSION,
    viewId: view.id, regionId: view.regionId || null,
    source: {
      demSha256: grid.meta?.payload?.heights?.sha256 || null,
      provenance: grid.provenance || null,
      horizontalCrs: grid.horizontalCrs, verticalReference: grid.verticalReference,
      centerLonLat: grid.centerLonLat || null,
      sourceResolutionM: grid.sourceResolutionM, outputSpacingM: grid.outputSpacingM,
    },
    grid: { width: w, height: hgt, cellSizeM: cell, originM: [...originM] },
    axes: 'X east, Y up, Z south (metres)',
    tileCells: cells, tilesX, tilesZ,
    quantization: { offsetM, stepM },
    boundsM: bounds,
    bands,
    lod: {
      budgets, fovYDeg: view.camera.fovYDeg, visibility: vis,
      achievedErrorPx: Object.fromEntries(Object.entries(achieved).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
      triangulation: 'quads split along the (0,0)-(1,1) diagonal; finer edges snap to the coarser neighbour',
    },
    hydrology: { flow: 'log2(D8 accumulation over depression-filled heights) * 16, capped 254', water: 'hydro-flattened components (3x3 range <= 0.35 m, >= 60 cells) = 255' },
    payload: {
      url: options.dataUrl || `${view.id}.terrain.bin.gz`, encoding: 'gzip',
      byteLength: payload.byteLength, sha256: sha256(payload),
      decodedByteLength: decoded.byteLength, decodedSha256: sha256(decoded),
    },
    estimatedBytes: { desktop: estimate('desktop'), mobile: estimate('mobile') },
    landmarks: options.landmarks || grid.meta?.landmarks || [],
    tiles,
  };
  return { manifest, payload, decoded, stats: { tiles: tiles.length, ...manifest.estimatedBytes } };
}

