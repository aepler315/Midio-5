// A Mario Paint-composer-style staff strip across the bottom of the screen:
// the actual NoteEvent timeline laid out as chunky pixel icons on a cream
// paper staff, four bars to a "page", with a red playhead sweeping left to
// right and flipping to the next page at the bar -- exactly how the SNES
// composer read its sheet. Icons pop (scale bounce) the moment the
// playhead crosses them. Icon language: kick = Midio's wheel, other
// percussion = a drum, melody = star, bass = heart, pad = flower. All
// sprites are original 9x9 pixel grids rendered to tiny offscreen
// canvases once, lazily, so the constructor stays DOM-free for tests.
//
// Pitch placement is real diatonic sheet-music notation, not a flattened
// percentile stretch: each pitch resolves to a scale degree (relative to
// the song's estimated tonic) via diatonicIndex, so C < D < E always sit
// in ascending staff order and an accidental gets its own tick. Percussion
// (RHYTHM role) never shares the pitch staff -- GM drum pitches are
// arbitrary, not musical -- it gets its own single rail along the bottom
// edge.
import { Role } from '../core/NoteEvent.js';
import { clamp } from '../utils/math.js';

const PAGE_BARS = 4;
const MAX_ICONS_PER_PAGE = 64;
const MIN_VEL = 0.15;
export const STAFF_ROWS = 13; // 5 lines + spaces, plus ledger room above/below
const CELL_PX = 2;

// Semitone (0-11, relative to the tonic pitch class) -> [diatonic degree
// 0-6, accidental]. Degrees are non-decreasing across 0..11, so pitch and
// diatonic step stay in lockstep -- ascending pitch always means ascending
// (or equal, on an accidental) step.
const SEMITONE_TABLE = [
  [0, false], [0, true], [1, false], [1, true], [2, false], [3, false],
  [3, true], [4, false], [4, true], [5, false], [5, true], [6, false],
];

/** Weighted (durMs * vel) pitch-class histogram over non-percussion notes;
 *  the argmax is the estimated tonic. Empty/all-percussion input -> C (0). */
export function estimateTonicPc(timeline) {
  const weight = new Array(12).fill(0);
  let any = false;
  for (const evt of timeline) {
    if (evt.role === Role.RHYTHM) continue;
    const pc = ((evt.pitch % 12) + 12) % 12;
    weight[pc] += (evt.durMs || 90) * Math.max(0.05, evt.vel ?? 0.5);
    any = true;
  }
  if (!any) return 0;
  let best = 0;
  for (let pc = 1; pc < 12; pc++) if (weight[pc] > weight[best]) best = pc;
  return best;
}

/** Absolute MIDI pitch -> { step, accidental } relative to tonicPc: step is
 *  a diatonic scale-degree index (octave*7 + degree), monotone
 *  non-decreasing in pitch; accidental marks a note that isn't in the
 *  tonic's major scale. Pure. */
export function diatonicIndex(pitch, tonicPc) {
  const rel = pitch - tonicPc;
  const octave = Math.floor(rel / 12);
  const semitone = rel - octave * 12; // 0..11
  const [degree, accidental] = SEMITONE_TABLE[semitone];
  return { step: octave * 7 + degree, accidental };
}

// 9x9 sprite grids: 0 transparent, 1 fill, 2 shade.
const SPRITES = {
  star: {
    color: '#ffd23e', shade: '#c9931a',
    grid: [
      '000010000', '000111000', '000111000', '111111111', '011111110',
      '001111100', '011101110', '011000110', '010000010',
    ],
  },
  heart: {
    color: '#ff5d7e', shade: '#c22b4e',
    grid: [
      '011000110', '111102111', '111111111', '111111111', '011111110',
      '001111100', '000111000', '000010000', '000000000',
    ],
  },
  flower: {
    color: '#c77dff', shade: '#8a43cc',
    grid: [
      '001101100', '011111110', '011121110', '111222111', '011121110',
      '001111100', '000101000', '000010000', '000000000',
    ],
  },
  wheel: {
    color: '#ffb43a', shade: '#c97a12',
    grid: [
      '001111100', '010010010', '100010001', '100010001', '111111111',
      '100010001', '100010001', '010010010', '001111100',
    ],
  },
  drum: {
    color: '#4fd8c4', shade: '#1f9a89',
    grid: [
      '000000000', '011111110', '112222211', '111111111', '110111011',
      '110111011', '011111110', '000000000', '000000000',
    ],
  },
};

export function iconFor(evt) {
  if (evt.role === Role.RHYTHM) return evt.kick ? 'wheel' : 'drum';
  if (evt.role === Role.MELODY) return 'star';
  if (evt.role === Role.BASS) return 'heart';
  return 'flower'; // PAD and anything else
}

/** Gaussian pop bump around the onset: 1 at the hit, ~0 outside +-120ms. */
export function popBump(dtMs) {
  const u = (dtMs - 30) / 80;
  return dtMs > -80 && dtMs < 200 ? Math.exp(-u * u) : 0;
}

/**
 * Cap a dense page at `cap` icons WITHOUT losing temporal coverage. A plain
 * "loudest first" slice breaks on real MIDIs: velocity rescaling clamps the
 * top 5% of notes to exactly 1.0 (quantized files put EVERY note there), the
 * sort is stable, so equal velocities keep time order and the slice keeps
 * only the page's first `cap` notes — the strip then shows notes only in
 * the first half (or less) of its viewport. Instead: divide the page into
 * time slots, sort each slot loudest-first, and take rounds of one-per-slot
 * until the budget is spent — every part of the page keeps its loudest
 * material, and the full width stays populated.
 */
export function stratifyCap(events, cap, pageStartMs, pageMs, slots = 32) {
  if (events.length <= cap) return events;
  const buckets = Array.from({ length: slots }, () => []);
  for (const evt of events) {
    const s = clamp(Math.floor(((evt.tMs - pageStartMs) / pageMs) * slots), 0, slots - 1);
    buckets[s].push(evt);
  }
  for (const b of buckets) b.sort((a, c) => c.vel - a.vel);
  const kept = [];
  for (let round = 0; kept.length < cap; round++) {
    let took = 0;
    for (const b of buckets) {
      if (round < b.length && kept.length < cap) { kept.push(b[round]); took++; }
    }
    if (took === 0) break;
  }
  return kept.sort((a, b) => a.tMs - b.tMs);
}

export class ComposerStrip {
  constructor(timeline, barGrid, durationMs, holds = []) {
    // Hold-note spans (player rhythm layer): painted as bars behind the
    // icons so an upcoming press-and-hold is readable a full page ahead.
    this.holds = holds;
    // Page length: four median bars (robust to the odd tempo hiccup).
    let barMs = 2000;
    if (barGrid && barGrid.length >= 2) {
      const gaps = [];
      for (let i = 1; i < barGrid.length; i++) gaps.push(barGrid[i].ms - barGrid[i - 1].ms);
      gaps.sort((a, b) => a - b);
      barMs = gaps[Math.floor(gaps.length / 2)] || 500;
    } else {
      barMs = 500;
    }
    this.pageMs = PAGE_BARS * barMs;
    this.barMs = barMs;
    this.durationMs = durationMs;

    // Diatonic staff placement: estimate the song's tonic, then clip the
    // (non-percussion) pitch range to its 5th-95th percentile the way
    // Midasus does, converted into diatonic steps so the staff centers on
    // the song's own melodic range rather than an arbitrary fixed span.
    this.tonicPc = estimateTonicPc(timeline);
    const pitches = timeline.filter((e) => e.role !== Role.RHYTHM).map((e) => e.pitch).sort((a, b) => a - b);
    const pMin = pitches.length ? pitches[Math.floor(0.05 * pitches.length)] : 48;
    let pMax = pitches.length ? pitches[Math.min(pitches.length - 1, Math.floor(0.95 * pitches.length))] : 84;
    if (pMax <= pMin) pMax = pMin + 12;
    const sMin = diatonicIndex(pMin, this.tonicPc).step;
    const sMax = diatonicIndex(pMax, this.tonicPc).step;
    this.sMid = Math.round((sMin + sMax) / 2);

    // Bucket notes into pages, loudest-first capped, then back in time order.
    this.pages = [];
    for (const evt of timeline) {
      if (evt.vel < MIN_VEL) continue;
      const p = Math.floor(evt.tMs / this.pageMs);
      (this.pages[p] ||= []).push(evt);
    }
    for (let p = 0; p < this.pages.length; p++) {
      if (!this.pages[p]) { this.pages[p] = []; continue; }
      if (this.pages[p].length > MAX_ICONS_PER_PAGE) {
        this.pages[p] = stratifyCap(this.pages[p], MAX_ICONS_PER_PAGE, p * this.pageMs, this.pageMs);
      }
    }

    this._iconCanvases = null; // built lazily in the browser
  }

  pageIndexAt(nowMs) { return Math.max(0, Math.floor(nowMs / this.pageMs)); }
  playheadFrac(nowMs) { return (((nowMs % this.pageMs) + this.pageMs) % this.pageMs) / this.pageMs; }

  /** Staff row (0 = top step, STAFF_ROWS-1 = bottom) from pitch: one row per
   *  diatonic step, centered on the song's median step -- real sheet-music
   *  ordering (C < D < E always ascend), clamped/ledgered at the edges. */
  staffRow(pitch) {
    return this.rowInfo(pitch).row;
  }

  /** Full placement for a pitch: the clamped staff row, whether it's an
   *  accidental (off the tonic's major scale), and whether it fell outside
   *  the drawn staff (needs a ledger mark). */
  rowInfo(pitch) {
    const { step, accidental } = diatonicIndex(pitch, this.tonicPc);
    const rawRow = (STAFF_ROWS - 1) / 2 + (this.sMid - step);
    const row = clamp(Math.round(rawRow), 0, STAFF_ROWS - 1);
    const ledger = rawRow < 0 || rawRow > STAFF_ROWS - 1;
    return { row, accidental, ledger };
  }

  _ensureIcons() {
    if (this._iconCanvases) return;
    this._iconCanvases = {};
    for (const [name, spec] of Object.entries(SPRITES)) {
      const c = document.createElement('canvas');
      c.width = 9 * CELL_PX; c.height = 9 * CELL_PX;
      const g = c.getContext('2d');
      for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 9; x++) {
          const v = spec.grid[y][x];
          if (v === '0') continue;
          g.fillStyle = v === '2' ? spec.shade : spec.color;
          g.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
        }
      }
      this._iconCanvases[name] = c;
    }
  }

  draw(ctx, canvas, nowMs) {
    this._ensureIcons();
    const x0 = 104;
    const h = 72;
    const y0 = canvas.height - h - 12; // bottom-anchored, clear of the ground HUD
    const w = canvas.width - x0 - 12;
    const page = this.pages[this.pageIndexAt(nowMs)] || [];
    const pageStart = this.pageIndexAt(nowMs) * this.pageMs;
    const pageAge = nowMs - pageStart;

    ctx.save();
    // Paper.
    ctx.fillStyle = 'rgba(250,245,228,0.90)';
    ctx.strokeStyle = 'rgba(90,70,50,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, h, 8);
    ctx.fill();
    ctx.stroke();

    // Staff: pitched rows on top, a single percussion rail along the
    // bottom edge (8px) so GM drum pitches never pollute the pitch staff.
    const railY = y0 + h - 10;
    const staffTop = y0 + 10, staffBottom = railY - 12;
    const rowH = (staffBottom - staffTop) / (STAFF_ROWS - 1);
    ctx.strokeStyle = 'rgba(120,95,70,0.45)';
    ctx.lineWidth = 1;
    for (const line of [2, 4, 6, 8, 10]) {
      const y = staffTop + line * rowH;
      ctx.beginPath(); ctx.moveTo(x0 + 8, y); ctx.lineTo(x0 + w - 8, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(120,95,70,0.28)';
    ctx.beginPath(); ctx.moveTo(x0 + 8, railY); ctx.lineTo(x0 + w - 8, railY); ctx.stroke();

    // Beat ticks: one per beat, taller at the bar.
    const beats = PAGE_BARS * 4;
    for (let b = 0; b <= beats; b++) {
      const x = x0 + 8 + (b / beats) * (w - 16);
      const isBar = b % 4 === 0;
      ctx.strokeStyle = isBar ? 'rgba(120,95,70,0.5)' : 'rgba(120,95,70,0.22)';
      ctx.beginPath(); ctx.moveTo(x, staffTop + (isBar ? 0 : rowH * 2)); ctx.lineTo(x, staffBottom - (isBar ? 0 : rowH * 2)); ctx.stroke();
    }

    // Hold bars: the slice of each hold note crossing this page, on their
    // (fallback, hold spans carry no pitch) row — press at the left edge,
    // ride to the right.
    if (this.holds.length) {
      const pageEnd = pageStart + this.pageMs;
      for (const hd of this.holds) {
        if (hd.endMs <= pageStart || hd.tMs >= pageEnd) continue;
        const fa = Math.max(0, (hd.tMs - pageStart) / this.pageMs);
        const fb = Math.min(1, (hd.endMs - pageStart) / this.pageMs);
        const xa = x0 + 8 + fa * (w - 16);
        const xb = x0 + 8 + fb * (w - 16);
        const y = staffTop + this.staffRow(hd.pitch ?? 36) * rowH;
        ctx.fillStyle = 'rgba(255,180,58,0.34)';
        ctx.strokeStyle = 'rgba(255,180,58,0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(xa, y - 7, Math.max(6, xb - xa), 14, 7);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Icons.
    for (const evt of page) {
      const fx = (evt.tMs - pageStart) / this.pageMs;
      const x = x0 + 8 + fx * (w - 16);
      const isRhythm = evt.role === Role.RHYTHM;
      const info = isRhythm ? null : this.rowInfo(evt.pitch);
      const y = isRhythm ? railY : staffTop + info.row * rowH;
      const dt = nowMs - evt.tMs;
      const pop = popBump(dt);
      const scaleIn = Math.min(1, pageAge / 90); // page flip: icons snap in fresh
      const scale = (0.85 + 0.35 * evt.vel + 0.5 * pop) * scaleIn;
      const img = this._iconCanvases[iconFor(evt)];
      const s = img.width * scale;
      ctx.globalAlpha = dt > 0 && pop < 0.05 ? 0.78 : 1; // already-played notes rest dimmer
      if (info && info.ledger) {
        ctx.strokeStyle = 'rgba(90,70,50,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x - s / 2 - 3, y); ctx.lineTo(x + s / 2 + 3, y); ctx.stroke();
      }
      ctx.drawImage(img, Math.round(x - s / 2), Math.round(y - s / 2), s, s);
      if (info && info.accidental) {
        ctx.fillStyle = 'rgba(90,70,50,0.75)';
        ctx.fillRect(x - s / 2 - 5, y - 4, 1.5, 8);
        ctx.fillRect(x - s / 2 - 2.5, y - 4, 1.5, 8);
      }
      if (pop > 0.4) { // a tiny 4-point sparkle right on the hit
        ctx.globalAlpha = pop;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 1, y - s / 2 - 5, 2, 4);
        ctx.fillRect(x - 1, y + s / 2 + 1, 2, 4);
        ctx.fillRect(x - s / 2 - 5, y - 1, 4, 2);
        ctx.fillRect(x + s / 2 + 1, y - 1, 4, 2);
      }
      ctx.globalAlpha = 1;
    }

    // Playhead: the sweeping red bar.
    const px = x0 + 8 + this.playheadFrac(nowMs) * (w - 16);
    ctx.strokeStyle = 'rgba(232,58,58,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(px, y0 + 4); ctx.lineTo(px, y0 + h - 4); ctx.stroke();
    ctx.fillStyle = 'rgba(232,58,58,0.9)';
    ctx.beginPath();
    ctx.moveTo(px - 5, y0 + 4); ctx.lineTo(px + 5, y0 + 4); ctx.lineTo(px, y0 + 11); ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}
