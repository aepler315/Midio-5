// Build a three-layer skyline profile from a north-up lat/lon elevation
// grid (Float32, row 0 = north). The grid is an argument, not fetched here.
//
//   node tools/build-terrain-profile.mjs grid.json out.json
//
// grid.json: { west, south, east, north, width, height, elevB64 }
import { readFileSync, writeFileSync } from 'node:fs';
import { demFromLatLon, crestGuideFromDem } from '../src/world/terrain/LatLonDem.js';
import { rangeLayerProfiles, profilesToJSON } from '../src/world/terrain/TerrainProfile.js';
import { scanCorridor, smoothBaseline, pointAlong } from '../src/world/terrain/SkylineScan.js';

const [gridPath, outPath] = process.argv.slice(2);
if (!gridPath || !outPath) {
  console.error('usage: node tools/build-terrain-profile.mjs grid.json out.json');
  process.exit(1);
}
const src = JSON.parse(readFileSync(gridPath, 'utf8'));
const buf = Buffer.from(src.elevB64, 'base64');
const elev = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const dem = demFromLatLon({ ...src, elev }, src.cellM || 200);
const guide = crestGuideFromDem(dem, 500);
const scanOpts = {
  distanceM: src.distanceM || 45000,
  cameraElevM: src.cameraElevM || 2200,
  side: src.side ?? -1,
  spacingM: src.spacingM || 400,
  pastM: src.pastM || 6000,
  curvature: src.curvature !== false,
  smoothWindowM: src.smoothWindowM || 8000,
  minGapM: src.minGapM || 8000,
};
const scan = scanCorridor(dem, guide, scanOpts);
let differ = 0;
let skyMax = -Infinity;
let skyAt = 0;
for (let i = 0; i < scan.skylineElevM.length; i++) {
  const sky = scan.skylineElevM[i];
  const crest = scan.crestElevM[i];
  if (Number.isFinite(sky) && Number.isFinite(crest) && Math.abs(sky - crest) > 150) differ++;
  if (Number.isFinite(sky) && sky > skyMax) {
    skyMax = sky;
    skyAt = i;
  }
}
const baseline = smoothBaseline(guide, scanOpts.smoothWindowM);
const summitPt = pointAlong(baseline, scan.alongM[skyAt]);
const summitLat = src.south + summitPt.y / 110540;
const lat0 = ((src.south + src.north) / 2) * Math.PI / 180;
const summitLon = src.west + summitPt.x / (111320 * Math.cos(lat0));
const profiles = rangeLayerProfiles(dem, guide, scanOpts, {
  source: 'USGS 3DEP',
  guide: 'max-elevation-per-row',
  bbox: [src.west, src.south, src.east, src.north],
  distanceM: scanOpts.distanceM,
  cameraElevM: scanOpts.cameraElevM,
  cellM: dem.cellM,
  crestSkylineDisagree: differ,
  stations: scan.skylineElevM.length,
  summitElevM: skyMax,
  summitLat,
  summitLon,
});
const json = profilesToJSON(profiles, {
  name: src.name || 'terrain',
  bbox: [src.west, src.south, src.east, src.north],
  distanceM: scanOpts.distanceM,
  cameraElevM: scanOpts.cameraElevM,
  layersFound: Object.keys(profiles),
  crestSkylineDisagree: differ,
  stations: scan.skylineElevM.length,
  summitElevM: skyMax,
  summitLat,
  summitLon,
  note: Object.keys(profiles).length < 3
    ? 'The gap between ridge distances never opened. This view is one range, so nearer layers were not invented.'
    : '',
});
writeFileSync(outPath, JSON.stringify(json));
const counts = Object.fromEntries(Object.entries(profiles).map(([k, p]) => [k, p.angles.length]));
console.log(JSON.stringify({ layers: Object.keys(profiles), samples: counts, dem: [dem.width, dem.height] }));
