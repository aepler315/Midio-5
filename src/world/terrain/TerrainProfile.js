// A scanned skyline, reduced to the height samples a ridge strip already
// knows how to draw. Angles stay in radians. Screen height is one scale
// for the whole profile — a window onto a foothill is not stretched to
// the height of a summit that sits somewhere else on the range.

import { scanCorridor, splitScanLayers } from './SkylineScan.js';

export function buildProfile(scan, meta = {}) {
  if (!scan || !scan.skylineAngle || scan.skylineAngle.length < 2) {
    throw new Error('buildProfile needs a scan of at least two stations');
  }
  if (!(scan.spacingM > 0)) throw new Error('buildProfile needs spacingM');
  let angleMin = Infinity;
  let angleMax = -Infinity;
  for (let i = 0; i < scan.skylineAngle.length; i++) {
    const a = scan.skylineAngle[i];
    if (!Number.isFinite(a)) continue;
    if (a < angleMin) angleMin = a;
    if (a > angleMax) angleMax = a;
  }
  if (!Number.isFinite(angleMin)) throw new Error('buildProfile scan has no finite skyline');
  return {
    version: 1,
    kind: 'skyline',
    spacingM: scan.spacingM,
    angles: scan.skylineAngle,
    crestElevM: scan.crestElevM,
    skylineElevM: scan.skylineElevM,
    angleMin,
    angleMax,
    meta,
  };
}

/** 0..1 heights against the profile's own angle span, not the span of
 *  whichever window is about to be drawn. */
export function profileUnits(profile) {
  assertProfile(profile);
  const span = profile.angleMax - profile.angleMin;
  const out = new Float32Array(profile.angles.length);
  for (let i = 0; i < out.length; i++) {
    const a = profile.angles[i];
    out[i] = Number.isFinite(a) && span > 1e-12 ? (a - profile.angleMin) / span : 0;
  }
  return out;
}

export function assertProfile(profile) {
  if (!profile || profile.version !== 1 || profile.kind !== 'skyline') {
    throw new Error('not a skyline profile');
  }
  if (!(profile.spacingM > 0) || !profile.angles || profile.angles.length < 2) {
    throw new Error('skyline profile is missing samples');
  }
  if (!(profile.angleMax >= profile.angleMin)) throw new Error('skyline profile scale is inverted');
}

/** Sample `count` heights starting at `startM`, every `stepM`, on the
 *  profile's global scale. Past either end the value holds — a real range
 *  does not tile. */
export function sampleProfile(profile, startM, count, stepM) {
  assertProfile(profile);
  if (!(count >= 1) || !(stepM > 0)) throw new Error('sampleProfile needs count and stepM');
  const units = profileUnits(profile);
  const last = units.length - 1;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const f = (startM + i * stepM) / profile.spacingM;
    if (f <= 0) out[i] = units[0];
    else if (f >= last) out[i] = units[last];
    else {
      const j = Math.floor(f);
      const t = f - j;
      out[i] = units[j] + (units[j + 1] - units[j]) * t;
    }
  }
  return out;
}

/** Start indices of consecutive chunks of one profile. Overlap is shared
 *  source samples, so neighboring strips meet on the same geography. The
 *  tail is included when the range does not divide evenly. */
export function profileChunks(sampleCount, { chunk, overlap = 0 } = {}) {
  if (!(chunk >= 2) || sampleCount < 2) return [];
  const step = Math.max(1, chunk - overlap);
  const starts = [];
  for (let start = 0; start + chunk <= sampleCount; start += step) starts.push(start);
  const tail = sampleCount - chunk;
  if (tail > 0 && (starts.length === 0 || starts[starts.length - 1] !== tail)) starts.push(tail);
  return starts;
}

const LAYER_KEY = { far: 'L2', mid: 'L3', near: 'L4' };

/** One corridor, up to three profiles sharing a single angle scale.
 *  Far is L2, middle L3, near L4. A missing group is omitted rather than
 *  invented, and L5 is never filled — it stays the rolling foreground. */
export function rangeLayerProfiles(dem, guide, scanOpts, meta = {}) {
  const scan = scanCorridor(dem, guide, scanOpts);
  const layers = splitScanLayers(scan, { minGapM: scanOpts.minGapM ?? 8000 });
  let angleMin = Infinity;
  let angleMax = -Infinity;
  for (const layer of Object.values(layers)) {
    if (!layer) continue;
    for (let i = 0; i < layer.skylineAngle.length; i++) {
      const a = layer.skylineAngle[i];
      if (!Number.isFinite(a)) continue;
      if (a < angleMin) angleMin = a;
      if (a > angleMax) angleMax = a;
    }
  }
  const profiles = {};
  for (const name of ['far', 'mid', 'near']) {
    const layer = layers[name];
    if (!layer) continue;
    const profile = buildProfile(layer, { layer: name, ...meta });
    profile.angleMin = angleMin;
    profile.angleMax = angleMax;
    profiles[LAYER_KEY[name]] = profile;
  }
  return profiles;
}

export function profilesToJSON(profiles, meta = {}) {
  const layers = {};
  for (const [key, p] of Object.entries(profiles)) {
    layers[key] = {
      spacingM: p.spacingM,
      angleMin: p.angleMin,
      angleMax: p.angleMax,
      angles: Array.from(p.angles),
      crestElevM: Array.from(p.crestElevM),
      skylineElevM: p.skylineElevM ? Array.from(p.skylineElevM) : [],
      meta: p.meta || {},
    };
  }
  return { version: 1, meta, layers };
}

export function profilesFromJSON(obj) {
  if (!obj || obj.version !== 1 || !obj.layers) throw new Error('not a terrain profile set');
  const profiles = {};
  for (const [key, p] of Object.entries(obj.layers)) {
    profiles[key] = {
      version: 1,
      kind: 'skyline',
      spacingM: p.spacingM,
      angleMin: p.angleMin,
      angleMax: p.angleMax,
      angles: Float64Array.from(p.angles),
      crestElevM: Float64Array.from(p.crestElevM || []),
      skylineElevM: Float64Array.from(p.skylineElevM || []),
      meta: p.meta || {},
    };
    assertProfile(profiles[key]);
  }
  return profiles;
}

/** Guide polyline + elevation grid → profile. The grid is the builder's
 *  input; playback never sees it. */
export function profileFromDem(dem, guide, scanOpts, meta = {}) {
  const scan = scanCorridor(dem, guide, scanOpts);
  return buildProfile(scan, {
    distanceM: scanOpts.distanceM,
    cameraElevM: scanOpts.cameraElevM,
    curvature: !!scanOpts.curvature,
    spacingM: scan.spacingM,
    baselineLengthM: scan.baselineLengthM,
    guideLengthM: scan.guideLengthM,
    ...meta,
  });
}
