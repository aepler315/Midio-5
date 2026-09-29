// Range v2 visibility (plan Task 14): the far range's crest must stay at
// least MIN_FAR_EXPOSED visible at every rail station and every travel
// sample, the same protection the legacy ridge fit keeps (RidgeComposition
// MIN_EXPOSED). Measured on the shipped package -- the tiles the runtime
// actually draws -- through a depth raster of the whole view, with the far
// partition's skyline tested against everything nearer and the ground line.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { decodeTerrain, terrainHeightAt } from '../../src/world/alpine/TerrainMesh.js';
import { travelSpans } from '../../src/world/TravelSeam.js';
import { stationExposure, MIN_FAR_EXPOSED, VISIBILITY } from './terrain-bake.mjs';

export { MIN_FAR_EXPOSED };

/** Occlusion raster over the shipped surface, resampled every `step` cells. */
export const EXPOSURE_OCCLUSION = Object.freeze({ ...VISIBILITY.occlusion, stride: 1 });

/** Decode a shipped terrain package (manifest + gzip payload) from disk. */
export async function loadShippedTerrain(runtimeDir, view) {
  const manifestPath = path.join(runtimeDir, view.terrainManifestUrl);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const gz = await fs.readFile(path.join(path.dirname(manifestPath), manifest.payload.url));
  const bytes = zlib.gunzipSync(gz);
  return decodeTerrain(manifest, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

/** A regular height grid sampled from the decoded tiles (NaN = not drawn). */
export function gridFromTerrain(data, step = 4) {
  const g = data.grid;
  const w = Math.floor((g.width - 1) / step) + 1, h = Math.floor((g.height - 1) / step) + 1;
  const heightsM = new Float32Array(w * h), valid = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const y = terrainHeightAt(data, g.originM[0] + i * step * g.cellSizeM, g.originM[1] + j * step * g.cellSizeM);
    if (Number.isFinite(y)) { heightsM[j * w + i] = y; valid[j * w + i] = 1; }
  }
  return { width: w, height: h, cellSizeM: g.cellSizeM * step, originM: [...g.originM], heightsM, valid };
}

/** Per-station exposure of a shipped view: { stations, min }. */
export async function viewExposure(runtimeDir, view, { stations = VISIBILITY.stations } = {}) {
  const data = await loadShippedTerrain(runtimeDir, view);
  const grid = gridFromTerrain(data);
  const list = stationExposure(grid, { ...view, bands: data.manifest.bands }, { stations, occ: EXPOSURE_OCCLUSION });
  return { stations: list, min: Math.min(...list.map((s) => s.fraction)) };
}

/**
 * Exposure of a travel composite at seam progress `p`: columns are taken
 * from the side that dominates them (side A left of the seam, side B right
 * of it; the feather band splits at weight 0.5), following the far range's
 * own travel timing ('L2').
 */
export function travelExposure(colsA, colsB, p, layerKey = 'L2') {
  const W = colsA.length;
  const { lo, hi, bands } = travelSpans(W, layerKey, p);
  let crest = 0, shown = 0;
  for (let x = 0; x < W; x++) {
    const cx = x + 0.5;
    let useB;
    if (cx < lo) useB = false;
    else if (cx >= hi) useB = true;
    else useB = (bands.find((b) => cx >= b.x0 && cx < b.x1)?.weightB ?? 0.5) >= 0.5;
    const c = (useB ? colsB : colsA)[x];
    if (c) { crest++; if (c === 2) shown++; }
  }
  return crest ? shown / crest : 0;
}
