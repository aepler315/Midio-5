// Build the range basket from data/terrain/ranges.json.
//
//   node tools/build-ranges.mjs            # every range
//   node tools/build-ranges.mjs fuji rainier
//
// For each range: fetch real elevation (fetch-terrain-grid.mjs), build the
// skyline profile (build-terrain-profile.mjs, which traces the crest and
// picks the camera side), score it (RangeCharacter.js), and write it to
// src/world/terrain/ranges/<id>.js. Then regenerate
// src/world/terrain/ranges/index.js: metadata and scores for EVERY range,
// small enough to load up front, with each range's profile behind its own
// dynamic import so only the chosen one is ever downloaded. That split is
// what lets the basket hold hundreds of ranges.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTerrainGrid } from './fetch-terrain-grid.mjs';
import { rangeAxisDeg, rangeElongation, rotateGrid, valleyCameraElevM } from './lib/terrarium.mjs';
import { rangeCharacter, skylineQuality } from '../src/world/terrain/RangeCharacter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'data/terrain/ranges.json'), 'utf8'));
const outDir = path.join(root, 'src/world/terrain/ranges');
const gridDir = path.join(root, '.terrain-cache/grids');
mkdirSync(outDir, { recursive: true });
mkdirSync(gridDir, { recursive: true });

const only = new Set(process.argv.slice(2));
const rejected = [];
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

// The skyline builder assumes a north-south crest. A range on any other
// bearing (the Cordillera Blanca runs ~30 deg off north; the Alps and the
// Himalaya run east-west) is rotated so its own axis runs up the grid. The
// extent is recomputed around the same centre to match the rotated grid's
// metric size, because the builder reads cell geometry from it; the result
// is range-aligned rather than north-up, and its meta says so.
const ALIGN_MIN_DEG = 12;
const ALIGN_MIN_ELONGATION = 1.8;
function alignToRange(grid, range) {
  const buf = Buffer.from(grid.elevB64, 'base64');
  const elev = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const shape = { width: grid.width, height: grid.height, elev };
  // Camera height from THIS range's valley floor, not a fixed 2,200m.
  const cameraElevM = range.cameraElevM ?? valleyCameraElevM(shape);
  const axisDeg = range.axisDeg ?? rangeAxisDeg(shape);
  const elongation = rangeElongation(shape);
  // Only a genuinely elongated range has an axis to align. A cone or a round
  // massif reads a bearing from noise, and rotating on noise helps nothing.
  const aligned = range.axisDeg != null || (elongation >= ALIGN_MIN_ELONGATION && Math.abs(axisDeg) >= ALIGN_MIN_DEG);
  if (!aligned) return { ...grid, cameraElevM, axisDeg: Math.round(axisDeg), elongation: round(elongation, 2) };
  const rot = rotateGrid({ width: grid.width, height: grid.height, elev }, axisDeg);
  const lat0 = ((grid.south + grid.north) / 2) * Math.PI / 180;
  const cLon = (grid.west + grid.east) / 2, cLat = (grid.south + grid.north) / 2;
  const halfLon = (rot.width * grid.cellM) / (111320 * Math.cos(lat0)) / 2;
  const halfLat = (rot.height * grid.cellM) / 110540 / 2;
  return {
    ...grid,
    west: cLon - halfLon, east: cLon + halfLon, south: cLat - halfLat, north: cLat + halfLat,
    width: rot.width, height: rot.height,
    elevB64: Buffer.from(rot.elev.buffer).toString('base64'),
    cameraElevM,
    axisDeg: Math.round(axisDeg),
    rotatedDeg: Math.round(axisDeg),
    elongation: round(elongation, 2),
    horizontalReference: `${grid.horizontalReference}; rotated ${Math.round(axisDeg)} deg so the range axis runs up the grid (not north-up)`,
  };
}

for (const range of manifest.ranges) {
  if (only.size && !only.has(range.id)) continue;
  let profilePath = range.profile ? path.join(root, range.profile) : null;
  if (!profilePath) {
    const [west, south, east, north] = range.bbox;
    const gridPath = path.join(gridDir, `${range.id}.json`);
    const grid = alignToRange(await fetchTerrainGrid({ bbox: { west, south, east, north } }), range);
    if (range.side) grid.side = range.side;
    writeFileSync(gridPath, JSON.stringify(grid));
    profilePath = path.join(gridDir, `${range.id}-profile.json`);
    execFileSync(process.execPath, [path.join(root, 'tools/build-terrain-profile.mjs'), gridPath, profilePath],
      { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  // Seven significant figures: elevations to 0.1mm, angles to a millionth
  // of a degree. The raw values are single-precision elevations printed at
  // full double length, which eslint's no-loss-of-precision rejects in the
  // generated modules -- and the extra digits are only noise. Rounded
  // BEFORE scoring, so the scores describe exactly the profile that ships.
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'),
    (_, v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(7)) : v));
  const character = rangeCharacter(profile);
  const quality = skylineQuality(profile);
  // A rejected build leaves nothing behind: an old good build of the same
  // id is removed too, so the index can never serve a range that no longer
  // passes.
  const reject = (why) => {
    rejected.push(`${range.id}: ${why}`);
    for (const ext of ['.js', '.meta.json']) rmSync(path.join(outDir, `${range.id}${ext}`), { force: true });
  };
  if (!character) { reject('no usable skyline'); continue; }
  if (!quality.usable) {
    reject(`skyline sits on its own floor for ${Math.round(quality.floorShare * 100)}% of its length`);
    continue;
  }
  writeFileSync(path.join(outDir, `${range.id}.js`),
    `// Generated by tools/build-ranges.mjs from data/terrain/ranges.json. Do not edit.\n`
    + `export default ${JSON.stringify(profile)};\n`);
  const entry = {
    id: range.id, name: range.name, region: range.region, bbox: range.bbox,
    archetype: character.archetype, mood: character.mood,
    quality: { floorShare: round(quality.floorShare, 2) },
    scores: Object.fromEntries(Object.entries(character.scores).map(([k, v]) => [k, round(v)])),
    features: Object.fromEntries(Object.entries(character.features).map(([k, v]) => [k, round(v, 1)])),
  };
  writeFileSync(path.join(outDir, `${range.id}.meta.json`), JSON.stringify(entry, null, 2) + '\n');
  console.log(`${range.id.padEnd(18)} ${entry.archetype.padEnd(9)} ${JSON.stringify(entry.scores)}`);
}

// The index covers every built range, not just the ones rebuilt this run.
const metas = readdirSync(outDir).filter((f) => f.endsWith('.meta.json')).sort()
  .map((f) => JSON.parse(readFileSync(path.join(outDir, f), 'utf8')))
  .filter((m) => manifest.ranges.some((r) => r.id === m.id) && existsSync(path.join(outDir, `${m.id}.js`)));
const loaders = metas.map((m) => `  ${JSON.stringify(m.id)}: () => import('./${m.id}.js'),`).join('\n');
writeFileSync(path.join(outDir, 'index.js'),
  `// Generated by tools/build-ranges.mjs from data/terrain/ranges.json. Do not edit.\n`
  + `// Every range's scores up front; each profile behind its own import.\n`
  + `export const RANGES = ${JSON.stringify(metas, null, 2)};\n\n`
  + `export const LOADERS = {\n${loaders}\n};\n`);
console.log(`index: ${metas.length} ranges`);
if (rejected.length) console.log(`rejected (not in the index):\n  ${rejected.join('\n  ')}`);
