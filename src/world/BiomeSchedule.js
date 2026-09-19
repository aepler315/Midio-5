import { smoothstep } from '../utils/math.js';

/**
 * Pure timing helpers for BiomeManager.
 *
 * Keeping schedule math independent from canvas state makes section timing
 * testable without constructing a renderer and gives the manager a stable
 * seam for the remaining render passes to consume.
 */

/** Return the median beat length in seconds, or null for free-time input. */
export function medianBeatSec(barGrid) {
  if (!barGrid || barGrid.length < 3) return null;
  const gaps = [];
  for (let i = 1; i < barGrid.length; i++) {
    const d = barGrid[i].ms - barGrid[i - 1].ms;
    if (d > 60 && d < 12000) gaps.push(d);
  }
  if (gaps.length < 2) return null;
  gaps.sort((a, b) => a - b);
  const barMs = gaps[gaps.length >> 1];
  const beats = Math.max(1, Math.round(barGrid[0].numerator || 4));
  const beatSec = barMs / beats / 1000;
  return beatSec > 0.12 && beatSec < 4 ? beatSec : null;
}

export function sectionIndexAt(sections, nowMs) {
  if (!Array.isArray(sections) || sections.length === 0) return -1;
  let idx = sections.length - 1;
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].startMs <= nowMs) idx = i;
    else break;
  }
  return idx;
}

/** Blend section metadata without depending on a canvas or BiomeManager. */
export function blendSections(sections, nowMs) {
  const idx = sectionIndexAt(sections, nowMs);
  if (idx < 0) return null;
  const sec = sections[idx];
  const hm = sec.heightMul ?? 1;
  const sl = sec.snowLine01 ?? 1;
  if (idx === 0) {
    return {
      from: sec.profile, to: sec.profile, t: 1,
      fromHeightMul: hm, toHeightMul: hm, fromSnowLine01: sl, toSnowLine01: sl,
    };
  }

  // A cut is quick but still long enough for a height change to read as a
  // deliberate transition; shutters and fades use one and four bars.
  const bars = sec.transition === 'cut' ? 0.3 : sec.transition === 'shutter' ? 1 : 4;
  const t = smoothstep(0, 1, (nowMs - sec.startMs) / (bars * sec.barMs));
  if (t >= 0.999) {
    return {
      from: sec.profile, to: sec.profile, t: 1,
      fromHeightMul: hm, toHeightMul: hm, fromSnowLine01: sl, toSnowLine01: sl,
    };
  }
  const prev = sections[idx - 1];
  const prevHm = prev.heightMul ?? 1;
  const prevSl = prev.snowLine01 ?? 1;
  return {
    from: prev.profile, to: sec.profile, t,
    fromHeightMul: prevHm, toHeightMul: hm, fromSnowLine01: prevSl, toSnowLine01: sl,
  };
}
