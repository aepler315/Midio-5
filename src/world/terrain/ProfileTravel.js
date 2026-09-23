// Where a scanned ridge is along its own profile, and how fast that
// changes. The strip is one south-to-north pass. It used to open on the
// south end and crawl at the far layer's fixed parallax. The song picks
// both: the energy's center of mass is the opening station, and the
// energy integral is the speed. A quiet song and a driving one do not
// take the same walk. Seeking recomputes the integral; it does not keep
// a rate from the frame you left.
import { clamp01, lerp } from '../../utils/math.js';
import { energyTravel } from '../EnergyTravel.js';
import { CodaDirector } from '../../sim/CodaDirector.js';

const STEP_MS = 40;
// Centroids land in the southern part of the range. The north end is
// left for the trip, not taken on the first frame.
const START_SPAN = 0.62;

// px/s on the far strip. Not the far layer's parallax (world speed × 0.10,
// a flat 22). Quiet crawls, a groove covers ground, dense material settles
// so the skyline does not rush.
const CRAWL = 8;
const CRUISE = 36;
const SETTLE = 14;
const PEAK_AT = 0.40;

const startCache = new WeakMap();

export function terrainPreviewStationPx(stripWidth = 0) {
  const width = Number.isFinite(stripWidth) && stripWidth > 0 ? stripWidth : 0;
  return width * 0.5;
}

/** 0..1 time-centroid of global energy. 0 when the song never speaks. */
export function energyCentroid01(curves, durationMs) {
  const dur = Number(durationMs) || 0;
  if (!(dur > 0) || typeof curves?.globalEnergyNorm !== 'function') return 0;
  let sum = 0;
  let mass = 0;
  for (let t = 0; t < dur; t += STEP_MS) {
    const raw = curves.globalEnergyNorm(t);
    const e = Number.isFinite(raw) ? clamp01(raw) : 0;
    sum += e * (t / dur);
    mass += e;
  }
  return mass > 1e-8 ? sum / mass : 0;
}

/** Opening station, 0 at the south end. Uniform energy is not the south end. */
export function profileStart01(curves, durationMs) {
  if (typeof curves?.globalEnergyNorm !== 'function') return 0;
  const dur = Number(durationMs) || 0;
  if (!(dur > 0)) return 0;
  let byDur = startCache.get(curves);
  if (!byDur) {
    byDur = new Map();
    startCache.set(curves, byDur);
  }
  const hit = byDur.get(dur);
  if (hit !== undefined) return hit;
  const start = energyCentroid01(curves, dur) * START_SPAN;
  byDur.set(dur, start);
  return start;
}

/** Far-strip speed for one energy sample, px/s. */
export function profileRate(energy = 0) {
  const e = clamp01(energy);
  if (e <= PEAK_AT) return lerp(CRAWL, CRUISE, e / PEAK_AT);
  return lerp(CRUISE, SETTLE, (e - PEAK_AT) / (1 - PEAK_AT));
}

/** Integrated far-strip distance. Reduced flash halves it. */
export function profileTravelPx(tSec, curves = null, reducedFlash = false, response = null) {
  return energyTravel(tSec, curves, profileRate, response) * (reducedFlash ? 0.5 : 1);
}

/** How far this layer runs ahead of the far ridge, after the coda spreads them. */
export function ridgeDepth(layerRatio, farRatio, unravel = 0) {
  const far = CodaDirector.delaminateRatio(farRatio, unravel);
  if (!(far > 0)) return 1;
  return CodaDirector.delaminateRatio(layerRatio, unravel) / far;
}

/**
 * Where a nearer scanned ridge opens and how fast it runs, so its whole
 * trip fits its own strip. A nearer ridge moves `depth` times as fast as
 * the far one, and a real range does not tile: past its end the strip just
 * stops, and a front ridge three times as fast as the back one used to run
 * out and freeze a minute or two into a song while everything behind it
 * kept moving. So first open it earlier on its range; if even the whole
 * range is too short, compress every nearer ridge's lead over the far one
 * by the same factor (`maxDepth` is the nearest ridge's depth), which keeps
 * them in depth order and never slower than the far ridge.
 *   totalPx   the far ridge's travel over the whole song
 *   room      strip width less one view
 */
export function fitNearRidge({ startPx = 0, depth = 1, maxDepth = depth, totalPx = 0, room = 0 } = {}) {
  if (!(depth > 1) || !(totalPx > 0) || !(room > 0)) return { startPx, depth };
  let d = depth;
  if (maxDepth > 1 && maxDepth * totalPx > room) {
    const squeeze = Math.max(0, Math.min(1, (room / totalPx - 1) / (maxDepth - 1)));
    d = 1 + (depth - 1) * squeeze;
  }
  const start = Math.max(0, Math.min(startPx, room - d * totalPx));
  return { startPx: start, depth: d };
}

/**
 * Pixels into a south-to-north strip. `depth` 1 is the far ridge; a nearer
 * scanned range passes a larger depth and moves faster. With `fit`
 * ({ viewWidth, maxDepth }) a nearer ridge is fitted to its strip
 * (fitNearRidge); without it, it opens on the far ridge's station.
 */
export function terrainScrollPx({
  tSec = 0,
  curves = null,
  durationMs = 0,
  stripWidth = 0,
  reducedFlash = false,
  response = null,
  depth = 1,
  fit = null,
} = {}) {
  const width = Number.isFinite(stripWidth) && stripWidth > 0 ? stripWidth : 0;
  let start = profileStart01(curves, durationMs) * width;
  let d = depth > 0 ? depth : 1;
  if (fit && d > 1 && width > 0) {
    const totalPx = profileTravelPx((Number(durationMs) || 0) / 1000, curves, reducedFlash, response);
    const fitted = fitNearRidge({
      startPx: start, depth: d, maxDepth: Math.max(d, fit.maxDepth || d), totalPx,
      room: width - (fit.viewWidth > 0 ? fit.viewWidth : 0),
    });
    start = fitted.startPx;
    d = fitted.depth;
  }
  const traveled = profileTravelPx(tSec, curves, reducedFlash, response) * d;
  return start + traveled;
}

/**
 * How fast the view travels along the real range, averaged over the song, in
 * metres per second. The whole sampled skyline (`lengthM`) is laid across a
 * `stripWidth`-pixel strip, so each strip pixel is lengthM / stripWidth of
 * real ground; the song's travel in pixels over its length, times that, is
 * real distance over real time. NaN when anything needed is missing.
 */
export function groundSpeedMps({ curves = null, durationMs = 0, lengthM = 0, stripWidth = 0, response = null } = {}) {
  const sec = (Number(durationMs) || 0) / 1000;
  if (!(sec > 0) || !(lengthM > 0) || !(stripWidth > 0)) return NaN;
  return (profileTravelPx(sec, curves, false, response) / sec) * (lengthM / stripWidth);
}
