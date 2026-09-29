// Build one curated Range v2 scenic view: normalize its DEM corridor, turn
// its lon/lat-authored camera rail into local metres, and bake its terrain
// package. Authoring source: data/terrain/scenic-views.json.
//
//   node tools/build-range-scene.mjs --view <id> [--out DIR] [--publish] [--cell M]
//
// Without --publish the output goes to .terrain-cache/views/<id>/ for review
// (tools/review-range-views.mjs). With --publish the package is written to
// src/assets/range/v2/terrain/ and the runtime catalog is regenerated.
// Normalized grids are cached by a hash of their parameters, so re-baking a
// camera change never re-downloads elevation.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDem, readDemGrid } from './lib/terrain-source.mjs';
import { bakeTerrain } from './lib/terrain-bake.mjs';
import { cameraRailErrors } from '../src/world/terrain/SceneTravel.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AUTHORING = path.join(root, 'data', 'terrain', 'scenic-views.json');
export const RUNTIME_DIR = path.join(root, 'src', 'assets', 'range', 'v2');
const CACHE = path.join(root, '.terrain-cache');

const sha = (s) => createHash('sha256').update(s).digest('hex');

export async function readAuthoring(file = AUTHORING) {
  const doc = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!Array.isArray(doc.views)) throw new Error('scenic-views.json has no views[]');
  return doc;
}

/** Every lon/lat point a view needs converted: rail anchors + landmarks. */
function viewPoints(view) {
  const pts = {};
  for (const k of ['eyeStart', 'eyeEnd', 'targetStart', 'targetEnd']) {
    const a = view.rail?.[k];
    if (!a?.lonLat) throw new Error(`${view.id}: rail.${k}.lonLat missing`);
    pts[k] = a.lonLat;
  }
  for (const l of view.landmarks || []) pts[`landmark:${l.name}`] = l.lonLat;
  return pts;
}

/** Local camera (metres) from a normalized grid's converted points. */
export function localCamera(view, points) {
  const vec = (k) => {
    const a = view.rail[k];
    const p = points[k];
    if (!p) throw new Error(`${view.id}: point ${k} not converted`);
    let y;
    if (Number.isFinite(a.heightM)) y = a.heightM;
    else if (Number.isFinite(a.aboveGroundM)) {
      if (!Number.isFinite(p.groundM)) throw new Error(`${view.id}: ${k} is outside valid terrain`);
      y = p.groundM + a.aboveGroundM;
    } else throw new Error(`${view.id}: rail.${k} needs heightM or aboveGroundM`);
    return [round(p.localM[0]), round(y), round(p.localM[1])];
  };
  const camera = {
    eyeStartM: vec('eyeStart'), eyeEndM: vec('eyeEnd'),
    targetStartM: vec('targetStart'), targetEndM: vec('targetEnd'),
    fovYDeg: view.rail.fovYDeg ?? 35,
  };
  const errors = cameraRailErrors(camera);
  if (errors.length) throw new Error(`${view.id}: ${errors.join('; ')}`);
  return camera;
}
const round = (v) => Math.round(v * 10) / 10;

export async function buildView(view, { outDir, cell = null, log = console.log } = {}) {
  const dem = { ...view.dem, cellM: cell || view.dem.cellM };
  const points = viewPoints(view);
  const key = sha(JSON.stringify({ dem, points })).slice(0, 16);
  const prefix = path.join(CACHE, 'views', `${view.id}-${key}`);
  let grid;
  try {
    grid = await readDemGrid(prefix);
    log(`${view.id}: cached DEM ${path.relative(root, prefix)}`);
  } catch {
    log(`${view.id}: normalizing ${dem.source} ${dem.extentM.join('x')} m at ${dem.cellM} m`);
    grid = await normalizeDem(dem.source, {
      out: prefix, centerLonLat: dem.centerLonLat, extentM: dem.extentM, offsetM: dem.offsetM,
      cellM: dem.cellM, zoom: dem.zoom, cache: CACHE, points, fill: dem.fill, fillZoom: dem.fillZoom,
    });
  }
  const camera = localCamera(view, grid.points);
  const landmarks = (view.landmarks || []).map((l) => {
    const p = grid.points[`landmark:${l.name}`];
    return {
      name: l.name, lonLat: l.lonLat, publishedElevationM: l.elevationM ?? null,
      localM: p ? [round(p.localM[0]), round(p.localM[1])] : null,
      demGroundM: p?.groundM ?? null, demPeakWithin200mM: p?.peakWithin200mM ?? null,
    };
  });
  const runtimeView = { ...view, camera };
  const baked = await bakeTerrain(grid, runtimeView, { landmarks, dataUrl: `${view.id}.terrain.bin.gz` });
  await fs.mkdir(outDir, { recursive: true });
  const manifestText = JSON.stringify(baked.manifest) + '\n';
  await fs.writeFile(path.join(outDir, `${view.id}.terrain.json`), manifestText);
  await fs.writeFile(path.join(outDir, `${view.id}.terrain.bin.gz`), baked.payload);
  const out = {
    view: runtimeView, manifestSha256: sha(manifestText), payloadSha256: baked.manifest.payload.sha256,
    payloadBytes: baked.payload.byteLength, stats: baked.stats, landmarks,
    achievedErrorPx: baked.manifest.lod.achievedErrorPx,
  };
  log(`${view.id}: ${baked.stats.tiles} tiles, ${(baked.payload.byteLength / 1048576).toFixed(2)} MiB payload, `
    + `desktop ${baked.stats.desktop.triangles} tris, mobile ${baked.stats.mobile.triangles} tris, `
    + `error ${JSON.stringify(out.achievedErrorPx)}`);
  for (const l of landmarks) {
    if (l.publishedElevationM != null && l.demPeakWithin200mM != null) {
      log(`  ${l.name}: published ${l.publishedElevationM} m, DEM peak ${l.demPeakWithin200mM.toFixed(0)} m`);
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const id = opt('--view');
  const doc = await readAuthoring();
  const views = id === 'all' ? doc.views : doc.views.filter((v) => v.id === id);
  if (!views.length) throw new Error(`no view ${id} in scenic-views.json`);
  const publish = args.includes('--publish');
  for (const view of views) {
    const outDir = opt('--out') ? path.resolve(opt('--out'))
      : publish ? path.join(RUNTIME_DIR, 'terrain') : path.join(CACHE, 'views', view.id);
    const res = await buildView(view, { outDir, cell: Number(opt('--cell')) || null });
    await fs.writeFile(path.join(outDir, `${view.id}.build.json`), JSON.stringify(res, null, 1) + '\n');
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
