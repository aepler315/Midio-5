// Find new ranges for the basket automatically, from GeoNames' named summits.
//
//   node tools/discover-ranges.mjs [--countries=US,CA,MX] [--count=80] [--spacing=80]
//   node tools/build-ranges.mjs          # then build them
//
// Writes data/terrain/discovered.json, which build-ranges.mjs reads next to
// the hand-curated ranges.json. Rerunning it is safe: the choice depends only
// on the GeoNames dumps and the elevation tiles, and hand-curated ranges are
// never replaced -- discovery keeps clear of them.
//
// Steps: download each country's GeoNames dump (cached under
// .terrain-cache/geonames/), keep the highest summit per half-degree cell,
// measure each one's local relief from low-zoom elevation tiles, and pick the
// basket by relief band and spacing (tools/lib/rangeDiscovery.mjs).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTiles } from './fetch-terrain-grid.mjs';
import { resampleGrid, tilesForBbox, TERRARIUM_URL } from './lib/terrarium.mjs';
import {
  boxAround, highestPerCell, localRelief, parseGeonamesRow, selectRanges, uniqueId,
} from './lib/rangeDiscovery.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEONAMES = 'https://download.geonames.org/export/dump';
const cacheDir = path.join(root, '.terrain-cache/geonames');
const arg = (name, dflt) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const countries = arg('countries', 'US,CA,MX').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
const count = Number(arg('count', 80));
const spacingKm = Number(arg('spacing', 80));
const COUNTRY_NAMES = { US: 'USA', CA: 'Canada', MX: 'Mexico' };
// Relief is measured in a box this far either side of the summit, on z8
// tiles (~450m pixels at 45 deg): coarse, but a valley 1,500m down shows at
// any resolution, and z8 keeps all of North America to about a thousand
// tiles. A range is then built 22km either side of its summit.
const PROBE_HALF_KM = 15;
const PROBE_ZOOM = 8;
const RANGE_HALF_KM = 22;

async function download(file) {
  const dest = path.join(cacheDir, file);
  if (existsSync(dest)) return dest;
  mkdirSync(cacheDir, { recursive: true });
  const res = await fetch(`${GEONAMES}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function readCountry(cc) {
  const filtered = path.join(cacheDir, `${cc}-peaks.tsv`);
  if (!existsSync(filtered)) {
    const zip = await download(`${cc}.zip`);
    const text = execFileSync('unzip', ['-p', zip, `${cc}.txt`], { maxBuffer: 1 << 30 }).toString('utf8');
    writeFileSync(filtered, text.split('\n').filter((l) => parseGeonamesRow(l)).join('\n'));
  }
  return readFileSync(filtered, 'utf8').split('\n').map(parseGeonamesRow).filter(Boolean);
}

async function prefetch(boxes, zoom, parallel = 8) {
  const ids = new Set();
  for (const [west, south, east, north] of boxes) {
    const { x0, x1, y0, y1 } = tilesForBbox({ west, south, east, north }, zoom);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ids.add(`${x}/${y}`);
  }
  const missing = [...ids].filter((id) => !existsSync(path.join(root, '.terrain-cache', `${zoom}-${id.replace('/', '-')}.png`)));
  console.log(`${ids.size} z${zoom} tiles, ${missing.length} to download`);
  let next = 0;
  await Promise.all(Array.from({ length: parallel }, async () => {
    while (next < missing.length) {
      const id = missing[next++];
      const res = await fetch(`${TERRARIUM_URL}/${zoom}/${id}.png`);
      if (!res.ok) { console.warn(`tile ${zoom}/${id}: HTTP ${res.status}`); continue; }
      writeFileSync(path.join(root, '.terrain-cache', `${zoom}-${id.replace('/', '-')}.png`), Buffer.from(await res.arrayBuffer()));
    }
  }));
}

const admin1 = new Map(readFileSync(await download('admin1CodesASCII.txt'), 'utf8').split('\n')
  .map((l) => l.split('\t')).filter((f) => f.length > 1).map((f) => [f[0], f[1]]));

const summits = [];
for (const cc of countries) summits.push(...await readCountry(cc));
const cells = highestPerCell(summits);
console.log(`${summits.length} summits, ${cells.length} cells to measure`);

const probeBox = (s) => boxAround(s.lat, s.lon, PROBE_HALF_KM);
// A box sorted by tile shares decoded tiles with its neighbours.
cells.sort((a, b) => a.lat - b.lat || a.lon - b.lon);
await prefetch(cells.map(probeBox), PROBE_ZOOM);
const measured = [];
for (const s of cells) {
  const [west, south, east, north] = probeBox(s);
  const bbox = { west, south, east, north };
  try {
    const { tiles } = await loadTiles(bbox, PROBE_ZOOM);
    const reliefM = localRelief(resampleGrid(bbox, PROBE_ZOOM, tiles, 450).elev, s.elevM);
    if (Number.isFinite(reliefM)) measured.push({ ...s, reliefM: Math.round(reliefM) });
  } catch (err) {
    console.warn(`${s.name}: ${err.message}`);
  }
}

const manifest = JSON.parse(readFileSync(path.join(root, 'data/terrain/ranges.json'), 'utf8'));
const center = ([w, s, e, n]) => ({ lon: (w + e) / 2, lat: (s + n) / 2 });
const picks = selectRanges(measured, {
  count, spacingKm,
  avoid: manifest.ranges.map((r) => center(r.bbox)),
  avoidBoxes: manifest.ranges.map((r) => r.bbox),
});

const used = new Set(manifest.ranges.map((r) => r.id));
const ranges = picks.map((s) => {
  const region = [admin1.get(`${s.country}.${s.admin1}`), COUNTRY_NAMES[s.country] || s.country].filter(Boolean).join(', ');
  return {
    id: uniqueId(s.name, region, used),
    // The summit's own name only. GeoNames places a named range at one
    // point, so "the nearest range" named Mount Shasta after the Trinity
    // Mountains and Mount Robson after the Selwyn Range.
    name: s.name,
    region,
    bbox: boxAround(s.lat, s.lon, RANGE_HALF_KM),
    summit: { name: s.name, lat: s.lat, lon: s.lon, elevM: Math.round(s.elevM), geonameId: s.geonameId },
    probeReliefM: s.reliefM,
  };
});
ranges.sort((a, b) => a.id.localeCompare(b.id));

writeFileSync(path.join(root, 'data/terrain/discovered.json'), JSON.stringify({
  about: 'Generated by tools/discover-ranges.mjs; rerun it rather than editing. Summits from GeoNames (geonames.org, CC BY 4.0); relief measured on AWS Terrain Tiles. tools/build-ranges.mjs builds these next to the hand-curated ranges.json, and its quality gate drops any that do not make a usable skyline.',
  countries, count, spacingKm,
  ranges,
}, null, 1) + '\n');
const byBand = (lo, hi) => ranges.filter((r) => r.probeReliefM >= lo && r.probeReliefM < hi).length;
console.log(`picked ${ranges.length} of ${measured.length} measured: `
  + `${byBand(2000, Infinity)} over 2,000m relief, ${byBand(1200, 2000)} 1,200-2,000m, ${byBand(600, 1200)} 600-1,200m`);
