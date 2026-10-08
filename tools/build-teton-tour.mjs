// Teton Song Highway offline build. Task 1 produces a provisional all-tiles
// terrain package; later stages repack it around the computed highway.
//   node tools/build-teton-tour.mjs --stage terrain [--out DIR] [--publish]
//   node tools/build-teton-tour.mjs --dem-grid PREFIX
//   node tools/build-teton-tour.mjs --input TILE.tif [--input TILE.tif ...]
// A normalized --dem-grid must include the summit coordinates in points{}.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDem, readDemGrid } from './lib/terrain-source.mjs';
import { bakeTerrain, despikeGrid, validateDemGrid, validateTerrainManifest } from './lib/terrain-bake.mjs';
import { findPoints } from './lib/tour-points.mjs';
import { transformTourCoordinates } from './lib/tour-coordinates.mjs';
import { buildTourNames } from './build-tour-names.mjs';
import { assignRoles, TOUR_ROLES } from './lib/tour-roles.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = data => createHash('sha256').update(data).digest('hex');

// Coordinates agree with the Teton entries in Ridgeview's GeoNames data;
// published summit heights are the plan's independent DEM acceptance gate.
export const SUMMIT_CHECKS = Object.freeze([
  { name: 'Grand Teton', lonLat: [-110.80237, 43.74125], elevationM: 4199, geonamesElevationM: 4200 },
  { name: 'Mount Owen', lonLat: [-110.79744, 43.74688], elevationM: 3940, geonamesElevationM: 3934 },
  { name: 'Middle Teton', lonLat: [-110.81133, 43.72993], elevationM: 3903, geonamesElevationM: 3904 },
  { name: 'Mount Moran', lonLat: [-110.77632, 43.83521], elevationM: 3842, geonamesElevationM: 3837 },
  { name: 'South Teton', lonLat: [-110.81855, 43.71854], elevationM: 3814, geonamesElevationM: 3801 },
  { name: 'Teewinot', lonLat: [-110.78021, 43.74715], elevationM: 3757, geonamesElevationM: 3733 },
  { name: 'Buck Mountain', lonLat: [-110.81938, 43.68937], elevationM: 3627, geonamesElevationM: 3627 },
  { name: 'Rendezvous Mountain', lonLat: [-110.9049, 43.56724], elevationM: 3337, geonamesElevationM: 3337 },
  { name: 'Mount Glory', lonLat: [-110.94994, 43.50687], elevationM: 3065, geonamesElevationM: 3065 },
  { name: 'Survey Peak', lonLat: [-110.85022, 44.04021], elevationM: 2824, geonamesElevationM: 2824 },
]);

/** Local files have a separate, content-addressed normalization identity. */
export async function tourDemCacheKey(view, inputs = []) {
  const files = [];
  for (const input of inputs) {
    const file = await fs.realpath(input), hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    files.push({ file, sha256: hash.digest('hex') });
  }
  const source = inputs.length ? { type: 'local', files } : { type: 'remote', id: view.dem.source };
  const points = Object.fromEntries(SUMMIT_CHECKS.map(p => [p.name, p.lonLat]));
  return sha(JSON.stringify({ dem: view.dem, points, source })).slice(0, 16);
}

/** Hash-valid data still needs the requested metric frame and point identities. */
export function validateTourGrid(grid, view, checks = SUMMIT_CHECKS) {
  const errors = [...validateDemGrid(grid).errors];
  if (!grid) return { ok: false, errors };
  const dem = view.dem, cell = dem.cellM;
  const width = Math.round(dem.extentM[0] / cell) + 1;
  const height = Math.round(dem.extentM[1] / cell) + 1;
  const offset = dem.offsetM || [0, 0];
  const origin = [offset[0] - (width - 1) * cell / 2, offset[1] - (height - 1) * cell / 2];
  const same = (a, b, epsilon = 1e-8) => Array.isArray(a) && a.length === b.length
    && a.every((n, i) => Number.isFinite(n) && Math.abs(n - b[i]) <= epsilon);
  if (grid.width !== width || grid.height !== height) errors.push(`dimensions must be ${width} × ${height}`);
  if (grid.cellSizeM !== cell) errors.push(`spacing must be ${cell} m`);
  if (!same(grid.originM, origin)) errors.push('origin does not match requested extent');
  if (!same(grid.centerLonLat, dem.centerLonLat)) errors.push('centre does not match authoring');
  const crs = Object.fromEntries(String(grid.horizontalCrs).split(/\s+/).filter(s => s.startsWith('+') && s.includes('='))
    .map(s => s.slice(1).split('=')));
  const expected = { proj: 'tmerc', datum: 'NAD83', units: 'm',
    lat_0: dem.centerLonLat[1], lon_0: dem.centerLonLat[0], k: 1, x_0: 0, y_0: 0 };
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === 'number' ? !(Number.isFinite(Number(crs[key])) && Math.abs(Number(crs[key]) - value) <= 1e-8)
      : crs[key] !== value) errors.push(`horizontal CRS ${key} must be ${value}`);
  }
  const axes = [1, 0, 0, 0, -1, 0];
  if (!same(grid.sourceToLocal, axes) || !same(grid.localToSource, axes)) errors.push('axes must be X east, Z south');
  for (const summit of checks) {
    const point = grid.points?.[summit.name];
    if (!same(point?.lonLat, summit.lonLat)) errors.push(`${summit.name}: geographic coordinates do not match`);
    const local = point?.localM;
    if (!Array.isArray(local) || local.length !== 2 || !local.every(Number.isFinite)
      || local[0] < origin[0] || local[0] > origin[0] + (width - 1) * cell
      || local[1] < origin[1] || local[1] > origin[1] + (height - 1) * cell) {
      errors.push(`${summit.name}: local coordinates outside requested grid`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Check actual DEM cells in a 200 m circle, rather than a bounding square. */
export function checkSummits(grid, checks = SUMMIT_CHECKS) {
  const errors = [], summits = [];
  const { cellSizeM: cell, width, height, originM, heightsM, valid } = grid;
  for (const summit of checks) {
    const point = grid.points?.[summit.name];
    if (!point?.localM?.every(Number.isFinite) || point.localM.length !== 2) {
      errors.push(`${summit.name}: summit coordinates missing from normalized DEM`);
      continue;
    }
    const [x, z] = point.localM;
    let demPeakM = -Infinity;
    const ca = Math.max(0, Math.ceil((x - 200 - originM[0]) / cell));
    const cb = Math.min(width - 1, Math.floor((x + 200 - originM[0]) / cell));
    const ra = Math.max(0, Math.ceil((z - 200 - originM[1]) / cell));
    const rb = Math.min(height - 1, Math.floor((z + 200 - originM[1]) / cell));
    for (let row = ra; row <= rb; row++) for (let col = ca; col <= cb; col++) {
      const dx = originM[0] + col * cell - x, dz = originM[1] + row * cell - z;
      const i = row * width + col;
      if (dx * dx + dz * dz <= 200 ** 2 && valid[i] && Number.isFinite(heightsM[i])) demPeakM = Math.max(demPeakM, heightsM[i]);
    }
    const deltaM = demPeakM - summit.elevationM;
    summits.push({ ...summit, demPeakM: Number.isFinite(demPeakM) ? demPeakM : null,
      deltaM: Number.isFinite(deltaM) ? deltaM : null });
    if (!Number.isFinite(demPeakM)) errors.push(`${summit.name}: no valid DEM samples within 200 m`);
    else if (Math.abs(deltaM) > 25) errors.push(`${summit.name}: DEM ${demPeakM.toFixed(1)} m differs by ${deltaM.toFixed(1)} m`);
  }
  return { ok: errors.length === 0, errors, summits };
}

/** Normalize (or load a hash-validated grid), verify summits, and bake all tiles. */
export async function buildTourTerrain({
  authoringFile = path.join(root, 'data/terrain/teton-tour.json'),
  outDir = path.join(root, '.terrain-cache/teton-tour'), demGrid = null, inputs = [],
  publish = false, log = console.log,
} = {}) {
  const view = JSON.parse(await fs.readFile(authoringFile, 'utf8'));
  const points = Object.fromEntries(SUMMIT_CHECKS.map(p => [p.name, p.lonLat]));
  const cache = path.join(root, '.terrain-cache');
  let grid;
  if (demGrid && typeof demGrid === 'object') grid = demGrid;
  else if (demGrid) grid = await readDemGrid(demGrid);
  else {
    const prefix = path.join(cache, 'teton-tour', `grid-${await tourDemCacheKey(view, inputs)}`);
    try { grid = await readDemGrid(prefix); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!grid) {
      log(`Normalizing ${view.dem.extentM.join(' × ')} m at ${view.dem.cellM} m from ${inputs.length ? 'local rasters' : view.dem.source}`);
      grid = await normalizeDem(inputs.length ? inputs : view.dem.source, {
        out: prefix, ...view.dem, points, cache,
      });
    }
  }
  const frame = validateTourGrid(grid, view);
  if (!frame.ok) throw new Error(`Teton DEM frame mismatch: ${frame.errors.join('; ')}`);
  const despikedCells = despikeGrid(grid);
  const summits = checkSummits(grid);
  if (!summits.ok) throw new Error(`Teton summit checks failed: ${summits.errors.join('; ')}`);
  for (const p of summits.summits) log(`${p.name}: published ${p.elevationM} m, GeoNames ${p.geonamesElevationM} m, DEM ${p.demPeakM.toFixed(1)} m (Δ ${p.deltaM.toFixed(1)} m)`);
  const baked = await bakeTerrain(grid, view, { allTiles: true,
    dataUrl: `${view.id}.terrain.bin.gz`, landmarks: summits.summits });
  const packageCheck = validateTerrainManifest(baked.manifest, { decoded: baked.decoded.byteLength });
  if (!packageCheck.ok) throw new Error(`Teton terrain package rejected: ${packageCheck.errors.join('; ')}`);
  const dir = publish ? path.join(root, 'src/assets/range/v2/terrain') : outDir;
  await fs.mkdir(dir, { recursive: true });
  const manifestFile = path.join(dir, `${view.id}.terrain.json`);
  await fs.writeFile(manifestFile, JSON.stringify(baked.manifest, null, 2) + '\n');
  await fs.writeFile(path.join(dir, `${view.id}.terrain.bin.gz`), baked.payload);
  const report = { stage: 'terrain-provisional', grid: [grid.width, grid.height], despikedCells,
    summitChecks: summits.summits, tiles: baked.manifest.tiles.length,
    compressedBytes: baked.payload.byteLength, decodedBytes: baked.decoded.byteLength,
    terrainSha256: baked.manifest.payload.sha256, demSha256: baked.manifest.source.demSha256,
    provenance: grid.provenance };
  await fs.writeFile(path.join(dir, `${view.id}.build.json`), JSON.stringify(report, null, 2) + '\n');
  log(`Provisional terrain: ${report.tiles} tiles, ${(report.compressedBytes / 1024 ** 2).toFixed(2)} MiB gz`);
  return { grid, ...baked, report, manifestFile };
}

/** Review data only; no point/station package is shipped by this stage. */
export async function buildTourPoints({
  authoringFile = path.join(root, 'data/terrain/teton-tour.json'),
  namesFile = path.join(root, 'data/terrain/teton-tour-names.json'),
  pointsFile = path.join(root, 'data/terrain/teton-tour-points.json'),
  log = console.log, ...terrainOptions
} = {}) {
  const view = JSON.parse(await fs.readFile(authoringFile, 'utf8'));
  const terrain = await buildTourTerrain({ ...terrainOptions, authoringFile, publish: false, log });
  let namesText;
  try { namesText = await fs.readFile(namesFile, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await buildTourNames({ authoring: authoringFile, out: namesFile, log });
    namesText = await fs.readFile(namesFile, 'utf8');
  }
  const names = JSON.parse(namesText);
  if (names.schema !== 'midio.tour-names' || names.version !== 1
    || JSON.stringify(names.centerLonLat) !== JSON.stringify(view.dem.centerLonLat)
    || JSON.stringify(names.extentM) !== JSON.stringify(view.dem.extentM) || !Array.isArray(names.names)) {
    throw new Error('Teton names file does not match the requested region');
  }
  log('Finding points and measuring terrain properties');
  const result = findPoints(terrain.grid, { pMin: view.tour.tunables.pMinM,
    isoMin: view.tour.tunables.isoMinM, names: names.names });
  if (result.stats.unmatchedProminentPeaks.length) {
    throw new Error(`Unmatched GeoNames peaks with prominence ≥30 m: ${result.stats.unmatchedProminentPeaks.map(n => n.name).join(', ')}`);
  }
  const geographic = await transformTourCoordinates(result.points.map(p => [p.localM[0], p.localM[2]]),
    { centerLonLat: view.dem.centerLonLat, inverse: true });
  result.points.forEach((p, i) => { p.lonLat = geographic[i]; });
  const assigned = assignRoles(result.points, { grid: terrain.grid, tunables: view.tour.tunables });
  result.points = assigned.points;
  result.roles = assigned.roles;
  result.stats = { ...result.stats, ...assigned.stats };
  const output = { schema: 'midio.tour-points', version: 1, terrainViewId: view.id,
    horizontalCrs: terrain.grid.horizontalCrs, axes: 'X east, Y up, Z south (metres)', ...result,
    provenance: { demSha256: terrain.manifest.source.demSha256, namesSha256: sha(namesText), builtWith: 'tools/build-teton-tour.mjs' } };
  await fs.mkdir(path.dirname(path.resolve(pointsFile)), { recursive: true });
  await fs.writeFile(pointsFile, JSON.stringify(output, null, 2) + '\n');
  log(`Points: ${result.stats.peaks} peaks, ${result.stats.cols} cols, ${result.stats.lakes} lakes, ${result.stats.canyons} canyons`);
  for (const p of result.points.filter(p => ['summit', 'subpeak', 'butte'].includes(p.type)).sort((a, b) => b.elevationM - a.elevationM).slice(0, 20)) {
    log(`${p.name || p.id}: ${p.elevationM.toFixed(1)} m, prominence ${p.prominenceM.toFixed(1)} m${p.prominenceTruncated ? ' (truncated)' : ''}, isolation ${p.isolationM.toFixed(1)} m`);
  }
  for (const role of TOUR_ROLES) log(`${role}: ${assigned.roles[role].primaries.map(id => {
    const p = result.points.find(p => p.id === id);
    return p.name || `unnamed (${p.lonLat[1].toFixed(5)}, ${p.lonLat[0].toFixed(5)}, ${Math.round(p.elevationM)} m)`;
  }).join(' | ')}`);
  return { ...terrain, points: output };
}

async function main(args) {
  const options = { inputs: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--publish') options.publish = true;
    else if (arg === '--help') {
      console.log('node tools/build-teton-tour.mjs --stage terrain|points [--out DIR] [--dem-grid PREFIX | --input TILE.tif ...] [--names FILE] [--points FILE] [--publish]');
      return;
    } else if (['--stage', '--out', '--dem-grid', '--input', '--authoring', '--names', '--points'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      if (arg === '--input') options.inputs.push(value);
      else options[{ '--stage': 'stage', '--out': 'outDir', '--dem-grid': 'demGrid', '--authoring': 'authoringFile', '--names': 'namesFile', '--points': 'pointsFile' }[arg]] = value;
    } else throw new Error(`unknown option ${arg}`);
  }
  if (options.stage === 'points') await buildTourPoints(options);
  else if (!options.stage || options.stage === 'terrain') await buildTourTerrain(options);
  else throw new Error(`stage ${options.stage} is not implemented yet`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
