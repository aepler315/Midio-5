// A Mario Paint-composer-style staff strip across the top of the screen:
// the actual NoteEvent timeline laid out as chunky pixel icons on a cream
// paper staff, four bars to a "page", with a red playhead sweeping left to
// right and flipping to the next page at the bar -- exactly how the SNES
// composer read its sheet. Icons pop (scale bounce) the moment the
// playhead crosses them. Icon language: kick = Midio's wheel, other
// percussion = a drum, melody = star, bass = heart, pad = flower. All
// sprites are original 9x9 pixel grids rendered to tiny offscreen
// canvases once, lazily, so the constructor stays DOM-free for tests.
import { Role } from '../core/NoteEvent.js';
import { clamp } from '../utils/math.js';

const PAGE_BARS = 4;
const MAX_ICONS_PER_PAGE = 64;
const MIN_VEL = 0.15;
const STAFF_ROWS = 11; // 5 lines + 4 spaces + one step above/below
const CELL_PX = 2;

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

    // Pitch range for staff placement, percentile-clipped like Midasus.
    const pitches = timeline.map((e) => e.pitch).sort((a, b) => a - b);
    this.pMin = pitches.length ? pitches[Math.floor(0.05 * pitches.length)] : 48;
    this.pMax = pitches.length ? pitches[Math.min(pitches.length - 1, Math.floor(0.95 * pitches.length))] : 84;
    if (this.pMax <= this.pMin) this.pMax = this.pMin + 12;

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

  /** Staff row (0 = top step, STAFF_ROWS-1 = bottom) from pitch -- quantized like sheet notation. */
  staffRow(pitch) {
    const t = clamp((pitch - this.pMin) / (this.pMax - this.pMin), 0, 1);
    return Math.round((1 - t) * (STAFF_ROWS - 1));
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
    const x0 = 104, y0 = 10;
    const w = canvas.width - x0 - 12, h = 66;
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

    // Staff: 5 lines on the even rows of the middle of the strip.
    const staffTop = y0 + 12, staffBottom = y0 + h - 12;
    const rowH = (staffBottom - staffTop) / (STAFF_ROWS - 1);
    ctx.strokeStyle = 'rgba(120,95,70,0.45)';
    ctx.lineWidth = 1;
    for (let line = 0; line < 5; line++) {
      const y = staffTop + (1 + line * 2) * rowH;
      ctx.beginPath(); ctx.moveTo(x0 + 8, y); ctx.lineTo(x0 + w - 8, y); ctx.stroke();
    }
    // Beat ticks: one per beat, taller at the bar.
    const beats = PAGE_BARS * 4;
    for (let b = 0; b <= beats; b++) {
      const x = x0 + 8 + (b / beats) * (w - 16);
      const isBar = b % 4 === 0;
      ctx.strokeStyle = isBar ? 'rgba(120,95,70,0.5)' : 'rgba(120,95,70,0.22)';
      ctx.beginPath(); ctx.moveTo(x, staffTop + (isBar ? 0 : rowH * 2)); ctx.lineTo(x, staffBottom - (isBar ? 0 : rowH * 2)); ctx.stroke();
    }

    // Hold bars: the slice of each hold note crossing this page, on the
    // kick's staff row — press at the left edge, ride to the right.
    if (this.holds.length) {
      const pageEnd = pageStart + this.pageMs;
      for (const hd of this.holds) {
        if (hd.endMs <= pageStart || hd.tMs >= pageEnd) continue;
        const fa = Math.max(0, (hd.tMs - pageStart) / this.pageMs);
        const fb = Math.min(1, (hd.endMs - pageStart) / this.pageMs);
        const xa = x0 + 8 + fa * (w - 16);
        const xb = x0 + 8 + fb * (w - 16);
        const y = staffTop + this.staffRow(36) * rowH;
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
      const y = staffTop + this.staffRow(evt.pitch) * rowH;
      const dt = nowMs - evt.tMs;
      const pop = popBump(dt);
      const scaleIn = Math.min(1, pageAge / 90); // page flip: icons snap in fresh
      const scale = (0.85 + 0.35 * evt.vel + 0.5 * pop) * scaleIn;
      const img = this._iconCanvases[iconFor(evt)];
      const s = img.width * scale;
      ctx.globalAlpha = dt > 0 && pop < 0.05 ? 0.78 : 1; // already-played notes rest dimmer
      ctx.drawImage(img, Math.round(x - s / 2), Math.round(y - s / 2), s, s);
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
