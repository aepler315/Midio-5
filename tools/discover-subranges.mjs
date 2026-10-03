// Every named subrange in the western United States, and the crests of
// northeast Washington in particular.
//
//   node tools/discover-subranges.mjs
//   node tools/build-ranges.mjs --missing
//
// The North America sample (tools/discover-ranges.mjs) keeps one summit per
// Wikidata range name, eighty of them, eighty kilometres apart. That is a
// basket, not a map: the Kettle River Range, the Huckleberry Range and the
// Washington Selkirks never come up, because nothing there outranks Glacier
// Peak for the name "North Cascades" — and most of them are not the North
// Cascades at all.
//
// This pass reads GeoNames instead. A mountain range is an MTS feature, so
// each named range is its own entry. In northeast Washington the high ridges
// are the subranges GNIS never promoted to MTS (Crowell Ridge, Hooknose
// Ridge, the Chewelah Mountains), and those are kept too. Relief is measured
// on the same low-zoom tiles as the North America sample. Hand-curated and
// already-discovered names are left alone.
//
// Writes data/terrain/subranges.json. build-ranges.mjs builds every entry
// whose probe cleared the relief floor (shouldBuild). Rerunning replaces the
// file; it does not edit ranges.json or discovered.json.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxAround, localRelief, uniqueId } from './lib/rangeDiscovery.mjs';
import { loadTiles } from './fetch-terrain-grid.mjs';
import { resampleGrid, tilesForBbox, TERRARIUM_URL } from './lib/terrarium.mjs';
import {
  EXTRA_SUBRANGES, NORTHEAST_WASHINGTON, STATE_NAMES, WESTERN_ADMIN1, acceptSubranges, applyCenterOverride,
  applySummitOverride, inNortheastWashington, isNamedRange, normalizeRangeName, parseGeonamesFeature, shouldBuild,
  claimSummits, separateViewpoints,
} from './lib/subrangeCatalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEONAMES = 'https://download.geonames.org/export/dump';
const cacheDir = path.join(root, '.terrain-cache/geonames');
const SUMMIT_CODES = new Set(['MT', 'PK', 'PKS', 'VLC']);
const PROBE_HALF_KM = 15;
const PROBE_ZOOM = 8;
const RANGE_HALF_KM = 22;
const SUMMIT_SEARCH_KM = 22;
// A ridge named for itself should not be dragged onto the monarch summit of
// the range next door. Crowell Ridge is not Snowy Top.
const RIDGE_SEARCH_KM = 6;
const RIDGE_MIN_ELEV_M = 1400;

async function download(file) {
  const dest = path.join(cacheDir, file);
  if (existsSync(dest)) return dest;
  mkdirSync(cacheDir, { recursive: true });
  const res = await fetch(`${GEONAMES}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

function cellKey(lat, lon, deg = 0.5) {
  return `${Math.floor(lat / deg) * deg},${Math.floor(lon / deg) * deg}`;
}

/** Highest summit within `km` of a point, from a half-degree cell index. */
function highestSummitNear(index, lat, lon, km) {
  const deg = 0.5;
  const lat0 = Math.floor(lat / deg) * deg;
  const lon0 = Math.floor(lon / deg) * deg;
  const reach = Math.ceil(km / 40);
  let best = null;
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      const cell = index.get(`${lat0 + i * deg},${lon0 + j * deg}`);
      if (!cell) continue;
      for (const s of cell) {
        const dLat = (s.lat - lat) * 110.54;
        const dLon = (s.lon - lon) * 111.32 * Math.cos(((s.lat + lat) / 2) * Math.PI / 180);
        const d = Math.hypot(dLat, dLon);
        if (d > km) continue;
        if (!best || s.elevM > best.elevM) best = s;
      }
    }
  }
  return best;
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

const zip = await download('US.zip');
const summits = new Map();
const features = [];
const seenIds = new Set();

await new Promise((resolve, reject) => {
  const child = spawn('unzip', ['-p', zip, 'US.txt'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    const f = parseGeonamesFeature(line);
    if (!f || f.country !== 'US' || !WESTERN_ADMIN1.has(f.admin1)) return;
    if (SUMMIT_CODES.has(f.code)) {
      if (!(f.elevM >= 100)) return;
      const key = cellKey(f.lat, f.lon);
      const cell = summits.get(key);
      if (cell) cell.push(f);
      else summits.set(key, [f]);
      return;
    }
    const northeast = inNortheastWashington(f.lat, f.lon);
    const ridge = f.code === 'RDGE' && northeast && f.elevM >= RIDGE_MIN_ELEV_M;
    const range = f.code === 'MTS' && isNamedRange(f.name, { ridge: false });
    if (!range && !(ridge && isNamedRange(f.name, { ridge: true }))) return;
    if (seenIds.has(f.geonameId)) return;
    seenIds.add(f.geonameId);
    features.push({ ...f, kind: ridge ? 'ridge' : 'range' });
  });
  child.on('error', reject);
  child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`))));
});

for (const extra of EXTRA_SUBRANGES) {
  const name = normalizeRangeName(extra.name);
  if (!features.some((f) => normalizeRangeName(f.name) === name && f.admin1 === extra.admin1)) {
    features.push({ ...extra, kind: 'range' });
  }
}

const manifest = JSON.parse(readFileSync(path.join(root, 'data/terrain/ranges.json'), 'utf8'));
const discoveredPath = path.join(root, 'data/terrain/discovered.json');
const discovered = existsSync(discoveredPath) ? JSON.parse(readFileSync(discoveredPath, 'utf8')).ranges : [];
const taken = [...manifest.ranges, ...discovered].map((r) => {
  const [west, south, east, north] = r.bbox;
  return { name: r.name, lat: (south + north) / 2, lon: (west + east) / 2 };
});

const ordered = features.map(applyCenterOverride).map(applySummitOverride).sort((a, b) => {
  const pa = inNortheastWashington(a.lat, a.lon) ? 0 : 1;
  const pb = inNortheastWashington(b.lat, b.lon) ? 0 : 1;
  return pa - pb || (b.elevM || 0) - (a.elevM || 0) || a.geonameId - b.geonameId;
});
const picked = acceptSubranges(ordered, { taken });
console.log(`${features.length} named features, ${picked.length} after dropping duplicates and names already in the basket`);

const located = claimSummits(picked.map((f) => {
  const reach = f.kind === 'ridge' ? RIDGE_SEARCH_KM : SUMMIT_SEARCH_KM;
  const origin = { lat: f.lat, lon: f.lon, elevM: f.elevM, geonameId: f.geonameId || null };
  const summit = (f.landmark || f.summitLocked)
    ? { name: f.landmark || f.name, lat: f.lat, lon: f.lon, elevM: f.elevM, geonameId: f.geonameId || null }
    : (highestSummitNear(summits, f.lat, f.lon, reach) || {
      name: f.name, lat: f.lat, lon: f.lon, elevM: f.elevM, geonameId: f.geonameId || null,
    });
  return { ...f, origin, summit, lat: summit.lat, lon: summit.lon };
})).map((s) => ({
  ...s,
  priority: inNortheastWashington(s.lat, s.lon) ? 'northeast-washington' : 'west',
}));

const probeBox = (s) => boxAround(s.lat, s.lon, PROBE_HALF_KM);
located.sort((a, b) => a.lat - b.lat || a.lon - b.lon);
await prefetch(located.map(probeBox), PROBE_ZOOM);

const ranges = [];
for (const s of located) {
  const [west, south, east, north] = probeBox(s);
  let reliefM = NaN;
  try {
    const { tiles } = await loadTiles({ west, south, east, north }, PROBE_ZOOM);
    reliefM = localRelief(resampleGrid({ west, south, east, north }, PROBE_ZOOM, tiles, 450).elev, s.summit?.elevM ?? s.elevM);
  } catch (err) {
    console.warn(`${s.name}: ${err.message}`);
  }
  ranges.push({
    ...s,
    probeReliefM: Number.isFinite(reliefM) ? Math.round(reliefM) : null,
  });
}

const used = new Set([...manifest.ranges, ...discovered].map((r) => r.id));
const entries = ranges.map((s) => {
  const region = [STATE_NAMES[s.admin1] || s.admin1, 'USA'].filter(Boolean).join(', ');
  const entry = {
    id: uniqueId(s.name, region, used),
    name: s.name,
    landmark: s.summit?.name || s.landmark || s.name,
    region,
    bbox: boxAround(s.lat, s.lon, RANGE_HALF_KM),
    summit: s.summit ? {
      name: s.summit.name,
      lat: s.summit.lat,
      lon: s.summit.lon,
      elevM: Math.round(s.summit.elevM),
      geonameId: s.summit.geonameId || null,
    } : null,
    probeReliefM: s.probeReliefM,
    priority: s.priority,
    kind: s.kind,
    catalog: 'subrange',
  };
  entry.build = shouldBuild(entry) && !s.absorbedBy;
  if (s.absorbedBy) entry.absorbedBy = s.absorbedBy;
  return entry;
});
separateViewpoints(entries);
entries.sort((a, b) => {
  if (a.priority !== b.priority) return a.priority === 'northeast-washington' ? -1 : 1;
  return a.id.localeCompare(b.id);
});

const outPath = path.join(root, 'data/terrain/subranges.json');
writeFileSync(outPath, JSON.stringify({
  about: 'Generated by tools/discover-subranges.mjs; rerun it rather than editing. Named ranges (and, in northeast Washington, high ridges) from GeoNames (geonames.org, CC BY 4.0); relief measured on AWS Terrain Tiles. The Selkirk Mountains entry is centred on Gypsy Peak. Lost River Range is centred on Borah Peak, not Mount McCaleb. The Idaho Sawtooth Range is Thompson Peak, not the Arizona or California hills of the same name. A viewpoint already claimed, and anything under 350 m of relief, stays in the file with build:false. tools/build-ranges.mjs builds entries with build:true.',
  west: [...WESTERN_ADMIN1],
  northeastWashington: NORTHEAST_WASHINGTON,
  ranges: entries,
}, null, 1) + '\n');

const newa = entries.filter((r) => r.priority === 'northeast-washington');
const building = entries.filter((r) => r.build);
console.log(`catalogued ${entries.length}: ${newa.length} northeast Washington (${newa.filter((r) => r.build).length} to build), ${building.length} to build in all`);
console.log(`northeast Washington: ${newa.map((r) => `${r.name}${r.build ? '' : ' (flat)'}`).join(', ')}`);
