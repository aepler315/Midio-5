// Builds the player tap chart at three densities from a song's timeline +
// tempo. Vertical bars on the note highway are driven by this chart; Midio's
// automatic jumps still come from kick events (JumpController), so jump-
// related taps (kind === 'jump') are timed to the same kick onsets.
//
// Densities:
//   easy   — quarter-note metronome (1 2 3 4)
//   medium — bass-drum (kick) hits ∪ quarter notes
//   hard   — excited dual-thumb density: kicks + 16th-note grid filled
//            around kick drive and any rhythm onsets (dense in-rhythm tapping)
import { Role } from '../core/NoteEvent.js';

export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);

/** @typedef {'beat'|'kick'|'drive'} TapKind */
/** @typedef {{ tMs: number, vel: number, kind: TapKind, isJump: boolean }} TapNote */

/**
 * @param {object} opts
 * @param {import('../core/NoteEvent.js').NoteEvent[]} opts.timeline
 * @param {{ms:number}[]} [opts.barGrid]
 * @param {number} [opts.bpm]
 * @param {number} [opts.beatPeriodMs]
 * @param {number} [opts.durationMs]
 * @param {'easy'|'medium'|'hard'} [opts.difficulty]
 * @returns {TapNote[]}
 */
export function buildTapChart({
  timeline = [],
  barGrid = [],
  bpm = 120,
  beatPeriodMs = null,
  durationMs = 0,
  difficulty = 'medium',
} = {}) {
  const beatMs = beatPeriodMs || (60000 / (bpm || 120));
  const duration = durationMs || (timeline.length ? timeline[timeline.length - 1].tMs + 1000 : 0);
  const kicks = extractKicks(timeline);
  const rhythm = extractRhythm(timeline);
  const quarters = buildQuarterGrid(barGrid, beatMs, duration, kicks);

  let notes;
  switch (difficulty) {
    case 'easy':
      notes = quarters.map((t) => makeTap(t, 0.7, 'beat', kickNear(kicks, t, 40)));
      break;
    case 'medium':
      notes = mergeTaps([
        quarters.map((t) => makeTap(t, 0.7, 'beat', false)),
        kicks.map((k) => makeTap(k.tMs, k.vel, 'kick', true)),
      ]);
      break;
    case 'hard':
    default:
      notes = buildHardChart(quarters, kicks, rhythm, beatMs, duration);
      break;
  }

  // Tag any remaining notes that land on a kick as jump notes so the highway
  // can draw them as the Midio-aligned jump targets.
  for (const n of notes) {
    if (!n.isJump && kickNear(kicks, n.tMs, 35)) n.isJump = true;
  }
  return notes;
}

function makeTap(tMs, vel, kind, isJump) {
  return {
    tMs,
    vel: Math.max(0.15, Math.min(1, vel)),
    kind,
    isJump: !!isJump,
  };
}

function extractKicks(timeline) {
  return timeline
    .filter((e) => e.role === Role.RHYTHM && e.kick)
    .map((e) => ({ tMs: e.tMs, vel: e.vel ?? 0.8 }))
    .sort((a, b) => a.tMs - b.tMs);
}

function extractRhythm(timeline) {
  return timeline
    .filter((e) => e.role === Role.RHYTHM)
    .map((e) => ({ tMs: e.tMs, vel: e.vel ?? 0.6, kick: !!e.kick }))
    .sort((a, b) => a.tMs - b.tMs);
}

/**
 * Quarter-note grid: prefer barGrid (true downbeats) and subdivide each bar
 * into 4 beats; fall back to a free-running grid from the first kick (or 0).
 */
export function buildQuarterGrid(barGrid, beatMs, durationMs, kicks = []) {
  const out = [];
  if (barGrid && barGrid.length > 0) {
    for (let i = 0; i < barGrid.length; i++) {
      const start = barGrid[i].ms;
      const next = i + 1 < barGrid.length ? barGrid[i + 1].ms : start + beatMs * 4;
      const localBeat = Math.max(80, (next - start) / 4);
      for (let b = 0; b < 4; b++) {
        const t = start + b * localBeat;
        if (t <= durationMs + 1) out.push(t);
      }
    }
    return dedupeTimes(out, 20);
  }

  const origin = kicks.length ? kicks[0].tMs : 0;
  // Walk backwards to t≈0 so early lead-in beats still appear.
  let t0 = origin;
  while (t0 - beatMs >= -beatMs * 0.25) t0 -= beatMs;
  for (let t = t0; t <= durationMs + 1; t += beatMs) {
    if (t >= -1) out.push(t);
  }
  return dedupeTimes(out, 20);
}

/**
 * Hard density: excited dual-thumb feel.
 * - Always include every kick (jump targets).
 * - Always include every detected rhythm onset (hats/snares/kicks).
 * - Fill 16th-note grid slots within ±1 beat of any kick (rolling 16ths
 *   through the bass-drive sections).
 * - Keep quarter notes as an underlying pulse when the section is sparse.
 */
function buildHardChart(quarters, kicks, rhythm, beatMs, durationMs) {
  const sixteenth = beatMs / 4;
  const driveSlots = new Set();

  for (const k of kicks) {
    // ±1 beat of 16ths around each kick — dense when kicks cluster.
    const lo = k.tMs - beatMs;
    const hi = k.tMs + beatMs;
    for (let t = quantize(lo, sixteenth); t <= hi + 0.5; t += sixteenth) {
      if (t >= 0 && t <= durationMs) driveSlots.add(Math.round(t));
    }
  }

  // Also seed drive from non-kick rhythm (16th-ish hi-hat/snare patterns).
  for (const r of rhythm) {
    if (r.kick) continue;
    const q = Math.round(quantize(r.tMs, sixteenth));
    if (q >= 0 && q <= durationMs) driveSlots.add(q);
  }

  const taps = [
    ...kicks.map((k) => makeTap(k.tMs, k.vel, 'kick', true)),
    ...rhythm.filter((r) => !r.kick).map((r) => makeTap(r.tMs, r.vel * 0.85, 'drive', false)),
    ...[...driveSlots].map((t) => makeTap(t, 0.55, 'drive', false)),
    ...quarters.map((t) => makeTap(t, 0.65, 'beat', false)),
  ];
  return mergeTaps([taps]);
}

/** Merge sorted tap lists, coalescing notes within `tolMs`. Prefer kick/jump. */
export function mergeTaps(lists, tolMs = 28) {
  const all = lists.flat().sort((a, b) => a.tMs - b.tMs || kindRank(b) - kindRank(a));
  if (all.length === 0) return [];
  const out = [all[0]];
  for (let i = 1; i < all.length; i++) {
    const prev = out[out.length - 1];
    const cur = all[i];
    if (Math.abs(cur.tMs - prev.tMs) <= tolMs) {
      // Keep the higher-priority kind; max velocity; jump flag ORs.
      if (kindRank(cur) > kindRank(prev)) {
        prev.kind = cur.kind;
      }
      prev.vel = Math.max(prev.vel, cur.vel);
      prev.isJump = prev.isJump || cur.isJump;
      // Snap time toward kick when either is a jump.
      if (cur.isJump) prev.tMs = cur.tMs;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

function kindRank(n) {
  if (n.kind === 'kick' || n.isJump) return 3;
  if (n.kind === 'drive') return 2;
  return 1;
}

function kickNear(kicks, tMs, tolMs) {
  // Binary search nearest kick.
  let lo = 0, hi = kicks.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (kicks[m].tMs < tMs) lo = m + 1;
    else hi = m - 1;
  }
  for (const i of [lo, lo - 1]) {
    if (i >= 0 && i < kicks.length && Math.abs(kicks[i].tMs - tMs) <= tolMs) return true;
  }
  return false;
}

function quantize(t, step) {
  return Math.round(t / step) * step;
}

export function dedupeTimes(times, tolMs = 20) {
  if (!times.length) return [];
  const sorted = [...times].sort((a, b) => a - b);
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - out[out.length - 1] > tolMs) out.push(sorted[i]);
  }
  return out;
}
