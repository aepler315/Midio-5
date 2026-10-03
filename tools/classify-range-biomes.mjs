// Tag every range in the basket with the biome its crest stands in, and
// the biomes around that crest.
//
//   node tools/classify-range-biomes.mjs Ecoregions2017.shp
//
// The shapefile is RESOLVE Ecoregions 2017 (Dinerstein et al., CC-BY 4.0,
// https://storage.googleapis.com/teow2016/Ecoregions2017.zip): 846
// ecoregions, each inside one of 14 biomes. It is an argument, not fetched
// or committed here -- it is 150 MB.
//
// Each range's box is a stamp centred on its summit. The ecoregion under
// that summit is the biome the skyline stands in — a sky island stays
// pine-oak even when the rest of the stamp is desert. The outer ring is
// stored as `surrounding`. `share` is how much of the inner crest agrees
// with the summit, counted only over samples that hit an ecoregion, so
// open water does not make a coast look mixed.
// Written to data/terrain/range-biomes.json and, as a module,
// src/world/terrain/rangeBiomes.js, which RealBiomes.js turns into the
// game's biomes.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { classifySamples, crestRingCells } from './lib/biomeSample.mjs';

const shpPath = process.argv[2];
if (!shpPath) {
  console.error('usage: node tools/classify-range-biomes.mjs Ecoregions2017.shp');
  process.exit(1);
}
const GRID = 7;
const CELL = 2;

function readDbf(file) {
  const b = readFileSync(file);
  const records = b.readUInt32LE(4);
  const headerLen = b.readUInt16LE(8);
  const recordLen = b.readUInt16LE(10);
  const fields = [];
  for (let off = 32; b[off] !== 0x0d; off += 32) {
    fields.push({ name: b.toString('latin1', off, off + 11).replace(/\0.*$/, ''), len: b[off + 16] });
  }
  const rows = [];
  for (let r = 0; r < records; r++) {
    let off = headerLen + r * recordLen + 1;
    const row = {};
    for (const f of fields) {
      row[f.name] = b.toString('utf8', off, off + f.len).trim();
      off += f.len;
    }
    rows.push(row);
  }
  return rows;
}

function readShp(file) {
  const b = readFileSync(file);
  const shapes = [];
  let off = 100;
  while (off < b.length) {
    const len = b.readInt32BE(off + 4) * 2;
    const rec = off + 8;
    const type = b.readInt32LE(rec);
    if (type === 5) {
      const box = [b.readDoubleLE(rec + 4), b.readDoubleLE(rec + 12), b.readDoubleLE(rec + 20), b.readDoubleLE(rec + 28)];
      const nParts = b.readInt32LE(rec + 36);
      const nPoints = b.readInt32LE(rec + 40);
      const parts = [];
      for (let i = 0; i < nParts; i++) parts.push(b.readInt32LE(rec + 44 + i * 4));
      const pts = new Float64Array(nPoints * 2);
      const p0 = rec + 44 + nParts * 4;
      for (let i = 0; i < nPoints * 2; i++) pts[i] = b.readDoubleLE(p0 + i * 8);
      shapes.push({ box, parts, pts, nPoints });
    } else {
      shapes.push(null);
    }
    off = rec + len;
  }
  return shapes;
}

// Even-odd over every ring: holes are rings too.
function inside(shape, x, y) {
  if (!shape) return false;
  const [x0, y0, x1, y1] = shape.box;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  let hit = false;
  const { parts, pts, nPoints } = shape;
  for (let p = 0; p < parts.length; p++) {
    const s = parts[p];
    const e = p + 1 < parts.length ? parts[p + 1] : nPoints;
    for (let i = s, j = e - 1; i < e; j = i++) {
      const xi = pts[i * 2], yi = pts[i * 2 + 1], xj = pts[j * 2], yj = pts[j * 2 + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

function indexShapes(shapes) {
  const cells = new Map();
  shapes.forEach((shape, i) => {
    if (!shape) return;
    const [x0, y0, x1, y1] = shape.box;
    for (let x = Math.floor(x0 / CELL); x <= Math.floor(x1 / CELL); x++) {
      for (let y = Math.floor(y0 / CELL); y <= Math.floor(y1 / CELL); y++) {
        const key = `${x},${y}`;
        const list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);
      }
    }
  });
  return cells;
}

const shapes = readShp(shpPath);
const rows = readDbf(shpPath.replace(/\.shp$/i, '.dbf'));
const cells = indexShapes(shapes);

function at(x, y) {
  const list = cells.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`);
  if (!list) return null;
  for (const i of list) {
    if (inside(shapes[i], x, y)) {
      const row = rows[i];
      return row ? { biome: row.BIOME_NAME, ecoregion: row.ECO_NAME } : null;
    }
  }
  return null;
}

const { crest, around } = crestRingCells(GRID);
const dir = 'src/world/terrain/ranges';
const out = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith('.meta.json')).sort()) {
  const meta = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
  const [w, s, e, n] = meta.bbox;
  const take = (ij) => ij.map(([i, j]) => at(
    w + ((i + 0.5) / GRID) * (e - w),
    s + ((j + 0.5) / GRID) * (n - s),
  ));
  const row = classifySamples({
    summit: at((w + e) / 2, (s + n) / 2),
    crest: take(crest),
    around: take(around),
  });
  if (!row) {
    console.warn(`${meta.id}: no ecoregion under its box`);
    continue;
  }
  out[meta.id] = row;
}
const text = JSON.stringify({
  source: 'RESOLVE Ecoregions 2017 (Dinerstein et al. 2017), CC-BY 4.0',
  method: `the ecoregion under the summit; share is how much of the inner crest agrees; the outer ring of a ${GRID}x${GRID} grid is stored as surrounding`,
  ranges: out,
}, null, 1);
writeFileSync('data/terrain/range-biomes.json', `${text}\n`);
writeFileSync('src/world/terrain/rangeBiomes.js',
  `// Generated by tools/classify-range-biomes.mjs. Do not edit.\nexport default ${text};\n`);
const tally = {};
for (const r of Object.values(out)) tally[r.biome] = (tally[r.biome] || 0) + 1;
console.log(tally);
console.log(`${Object.keys(out).length} ranges, ${Object.values(out).filter((r) => r.surrounding.length).length} with a different biome around the crest`);
