// One squall per song. All envelopes are evaluated at heard time; playback,
// pause, seeking and offline exports share exactly the same weather.
import { rangeCloudBanks, drawRangeClouds } from './RangeSkyComposition.js';
const unit = x => Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
const ease = x => { const t = unit(x); return t * t * (3 - 2 * t); };
const EMPTY_TIMELINE = Object.freeze([]);
const EMPTY = Object.freeze({ amount: 0, flash: 0, break01: 0, wet01: 0 });
export function compileStorm({ energyCurves, sections = [], timeline = [], durationMs = 0 } = {}) {
  if (!(durationMs > 0)) return { section: null, at: () => EMPTY };
  const read = energyCurves?.globalEnergyNorm?.bind(energyCurves) || energyCurves?.globalEnergy?.bind(energyCurves);
  if (!read) return { section: null, at: () => EMPTY };
  const average = (a, b) => {
    if (!read) return 0;
    let sum = 0, n = 0;
    for (let t = a; t < b; t += 250) { sum += unit(read(t)); n++; }
    return sum / Math.max(1, n);
  };
  // Clip away arrival time; do not discard a sustained climax merely
  // because its structural section also contains the song's opening.
  let candidates = sections.filter(s => s.provenance !== 'decorative' && Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs && s.endMs > 8000)
    .map(s => ({ startMs: Math.max(8000, s.startMs), endMs: Math.min(durationMs, s.endMs) })).filter(s => s.endMs > s.startMs);
  // Unsegmented songs still get their strongest sustained passage. The
  // averaging window prevents a short opening/ending transient from winning.
  if (!candidates.length) {
    const span = Math.min(20000, durationMs * .24);
    for (let t = 8000; t + span <= durationMs; t += 1000) candidates.push({ startMs: t, endMs: t + span });
  }
  const scored = candidates.map(section => ({ section, energy: average(section.startMs, section.endMs) }));
  scored.sort((a, b) => b.energy - a.energy || Math.abs((a.section.startMs+a.section.endMs)/2-durationMs*.5)
    - Math.abs((b.section.startMs+b.section.endMs)/2-durationMs*.5));
  const section = scored[0]?.section || { startMs: durationMs * .4, endMs: durationMs * .65 };
  const snares = [];
  for (const event of [...timeline].sort((a, b) => a.tMs - b.tMs)) {
    if (!(event.role === 'RHYTHM' || event.channel === 9) || ![38, 40].includes(event.pitch) || !Number.isFinite(event.tMs) || event.tMs < section.startMs || event.tMs >= section.endMs) continue;
    if (event.tMs - (snares.at(-1)?.tMs ?? -Infinity) >= 700) snares.push({ tMs: event.tMs, amp: unit(event.vel ?? event.velocity ?? .8) });
  }
  return Object.freeze({ section: Object.freeze(section), at(timeMs, { reducedFlash = false } = {}) {
    const t = Number.isFinite(timeMs) ? timeMs : 0, a = section.startMs, b = section.endMs;
    const amount = ease((t - a + 6000) / 8000) * (1 - ease((t - b) / 4000));
    let flash = 0;
    if (!reducedFlash && amount > .2) {
      let lo = 0, hi = snares.length;
      while (lo < hi) { const m = (lo + hi) >>> 1; if (snares[m].tMs <= t) lo = m + 1; else hi = m; }
      const hit = snares[lo - 1], age = hit ? t - hit.tMs : Infinity;
      if (age < 240) flash = hit.amp * (1 - ease(age / 240)) * amount;
    }
    return { amount, flash, break01: ease((t - b - 2000) / 6000) * (1 - ease((t - b - 14000) / 20000)),
      wet01: ease((t - a) / 6000) * (1 - ease((t - b) / 45000)) };
  } });
}
const cache = new WeakMap();
export function stormAt(mgr, timeMs) {
  if (!mgr || mgr.terrainPreview) return EMPTY;
  const timeline = mgr.conductor?.timeline || EMPTY_TIMELINE;
  let hit = cache.get(mgr);
  if (!hit || hit.curves !== mgr.energyCurves || hit.sections !== mgr.sections || hit.timeline !== timeline || hit.durationMs !== mgr.durationMs) {
    hit = { curves: mgr.energyCurves, sections: mgr.sections, timeline, durationMs: mgr.durationMs,
      score: compileStorm({ energyCurves: mgr.energyCurves, sections: mgr.sections, timeline, durationMs: mgr.durationMs }) };
    cache.set(mgr, hit);
  }
  const state = hit.score.at(timeMs, { reducedFlash: !!mgr.reducedFlash });
  const override = mgr.stormOverride;
  if (override && typeof override === 'object') return { ...state, ...override, flash: mgr.reducedFlash ? 0 : unit(override.flash ?? state.flash) };
  return state;
}
/** Behind the terrain passes: cloud-lit lightning and distant rain, never
 * a screen bolt laid over the peaks. The lake's backdrop captures this sky. */
export function drawStormSky(ctx, canvas, storm, { tSec = 0, seed = 0, pan = null, light, reducedMotion = false } = {}) {
  if (!storm || storm.amount < .001) return;
  const { width: w, height: h } = canvas;
  const motion = reducedMotion ? 0 : tSec;
  ctx.save();
  const dark = ctx.createLinearGradient(0, 0, 0, h * .8);
  dark.addColorStop(0, `rgba(9,17,30,${storm.amount * .85})`);
  dark.addColorStop(1, `rgba(21,35,49,${storm.amount * .25})`);
  ctx.fillStyle = dark; ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = storm.amount;
  const banks = rangeCloudBanks({ width: w, height: h, tSec: motion * .4, seed: seed % 9973, panPx: (pan?.x || 0) * w / 2, panYPx: -(pan?.y || 0) * h / 2 });
  drawRangeClouds(ctx, banks, { dark: [12, 22, 36], lit: [65 + storm.flash * 150, 77 + storm.flash * 155, 95 + storm.flash * 155], light,
    directGain: .5 + storm.flash * 2.5 });
  // Broad curtains of precipitation with softened edges, behind all land.
  for (let i = 0; i < 7; i++) {
    const x = ((i * .173 + seed * .000017 + motion * .002) % 1.35 - .18) * w;
    const curtain = ctx.createLinearGradient(x, h * .24, x + w * .025, h * .8);
    curtain.addColorStop(0, 'rgba(115,135,153,0)');
    curtain.addColorStop(.25, `rgba(115,135,153,${.17 + storm.flash * .18})`);
    curtain.addColorStop(1, 'rgba(115,135,153,0)');
    ctx.fillStyle = curtain;
    ctx.beginPath(); ctx.moveTo(x, h * .24); ctx.lineTo(x + w * .14, h * .28);
    ctx.lineTo(x + w * .06, h * .84); ctx.lineTo(x - w * .09, h * .8); ctx.closePath(); ctx.fill();
  }
  if (storm.flash > .001) {
    const flash = ctx.createRadialGradient(w * .57, h * .23, 0, w * .57, h * .23, w * .36);
    flash.addColorStop(0, `rgba(196,213,245,${storm.flash * .72})`); flash.addColorStop(1, 'rgba(196,213,245,0)');
    ctx.fillStyle = flash; ctx.fillRect(0, 0, w, h * .7);
  }
  ctx.restore();
}
