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
 *  Gypsy Peak. Chewelah Mountains have summits in GNIS and no MTS feature.
 *  Lost River's GNIS point sits on Mount McCaleb, a day's walk south of
 *  Borah Peak, which is the range. The Idaho Sawtooths are not the Arizona
 *  hills that share the name; Thompson Peak is added because that MTS point
 *  never arrived under its own name. */
export const CENTER_OVERRIDES = Object.freeze([
  {
    name: 'Selkirk Mountains',
    landmark: 'Gypsy Peak',
    lat: 48.94576,
    lon: -117.15219,
    elevM: 2226,
    admin1: 'WA',
    // The published GNIS point is in Boundary County, Idaho.
    fromAdmin1: ['ID', 'WA'],
  },
]);

/** Replace the snapped summit. `admin1` is required when the same name
 *  exists in another state (Sawtooth Range, California). */
export const SUMMIT_OVERRIDES = Object.freeze([
  {
    name: 'Lost River Range',
    admin1: 'ID',
    landmark: 'Borah Peak',
    lat: 44.137389,
    lon: -113.781101,
    elevM: 3859,
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
  {
    name: 'Sawtooth Range',
    landmark: 'Thompson Peak',
    lat: 44.141533,
    lon: -115.009969,
    elevM: 3277,
    admin1: 'ID',
    country: 'US',
    code: 'MTS',
    geonameId: 0,
  },
]);

export function applyCenterOverride(feature) {
  const over = CENTER_OVERRIDES.find((o) => {
    if (normalizeRangeName(o.name) !== normalizeRangeName(feature.name)) return false;
    const from = o.fromAdmin1 || (o.admin1 ? [o.admin1] : null);
    return !from || from.includes(feature.admin1);
  });
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

/** A named high point that the nearby-summit search misses or mislabels.
 *  The feature's own coordinate is replaced, and `summitLocked` tells the
 *  search not to walk off onto a lesser neighbour. */
export function applySummitOverride(feature) {
  const over = SUMMIT_OVERRIDES.find((o) => normalizeRangeName(o.name) === normalizeRangeName(feature.name)
    && (!o.admin1 || o.admin1 === feature.admin1));
  if (!over) return feature;
  return {
    ...feature,
    lat: over.lat,
    lon: over.lon,
    elevM: over.elevM,
    admin1: over.admin1 || feature.admin1,
    landmark: over.landmark,
    summitLocked: true,
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
 *  Gypsy Peak just because Gypsy is the highest thing within a day's walk.
 *  If that own point is the same viewpoint (the two GeoNames rows are the
 *  same hill), the later name is `absorbed` and is not a second skyline. */
export function claimSummits(entries) {
  const keyOf = (s) => (s && Number.isFinite(s.lat) ? `${s.lat.toFixed(3)},${s.lon.toFixed(3)}` : null);
  const ranked = entries
    .map((e, i) => ({ i, moved: e.origin && e.summit ? distanceKm(e.origin, e.summit) : 0 }))
    .sort((a, b) => (entries[a.i].kind === 'ridge') - (entries[b.i].kind === 'ridge')
      || a.moved - b.moved || a.i - b.i);
  const held = new Map();
  const out = new Array(entries.length);
  for (const { i } of ranked) {
    const e = entries[i];
    let summit = e.summit;
    const key = keyOf(summit);
    if (key && held.has(key) && e.origin) {
      summit = {
        name: e.name, lat: e.origin.lat, lon: e.origin.lon,
        elevM: e.origin.elevM, geonameId: e.origin.geonameId || null,
      };
    }
    const claimed = keyOf(summit);
    if (claimed && held.has(claimed)) {
      out[i] = { ...e, summit, lat: summit?.lat ?? e.lat, lon: summit?.lon ?? e.lon, absorbedBy: held.get(claimed) };
      continue;
    }
    if (claimed) held.set(claimed, e.name);
    out[i] = { ...e, summit, lat: summit?.lat ?? e.lat, lon: summit?.lon ?? e.lon, absorbedBy: null };
  }
  return out;
}

/** Two catalogued viewpoints closer than `km` are one skyline. The higher
 *  summit keeps `build`; the other is absorbed and left in the file. */
export function separateViewpoints(entries, km = 1) {
  const order = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.build !== false && e.summit && Number.isFinite(e.summit.lat))
    .sort((a, b) => (b.e.summit.elevM || 0) - (a.e.summit.elevM || 0) || a.i - b.i);
  const kept = [];
  for (const { e } of order) {
    const hit = kept.find((k) => distanceKm(k.summit, e.summit) < km);
    if (!hit) { kept.push(e); continue; }
    e.build = false;
    e.absorbedBy = hit.id || hit.name;
  }
  return entries;
}

/** Build a subrange when the probe shows enough relief to be a skyline.
 *  A flat catalog entry stays in the file (the name was pulled) but is not
 *  fetched at 30 m. Northeast Washington uses the same floor as the rest
 *  of the west: a 180 m hill is not a range. */
export function shouldBuild(entry) {
  const relief = entry.probeReliefM;
  if (!Number.isFinite(relief)) return false;
  if (entry.absorbedBy) return false;
  return relief >= 350;
}
