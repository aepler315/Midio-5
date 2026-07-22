// Pure math for what lives on/over the far ocean: islands, drifting ships,
// sea life (fish leaps, dolphin pods, whale spouts), a rare surfacing sea
// monster, and occasional tsunami walls that sweep across the wave field.
// No canvas here -- BiomeManager consumes these, tests exercise them
// directly. Everything is seeded and deterministic per song, following the
// same shape as MeteorShower/SkyEnsemble/FarVignettes: schedules built once
// at construction, pure placement/shape functions evaluated per frame.
import { clamp01, mulberry32, hashSeed } from '../utils/math.js';

// World-x positions for islands/ships live in a periodic wrap space so a
// handful of features can be scattered "out there" without needing an
// unbounded seeded stream -- the same feature reappears every WRAP_PX of
// scroll, far enough apart (several screens) that the repeat never reads.
export const OCEAN_LIFE_WRAP_PX = 7000;
export const OCEAN_LIFE_RATIO = 0.06; // parallax: slower than L2 (0.10) but visibly scrolling -- it's ON the far water

/** Wrap `x0 - scroll` into (-WRAP/2, WRAP/2], the signed offset from the
 *  viewport-relative origin -- negative means "already behind/left". */
export function wrappedOffset(x0, scroll, wrap = OCEAN_LIFE_WRAP_PX) {
  let d = (x0 - scroll) % wrap;
  if (d <= -wrap / 2) d += wrap;
  if (d > wrap / 2) d -= wrap;
  return d;
}

/** Seeded island placements: {x0, rowFrac, w, h, kind, beacon}. rowFrac 0
 *  (nearest) .. 1 (at the horizon) matches Ocean.js's row convention. */
export function islands(seed, count = 3) {
  const rand = mulberry32(seed >>> 0);
  const out = [];
  const KINDS = ['cone', 'mesa', 'palm'];
  for (let i = 0; i < count; i++) {
    out.push({
      x0: (i + rand()) * (OCEAN_LIFE_WRAP_PX / count),
      rowFrac: 0.25 + rand() * 0.6,
      w: 40 + rand() * 70,
      h: 10 + rand() * 12,
      kind: KINDS[Math.floor(rand() * KINDS.length)],
      beacon: rand() < 0.35,
    });
  }
  return out;
}

/** Seeded slow-drifting ships: {x0, rowFrac, driftPxS, size}. */
export function ships(seed, count = 2) {
  const rand = mulberry32(seed >>> 0);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x0: (i + 0.5 + rand()) * (OCEAN_LIFE_WRAP_PX / count),
      rowFrac: 0.15 + rand() * 0.45, // ships stay closer than islands
      driftPxS: (rand() < 0.5 ? -1 : 1) * (2 + rand() * 3),
      size: 0.7 + rand() * 0.6,
    });
  }
  return out;
}

/** Sorted seeded sea-life events across the song: {tMs, kind, u, rowFrac}.
 *  u is a fixed 0..1 horizontal placement (fraction of screen width at the
 *  moment it plays), kind one of 'fish'|'pod'|'spout'. Spaced 8-20s apart. */
export function seaLifeSchedule(seed, durationMs, opts = {}) {
  const rand = mulberry32(seed >>> 0);
  const minGap = opts.minGapMs ?? 8000, maxGap = opts.maxGapMs ?? 20000;
  const KINDS = ['fish', 'pod', 'spout'];
  const DUR = { fish: 900, pod: 4000, spout: 2500 };
  const out = [];
  let t = minGap * 0.5 + rand() * minGap;
  while (t < durationMs - 1000) {
    const kind = KINDS[Math.floor(rand() * KINDS.length)];
    out.push({ tMs: t, kind, durMs: DUR[kind], u: 0.1 + rand() * 0.8, rowFrac: 0.2 + rand() * 0.55 });
    t += minGap + rand() * (maxGap - minGap);
  }
  return out;
}

/** Rare sea-monster surfacing events: {tMs, durMs, u}. 1-2 per song, kept
 *  well clear of the very start/end, gap enforced between them. */
export function monsterSchedule(seed, durationMs, opts = {}) {
  const rand = mulberry32(seed >>> 0);
  const margin = opts.marginMs ?? 20000;
  const minGap = opts.minGapMs ?? 45000;
  const durMs = opts.durMs ?? 7000;
  const usable = durationMs - 2 * margin;
  if (usable <= 0) return [];
  const count = usable > minGap ? (rand() < 0.5 ? 2 : 1) : 1;
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < 50) {
    const tMs = margin + rand() * usable;
    if (out.every((e) => Math.abs(e.tMs - tMs) >= minGap)) out.push({ tMs, durMs, u: 0.2 + rand() * 0.6 });
  }
  out.sort((a, b) => a.tMs - b.tMs);
  return out;
}

/** 1-2 tsunami walls, anchored near the song's highest-energy moments
 *  (jittered) when hotspots are supplied, else spread seeded fallback. */
export function tsunamiSchedule(seed, durationMs, hotspotMs = []) {
  const rand = mulberry32(seed >>> 0);
  const count = hotspotMs.length > 0 ? Math.min(2, hotspotMs.length) : (rand() < 0.5 ? 2 : 1);
  const out = [];
  for (let i = 0; i < count; i++) {
    const base = hotspotMs.length > 0
      ? hotspotMs[i % hotspotMs.length]
      : durationMs * (0.3 + i * 0.35);
    const tMs = clamp01((base + (rand() - 0.5) * 4000) / durationMs) * durationMs;
    out.push({ tMs, dir: rand() < 0.5 ? 1 : -1 });
  }
  out.sort((a, b) => a.tMs - b.tMs);
  return out;
}

export const TSUNAMI_SWEEP_MS = 6000; // a rolling swell, not a sliding cutout
export const TSUNAMI_WIDTH_PX = 260;

/** The wall's leading-edge x at `nowMs`, sweeping fully across a canvas of
 *  width `w` over TSUNAMI_SWEEP_MS, direction `event.dir` (+1 left-to-right,
 *  -1 the reverse). Returns null once the sweep has finished. */
export function tsunamiX(event, nowMs, w) {
  const age = nowMs - event.tMs;
  const half = TSUNAMI_SWEEP_MS / 2;
  if (age < -half || age > half) return null;
  const u = (age + half) / TSUNAMI_SWEEP_MS; // 0..1
  const span = w + TSUNAMI_WIDTH_PX * 2;
  return event.dir >= 0 ? -TSUNAMI_WIDTH_PX + u * span : w + TSUNAMI_WIDTH_PX - u * span;
}

/** Falloff (0..1) of the tsunami's surge at horizontal distance `dx` (px)
 *  from the wall's leading edge -- 1 at the wall, tapering over one wall
 *  width, zero beyond it. Always bounded and finite. */
export function tsunamiLift(dx) {
  const d = Math.abs(dx);
  if (d >= TSUNAMI_WIDTH_PX) return 0;
  return clamp01(1 - d / TSUNAMI_WIDTH_PX);
}

/** Vertical profile (0..1) of the wave-wall silhouette across its own
 *  width, s in [-1,1] (0 = leading edge): a tall curl with a foam tip just
 *  past the edge, settling behind it. */
export function tsunamiProfile(s) {
  const c = clamp01((s + 1) / 2);
  // Sharp rise just ahead of the edge (s slightly negative == behind the
  // direction of travel in our -1..1 parametrization), curling tip at s~0.15.
  const rise = Math.exp(-((c - 0.55) ** 2) / 0.02);
  const settle = clamp01(1 - Math.max(0, c - 0.55) * 1.6);
  return clamp01(Math.max(rise, settle * 0.35));
}

/** Seeded spray-fleck descriptors riding just above the tsunami's crest --
 *  {sOff (position along the wall's own -1..1 profile axis), riseFrac (how
 *  far above the crest line, 0..1 of wall height), phase}. Pure/deterministic
 *  so the same wall always throws the same spray. */
export function sprayFlecks(seed, count = 7) {
  const rand = mulberry32(seed >>> 0);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ sOff: -0.25 + rand() * 0.7, riseFrac: 0.15 + rand() * 0.55, phase: rand() * Math.PI * 2 });
  }
  return out;
}

/** Height (px, >=0) of a fish's leap arc at progress u in [0,1]. */
export function fishArcY(u) {
  const c = clamp01(u);
  return 26 * Math.sin(c * Math.PI);
}

/** Vertical offset (px) of the sea monster's Nth trailing hump at body
 *  position u in [0,1] (0=head) and a per-hump phase. */
export function serpentHumpY(u, phase) {
  return 10 * Math.sin(u * Math.PI * 4 + phase);
}
