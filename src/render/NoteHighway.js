// Scrolling vertical-bar note highway (Guitar-Hero-style, but side-scroll).
// Bars enter from the right edge of the stage and glide left; the hit line
// is Midio's screen-x, so a jump-kind bar crosses him exactly when he should
// take off. Pure Canvas 2D, no DOM dependency so unit tests can exercise the
// timing math without a browser.
//
// Screen x for a note at song-time tMs:
//   x = hitX + (tMs - nowMs) * (approachPx / approachMs)
// When nowMs === tMs, x === hitX.
//
// onJudge() feeds TapJudge's own stepEvents (see Simulation._applyJudgeEvents)
// into a small impact list drawn at the hit line -- tier-colored bursts/rings
// so a connect actually reads as an impact instead of the bar just fading.
import { capFlashAlpha } from '../ui/Accessibility.js';

export const DEFAULT_APPROACH_MS = 1600;
export const HIT_WINDOW_PERFECT_MS = 45;
export const HIT_WINDOW_GREAT_MS = 90;
export const HIT_WINDOW_OK_MS = 130;

const IMPACT_LIFE_MS = 260;
const IMPACT_MAX = 24; // oldest shed first; a hard cap during dense hold-tick runs
const SPARK_BASE_COUNT = 5;

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
    this._impacts = []; // {kind, spawnMs, seed} -- hit-line impact FX, see onJudge()
  }

  setNotes(notes) {
    this.notes = notes || [];
    this._judged.clear();
    this._flash = [];
    this._impacts = [];
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

  /** Feeds one TapJudge stepEvent (see Simulation._applyJudgeEvents) into a
   *  hit-line impact -- tier-colored burst/ring/fizzle drawn at the next
   *  draw() call. `particleMul` is the sim's fever-boosted multiplier
   *  (Simulation.js), so a perfect press throws a bigger burst hot than cold.
   *  Late-armed holds (tier === null) stay quiet, matching the existing
   *  judgment-halo rule -- the glow ramp is their own cue. */
  onJudge(evt, nowMs, particleMul = 1) {
    let kind;
    switch (evt.kind) {
      case 'hit':
      case 'holdStart':
        if (evt.tier == null) return;
        kind = evt.tier === 'sour' ? 'sour' : evt.tier; // perfect | great | good | sour
        break;
      case 'sour': kind = 'sour'; break;
      case 'miss':
      case 'holdChoke': kind = 'miss'; break;
      case 'holdTick': kind = 'tick'; break;
      case 'holdComplete': kind = 'complete'; break;
      default: return;
    }
    if (this._impacts.length >= IMPACT_MAX) this._impacts.shift();
    this._impacts.push({ kind, spawnMs: nowMs, particleMul: Math.max(0, particleMul) });
  }

  /** The Perfect Illusion: `engagement` (Simulation.engagement.level, 0..1)
   *  fades the ENTIRE layer -- lane, hit line, bars, impacts, flashes -- to
   *  nothing while the player isn't tapping, and back in the instant they
   *  do. Canvas 2D's globalAlpha doesn't multiply across reassignment, so
   *  rather than a single blanket alpha this threads `engagement` through
   *  every alpha-driving variable below (`alpha` in drawBar, `life` in
   *  drawImpact, the hit-line's own alphas) -- one multiply per site, same
   *  net effect as a true layer fade. */
  draw(ctx, canvas, nowMs, hitX, groundY, { fever = 0, reducedFlash = false, engagement = 1 } = {}) {
    // Still prune state on a dormant frame (impacts/flashes keep aging even
    // while invisible) -- but skip every draw call, zero cost while idle.
    this._impacts = this._impacts.filter((imp) => nowMs - imp.spawnMs < IMPACT_LIFE_MS);
    this._flash = this._flash.filter((f) => f.untilMs > nowMs);
    if (engagement <= 0.01) return;

    const stageW = canvas.width;
    const stageH = canvas.height;
    const barTop = 90;
    const barBottom = Math.min(groundY - 20, stageH - 40);
    const barH = barBottom - barTop;
    const hitMidY = (barTop + barBottom) / 2;

    // Approach lane (subtle).
    ctx.save();
    const laneGrad = ctx.createLinearGradient(hitX, 0, stageW, 0);
    laneGrad.addColorStop(0, `rgba(255, 215, 106, ${0.10 * engagement})`);
    laneGrad.addColorStop(1, 'rgba(255, 215, 106, 0.00)');
    ctx.fillStyle = laneGrad;
    ctx.fillRect(hitX, barTop, stageW - hitX, barH);

    // Recent connects briefly brighten the hit line itself, so it reads as
    // struck rather than just a static rail the bars slide past.
    let lineBoost = 0;
    for (const imp of this._impacts) {
      if (!brightensLine(imp.kind)) continue;
      const life = 1 - (nowMs - imp.spawnMs) / IMPACT_LIFE_MS;
      if (life > lineBoost) lineBoost = life;
    }

    // Hit line at Midio.
    ctx.strokeStyle = `rgba(255, 246, 207, ${0.85 * engagement})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(hitX, barTop);
    ctx.lineTo(hitX, barBottom);
    ctx.stroke();
    ctx.setLineDash([]);
    // Glow at hit line -- brightens on a connect, and runs hotter at high fever.
    const glowAlpha = capFlashAlpha(0.35 + 0.45 * lineBoost + 0.15 * fever, reducedFlash) * engagement;
    ctx.strokeStyle = `rgba(255, 215, 106, ${glowAlpha})`;
    ctx.lineWidth = 10 + 6 * lineBoost;
    ctx.beginPath();
    ctx.moveTo(hitX, barTop);
    ctx.lineTo(hitX, barBottom);
    ctx.stroke();

    const visible = this.visibleNotes(nowMs, hitX, stageW);
    for (const { note, x, judged } of visible) {
      drawBar(ctx, x, barTop, barH, note, judged, nowMs, fever, engagement);
    }

    // Hit-line impact FX: tier-colored bursts/rings/fizzles from onJudge().
    for (const imp of this._impacts) {
      drawImpact(ctx, hitX, hitMidY, imp, nowMs, reducedFlash, engagement);
    }

    // Judgment flashes.
    for (const f of this._flash) {
      const life = (f.untilMs - nowMs) / 280;
      ctx.globalAlpha = life * engagement;
      ctx.fillStyle = gradeColor(f.grade);
      ctx.font = 'bold 18px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(gradeLabel(f.grade), f.x, f.y - (1 - life) * 28);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

/** Which impact kinds are worth a brief hit-line brighten (misses/fizzles should not). */
function brightensLine(kind) {
  return kind === 'perfect' || kind === 'great' || kind === 'good' || kind === 'complete' || kind === 'tick';
}

const IMPACT_COLORS = {
  perfect: '255,215,106', // gold
  great: '79,216,196',    // teal
  good: '200,200,210',    // gray
  complete: '255,215,106',
  sour: '255,90,110',     // red
  miss: '255,90,110',
  tick: '255,215,106',
};

/** One hit-line impact: burst + expanding ring + radial sparks for the big
 *  tiers, a modest ring for great, a small pop for good, a dim fizzle for
 *  misses/sour, and a tiny spark for hold ticks. All alpha capped through
 *  capFlashAlpha so reduced-flash never sees a spike here either.
 *  `life` (age-based, 1 at spawn -> 0 at death) drives every RADIUS below --
 *  it must stay pure so a faded-out impact doesn't balloon in size. `a`
 *  (life * engagement) drives every ALPHA instead, so The Perfect Illusion
 *  can fade impacts out without touching their geometry. */
function drawImpact(ctx, x, y, imp, nowMs, reducedFlash, engagement = 1) {
  const age = nowMs - imp.spawnMs;
  const life = 1 - age / IMPACT_LIFE_MS;
  if (life <= 0) return;
  const a = life * engagement;
  if (a <= 0) return;
  const rgb = IMPACT_COLORS[imp.kind] || IMPACT_COLORS.good;
  const mul = Math.max(0.3, Math.min(2.5, imp.particleMul));

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  if (imp.kind === 'perfect' || imp.kind === 'complete') {
    const burstAlpha = capFlashAlpha(0.55 * a, reducedFlash);
    const burstR = 6 + 22 * (1 - life);
    const g = ctx.createRadialGradient(x, y, 0, x, y, burstR);
    g.addColorStop(0, `rgba(${rgb},${burstAlpha})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, burstR, 0, Math.PI * 2); ctx.fill();

    const ringR = 4 + 34 * (1 - life);
    ctx.strokeStyle = `rgba(${rgb},${capFlashAlpha(0.6 * a, reducedFlash)})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, ringR, 0, Math.PI * 2); ctx.stroke();

    const sparkCount = Math.round(SPARK_BASE_COUNT * mul);
    for (let i = 0; i < sparkCount; i++) {
      const ang = (i / sparkCount) * Math.PI * 2 + imp.spawnMs * 0.0003;
      const r = (10 + 30 * (1 - life));
      const sx = x + Math.cos(ang) * r;
      const sy = y + Math.sin(ang) * r * 0.6; // squashed vertically, reads as sparks not a full sphere
      ctx.fillStyle = `rgba(${rgb},${capFlashAlpha(0.8 * a, reducedFlash)})`;
      ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
    }
  } else if (imp.kind === 'great') {
    const ringR = 4 + 26 * (1 - life);
    ctx.strokeStyle = `rgba(${rgb},${capFlashAlpha(0.55 * a, reducedFlash)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, ringR, 0, Math.PI * 2); ctx.stroke();
  } else if (imp.kind === 'good') {
    const popR = 4 + 10 * (1 - life);
    ctx.fillStyle = `rgba(${rgb},${capFlashAlpha(0.35 * a, reducedFlash)})`;
    ctx.beginPath(); ctx.arc(x, y, popR, 0, Math.PI * 2); ctx.fill();
  } else if (imp.kind === 'tick') {
    ctx.fillStyle = `rgba(${rgb},${capFlashAlpha(0.7 * a, reducedFlash)})`;
    ctx.fillRect(x - 2, y - 2, 4, 4);
  } else { // sour | miss: a dim red fizzle, never a bright pop
    const fizzleR = 3 + 8 * (1 - life);
    ctx.fillStyle = `rgba(${rgb},${capFlashAlpha(0.22 * a, reducedFlash)})`;
    ctx.beginPath(); ctx.arc(x, y, fizzleR, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();
}

function drawBar(ctx, x, top, h, note, judged, nowMs, fever = 0, engagement = 1) {
  const isJump = note.isJump || note.kind === 'kick';
  const width = isJump ? 10 : note.kind === 'drive' ? 5 : 7;
  const vel = note.vel ?? 0.7;
  const height = h * (0.55 + 0.45 * vel) * (isJump ? 1 : 0.82);
  const y0 = top + (h - height);

  let alpha = 0.95;
  if (judged === 'miss') alpha = 0.25;
  else if (judged) alpha = 0.35;
  alpha *= engagement; // The Perfect Illusion: fades fill/glow/tip together, all keyed off this one value

  // Color by kind: jump/kick = gold (Midio), beat = cyan, drive = pink.
  // Fever runs the glow hotter -- the lane itself looks like it's catching
  // fire during a hot streak, not just the impacts at the hit line.
  const glowMul = 1 + 0.8 * fever;
  let fill, glow;
  if (isJump) {
    fill = `rgba(255, 215, 106, ${alpha})`;
    glow = `rgba(255, 180, 60, ${0.45 * alpha * glowMul})`;
  } else if (note.kind === 'drive') {
    fill = `rgba(255, 90, 140, ${alpha})`;
    glow = `rgba(255, 90, 140, ${0.35 * alpha * glowMul})`;
  } else {
    fill = `rgba(122, 209, 255, ${alpha})`;
    glow = `rgba(122, 209, 255, ${0.35 * alpha * glowMul})`;
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
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 * p * engagement})`;
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
