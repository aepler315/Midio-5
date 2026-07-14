// Scrolling vertical-bar note highway (Guitar-Hero-style, but side-scroll).
// Bars enter from the right edge of the stage and glide left; the hit line
// is Midio's screen-x, so a jump-kind bar crosses him exactly when he should
// take off. Pure Canvas 2D, no DOM dependency so unit tests can exercise the
// timing math without a browser.
//
// Screen x for a note at song-time tMs:
//   x = hitX + (tMs - nowMs) * (approachPx / approachMs)
// When nowMs === tMs, x === hitX.

export const DEFAULT_APPROACH_MS = 1600;
export const HIT_WINDOW_PERFECT_MS = 45;
export const HIT_WINDOW_GREAT_MS = 90;
export const HIT_WINDOW_OK_MS = 130;

export class NoteHighway {
  /**
   * @param {import('../sim/TapChart.js').TapNote[]} notes
   * @param {{ approachMs?: number }} [opts]
   */
  constructor(notes = [], { approachMs = DEFAULT_APPROACH_MS } = {}) {
    this.notes = notes;
    this.approachMs = approachMs;
    /** @type {Map<number, 'perfect'|'great'|'ok'|'miss'>} */
    this._judged = new Map(); // note index -> grade
    this._flash = []; // {x, y, grade, untilMs}
    this._cursor = 0; // first not-yet-past note (for miss auto-judge)
  }

  setNotes(notes) {
    this.notes = notes || [];
    this._judged.clear();
    this._flash = [];
    this._cursor = 0;
  }

  /**
   * Horizontal screen position of a note at `nowMs`.
   * @param {number} tMs note time
   * @param {number} nowMs song clock
   * @param {number} hitX Midio screen x (hit line)
   * @param {number} stageW
   */
  noteX(tMs, nowMs, hitX, stageW) {
    const approachPx = Math.max(80, stageW - hitX);
    const pxPerMs = approachPx / this.approachMs;
    return hitX + (tMs - nowMs) * pxPerMs;
  }

  /** Notes currently worth drawing (in approach corridor or just past hit). */
  visibleNotes(nowMs, hitX, stageW) {
    const approachPx = Math.max(80, stageW - hitX);
    const pxPerMs = approachPx / this.approachMs;
    // Extra lead so bars fully enter from off-screen right; trail so they
    // glide off past Midio a bit before despawning.
    const loMs = nowMs - 200;
    const hiMs = nowMs + this.approachMs + 80;
    const out = [];
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.tMs < loMs) continue;
      if (n.tMs > hiMs) break; // notes are sorted
      const x = hitX + (n.tMs - nowMs) * pxPerMs;
      if (x < -40 || x > stageW + 40) continue;
      out.push({ note: n, index: i, x, judged: this._judged.get(i) || null });
    }
    return out;
  }

  /**
   * Attempt to hit the nearest unjudged note within the OK window.
   * @returns {{ grade: string, note: object, index: number, deltaMs: number } | null}
   */
  tryHit(nowMs) {
    let best = null;
    let bestAbs = Infinity;
    for (let i = 0; i < this.notes.length; i++) {
      if (this._judged.has(i)) continue;
      const n = this.notes[i];
      const d = n.tMs - nowMs;
      const ad = Math.abs(d);
      if (ad > HIT_WINDOW_OK_MS) {
        if (n.tMs > nowMs + HIT_WINDOW_OK_MS) break;
        continue;
      }
      if (ad < bestAbs) {
        bestAbs = ad;
        best = { index: i, note: n, deltaMs: d };
      }
    }
    if (!best) return null;
    const grade = gradeForDelta(best.deltaMs);
    this._judged.set(best.index, grade);
    return { grade, note: best.note, index: best.index, deltaMs: best.deltaMs };
  }

  /** Auto-miss notes that slid past the late window without a tap. */
  autoMissPast(nowMs) {
    const misses = [];
    while (this._cursor < this.notes.length) {
      const n = this.notes[this._cursor];
      if (n.tMs > nowMs - HIT_WINDOW_OK_MS) break;
      if (!this._judged.has(this._cursor)) {
        this._judged.set(this._cursor, 'miss');
        misses.push({ index: this._cursor, note: n });
      }
      this._cursor++;
    }
    return misses;
  }

  addFlash(x, y, grade, nowMs) {
    this._flash.push({ x, y, grade, untilMs: nowMs + 280 });
  }

  draw(ctx, canvas, nowMs, hitX, groundY) {
    const stageW = canvas.width;
    const stageH = canvas.height;
    const barTop = 90;
    const barBottom = Math.min(groundY - 20, stageH - 40);
    const barH = barBottom - barTop;

    // Approach lane (subtle).
    ctx.save();
    const laneGrad = ctx.createLinearGradient(hitX, 0, stageW, 0);
    laneGrad.addColorStop(0, 'rgba(255, 215, 106, 0.10)');
    laneGrad.addColorStop(1, 'rgba(255, 215, 106, 0.00)');
    ctx.fillStyle = laneGrad;
    ctx.fillRect(hitX, barTop, stageW - hitX, barH);

    // Hit line at Midio.
    ctx.strokeStyle = 'rgba(255, 246, 207, 0.85)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(hitX, barTop);
    ctx.lineTo(hitX, barBottom);
    ctx.stroke();
    ctx.setLineDash([]);
    // Glow at hit line.
    ctx.strokeStyle = 'rgba(255, 215, 106, 0.35)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(hitX, barTop);
    ctx.lineTo(hitX, barBottom);
    ctx.stroke();

    const visible = this.visibleNotes(nowMs, hitX, stageW);
    for (const { note, x, judged } of visible) {
      drawBar(ctx, x, barTop, barH, note, judged, nowMs);
    }

    // Judgment flashes.
    this._flash = this._flash.filter((f) => f.untilMs > nowMs);
    for (const f of this._flash) {
      const life = (f.untilMs - nowMs) / 280;
      ctx.globalAlpha = life;
      ctx.fillStyle = gradeColor(f.grade);
      ctx.font = 'bold 18px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(gradeLabel(f.grade), f.x, f.y - (1 - life) * 28);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function drawBar(ctx, x, top, h, note, judged, nowMs) {
  const isJump = note.isJump || note.kind === 'kick';
  const width = isJump ? 10 : note.kind === 'drive' ? 5 : 7;
  const vel = note.vel ?? 0.7;
  const height = h * (0.55 + 0.45 * vel) * (isJump ? 1 : 0.82);
  const y0 = top + (h - height);

  let alpha = 0.95;
  if (judged === 'miss') alpha = 0.25;
  else if (judged) alpha = 0.35;

  // Color by kind: jump/kick = gold (Midio), beat = cyan, drive = pink.
  let fill, glow;
  if (isJump) {
    fill = `rgba(255, 215, 106, ${alpha})`;
    glow = `rgba(255, 180, 60, ${0.45 * alpha})`;
  } else if (note.kind === 'drive') {
    fill = `rgba(255, 90, 140, ${alpha})`;
    glow = `rgba(255, 90, 140, ${0.35 * alpha})`;
  } else {
    fill = `rgba(122, 209, 255, ${alpha})`;
    glow = `rgba(122, 209, 255, ${0.35 * alpha})`;
  }

  // Soft glow.
  ctx.fillStyle = glow;
  ctx.fillRect(x - width / 2 - 3, y0 - 2, width + 6, height + 4);

  // Core bar with rounded top.
  ctx.fillStyle = fill;
  ctx.beginPath();
  const r = Math.min(4, width / 2);
  const left = x - width / 2;
  const right = x + width / 2;
  const bottom = y0 + height;
  ctx.moveTo(left, bottom);
  ctx.lineTo(left, y0 + r);
  ctx.quadraticCurveTo(left, y0, left + r, y0);
  ctx.lineTo(right - r, y0);
  ctx.quadraticCurveTo(right, y0, right, y0 + r);
  ctx.lineTo(right, bottom);
  ctx.closePath();
  ctx.fill();

  // Bright tip for jump bars.
  if (isJump && !judged) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.7 * alpha})`;
    ctx.fillRect(x - width / 2, y0, width, 4);
  }

  // Pulse when about to hit.
  const dt = note.tMs - nowMs;
  if (!judged && Math.abs(dt) < 80) {
    const p = 1 - Math.abs(dt) / 80;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 * p})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - width / 2 - 2, y0 - 2, width + 4, height + 4);
  }
}

export function gradeForDelta(deltaMs) {
  const ad = Math.abs(deltaMs);
  if (ad <= HIT_WINDOW_PERFECT_MS) return 'perfect';
  if (ad <= HIT_WINDOW_GREAT_MS) return 'great';
  if (ad <= HIT_WINDOW_OK_MS) return 'ok';
  return 'miss';
}

function gradeColor(grade) {
  switch (grade) {
    case 'perfect': return '#ffd76a';
    case 'great': return '#7ad1ff';
    case 'ok': return '#b9a3ff';
    default: return '#ff5a7a';
  }
}

function gradeLabel(grade) {
  switch (grade) {
    case 'perfect': return 'PERFECT';
    case 'great': return 'GREAT';
    case 'ok': return 'OK';
    default: return 'MISS';
  }
}
