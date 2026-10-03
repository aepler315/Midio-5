// Named mountain subranges, the pure half of tools/discover-subranges.mjs.
//
// GeoNames codes a mountain range as one point (feature code MTS), which is
// how "Kettle River Range" and "Huckleberry Range" exist as themselves
// instead of dissolving into "North Cascades". This module decides which of
// those points are real ranges, which corner of the map is northeast
// Washington, and which duplicates to drop. Nothing here touches the network.

import { distanceKm } from './rangeDiscovery.mjs';

/** Contiguous western United States. Alaska is already in the North America
 *  sample; it is not part of this pass. */
export const WESTERN_ADMIN1 = new Set(['WA', 'OR', 'CA', 'ID', 'NV', 'AZ', 'UT', 'MT', 'WY', 'CO', 'NM']);

export const STATE_NAMES = Object.freeze({
  WA: 'Washington', OR: 'Oregon', CA: 'California', ID: 'Idaho', NV: 'Nevada',
  AZ: 'Arizona', UT: 'Utah', MT: 'Montana', WY: 'Wyoming', CO: 'Colorado', NM: 'New Mexico',
});

/** Ferry, Stevens, Pend Oreille, the Okanogan highlands and the Washington
 *  Selkirk crest, plus the Idaho side of the Selkirk GNIS point. South edge
 *  reaches Mica Peak, where the Selkirks leave Spokane. */
export const NORTHEAST_WASHINGTON = Object.freeze({
  west: -120.05, south: 47.5, east: -116.7, north: 49.02,
});

export function inNortheastWashington(lat, lon) {
  const b = NORTHEAST_WASHINGTON;
  return lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
}

const JUNK = /\b(meadows?|tanks?|ski area|reservoir|campground|historical)\b/i;
const RANGE_WORDS = /\b(range|ranges|mountains|highlands|massif|hills|alps|peaks|sierra|buttes|bluffs|crags|knolls|rockies|devils)\b/i;
const RIDGE_WORDS = /\b(ridge|divide|crest)\b/i;

/** A GeoNames label that names a range (or, in northeast Washington, a crest
 *  that is the local subrange). Meadows and campgrounds miscoded as MTS are
 *  not ranges. */
export function isNamedRange(name, { ridge = false } = {}) {
  if (!name || JUNK.test(name)) return false;
  if (RANGE_WORDS.test(name) || /^sierra\b/i.test(name)) return true;
  return ridge && RIDGE_WORDS.test(name);
}

export function normalizeRangeName(name) {
  return String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** One GeoNames T-row, summits and ranges alike. Elevation prefers the
 *  surveyed value, same rule as parseGeonamesRow. */
export function parseGeonamesFeature(line) {
  const f = line.split('\t');
  if (f.length < 17 || f[6] !== 'T') return null;
  const lat = Number(f[4]);
  const lon = Number(f[5]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const surveyed = Number(f[15]);
  const dem = Number(f[16]);
  const elevM = f[15] !== '' && surveyed > 0 ? surveyed : (f[16] !== '' && dem > -9999 ? dem : NaN);
  return {
    geonameId: Number(f[0]), name: f[1], lat, lon, code: f[7],
    country: f[8], admin1: f[10], elevM,
  };
}

/** The GNIS point for the Selkirks sits in Boundary County, Idaho, on a
 *  modest flank. The Washington crest — the part this pass is for — is
 *  Gypsy Peak. Chewelah Mountains have summits in GNIS and no MTS feature. */
export const CENTER_OVERRIDES = Object.freeze([
  {
    name: 'Selkirk Mountains',
    landmark: 'Gypsy Peak',
    lat: 48.94576,
    lon: -117.15219,
    elevM: 2226,
    admin1: 'WA',
  },
]);

export const EXTRA_SUBRANGES = Object.freeze([
  {
    name: 'Chewelah Mountains',
    landmark: 'Chewelah Mountain',
    lat: 48.28434,
    lon: -117.5719,
    elevM: 1759,
    admin1: 'WA',
    country: 'US',
    code: 'MTS',
    geonameId: 0,
  },
]);

export function applyCenterOverride(feature) {
  const over = CENTER_OVERRIDES.find((o) => normalizeRangeName(o.name) === normalizeRangeName(feature.name));
  if (!over) return { ...feature, landmark: feature.landmark || null };
  return {
    ...feature,
    lat: over.lat,
    lon: over.lon,
    elevM: over.elevM,
    admin1: over.admin1 || feature.admin1,
    landmark: over.landmark,
  };
}

/**
 * Keep every distinct named range. `taken` is the basket already built
 * ({name, lat, lon} at each entry's centre). The same name within
 * `sameNameKm` is the same view — Mount Proteus does not count as the
 * Washington Selkirks, two hundred kilometres south. A different name within
 * `rangeSpacingKm` is a duplicate point. Ridges are considered after ranges,
 * and one within `ridgeSpacingKm` of a range is that range's own crest, not
 * a second skyline. Candidates in each group keep the order they were given.
 */
export function acceptSubranges(candidates, {
  taken = [], sameNameKm = 80, rangeSpacingKm = 3, ridgeSpacingKm = 6,
} = {}) {
  const placed = taken.map((t) => ({ ...t, locked: true, kind: 'range' }));
  const ranges = [];
  const ridges = [];
  for (const c of candidates) (c.kind === 'ridge' ? ridges : ranges).push(c);
  const out = [];
  const sameView = (c) => placed.some((a) => normalizeRangeName(a.name) === normalizeRangeName(c.name)
    && distanceKm(a, c) < sameNameKm);
  for (const c of ranges) {
    if (sameView(c)) continue;
    if (placed.some((a) => !a.locked && distanceKm(a, c) < rangeSpacingKm)) continue;
    placed.push({ ...c, kind: 'range' });
    out.push(c);
  }
  for (const c of ridges) {
    if (sameView(c)) continue;
    if (placed.some((a) => a.kind !== 'ridge' && distanceKm(a, c) < ridgeSpacingKm)) continue;
    if (placed.some((a) => a.kind === 'ridge' && distanceKm(a, c) < ridgeSpacingKm)) continue;
    placed.push({ ...c, kind: 'ridge' });
    out.push(c);
  }
  return out;
}

/** When several names snap to one summit, the name that already sits on it
 *  keeps it. The others go back to their own point — Lead King Hills is not
 *  Gypsy Peak just because Gypsy is the highest thing within a day's walk. */
export function claimSummits(entries) {
  const keyOf = (s) => (s && Number.isFinite(s.lat) ? `${s.lat.toFixed(3)},${s.lon.toFixed(3)}` : null);
  const ranked = entries
    .map((e, i) => ({ i, moved: e.origin && e.summit ? distanceKm(e.origin, e.summit) : 0 }))
    .sort((a, b) => (entries[a.i].kind === 'ridge') - (entries[b.i].kind === 'ridge')
      || a.moved - b.moved || a.i - b.i);
  const used = new Set();
  const out = new Array(entries.length);
  for (const { i } of ranked) {
    const e = entries[i];
    let summit = e.summit;
    const key = keyOf(summit);
    if (key && used.has(key) && e.origin) {
      summit = {
        name: e.name, lat: e.origin.lat, lon: e.origin.lon,
        elevM: e.origin.elevM, geonameId: e.origin.geonameId || null,
      };
    }
    const claimed = keyOf(summit);
    if (claimed) used.add(claimed);
    out[i] = { ...e, summit, lat: summit?.lat ?? e.lat, lon: summit?.lon ?? e.lon };
  }
  return out;
}

/** Build a subrange when the probe shows enough relief to be a skyline.
 *  Northeast Washington keeps gentler crests; a flat catalog entry stays in
 *  the file (the name was pulled) but is not fetched at 30 m. */
export function shouldBuild(entry) {
  const relief = entry.probeReliefM;
  if (!Number.isFinite(relief)) return false;
  return entry.priority === 'northeast-washington' ? relief >= 180 : relief >= 350;
}
